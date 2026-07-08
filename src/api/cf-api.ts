// CF API client wrappers: every codeforces.com/api/* call lives here. Each
// function wraps `cfGet` (which signs with the API key and routes through the
// curl bridge) and caches via updateCacheIfNeeded for 24h.
import { isAuthenticated } from "../config";
import type { CFConfig } from "../config";
import { BASE_URL } from "./net";
import { withNetworkOptions } from "./net";
import { updateCacheIfNeeded } from "./cache";
import { CookieJar, jarFetch, jarFetchViaCurl } from "./cookie";
import {
  locateClassDiv,
  plainText,
  renderMathInHtml,
  parseStatementToJSON,
  parseStatementHtml,
  extractLoggedInHandle,
  isCloudflareChallenge,
  isCodeforcesLoginPage,
  findCsrf,
  diagSnippet,
  extractInputFields,
  cfAuthError,
} from "./html";
import type {
  Contest,
  MyContestStatus,
  Problem,
  Standings,
  StatementJSON,
  SubmissionResult,
  RatingChange,
  RanklistRow,
  UserInfo,
  UserSubmission,
} from "./types";

function makeParams(
  method: string,
  config: CFConfig,
  extra?: Record<string, string>
): Record<string, string> {
  const params: Record<string, string> = { ...extra };
  if (isAuthenticated(config)) {
    params.apiKey = config.apiKey;
    params.time = Math.floor(Date.now() / 1000).toString();
    const rand = Array.from({ length: 6 }, () =>
      "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]
    ).join("");
    // CF signature: rand/method?sorted_params#secret
    // All params (except apiSig) sorted alphabetically
    const sortedKeys = Object.keys(params).sort();
    const paramStr = sortedKeys.map((k) => `${k}=${params[k]}`).join("&");
    const toHash = `${rand}/${method}?${paramStr}#${config.apiSecret}`;
    const hash = Bun.SHA512.hash(toHash, "hex");
    params.apiSig = rand + hash;
  }
  return params;
}

// Endpoints that must NOT include API key (CF requires anonymous access)
const ANONYMOUS_METHODS = new Set([
  "contest.standings",
  "contest.list",
  "problemset.problems",
]);

export async function cfGet<T>(
  method: string,
  config: CFConfig,
  extra?: Record<string, string>
): Promise<T> {
  const anonymous = ANONYMOUS_METHODS.has(method);
  const params = anonymous ? { ...extra } : makeParams(method, config, extra);
  const qs = new URLSearchParams(params).toString();
  const url = `${BASE_URL}/${method}?${qs}`;
  // codeforces.com is behind Cloudflare and blocks bun/node JA3. Reuse
  // jarFetchViaCurl with an empty jar so we get the same TLS shape as
  // the rest of the CF traffic.
  const tempJar = new CookieJar("Mozilla/5.0 (compatible; cfapp-ts/1.0)");
  const resp = await jarFetchViaCurl(tempJar, url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; cfapp-ts/1.0)" },
  }, config);
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`HTTP ${resp.status}: ${body.slice(0, 200)}`);
  }
  const data = await resp.json();
  if (data.status !== "OK") throw new Error(data.comment || "API error");
  return data.result;
}

export async function getContests(config: CFConfig, force = false): Promise<Contest[]> {
  const cacheKey = `contests`;
  return updateCacheIfNeeded(cacheKey, async () => {
    const result = await cfGet<Contest[]>("contest.list", config, { gym: "false" });
    return result.sort((a, b) => b.id - a.id);
  }, force);
}

export async function getContestProblems(
  config: CFConfig,
  contestId: number,
  force = false,
): Promise<Problem[]> {
  const cacheKey = `problems_${contestId}`;
  return updateCacheIfNeeded(cacheKey, async () => {
    const result = await cfGet<{ problems: Problem[] }>("contest.standings", config, { contestId: contestId.toString() });
    const problems = result.problems.map((p) => ({ ...p, contestId: p.contestId || contestId }));
    // contest.standings doesn't always populate `rating` (Div3/Div4 often
    // come back without). Fill in from problemset.problems when missing.
    if (problems.some((p) => !p.rating)) {
      try {
        const ratings = await getAllProblemRatings(config);
        for (const p of problems) {
          if (!p.rating) {
            const r = ratings[`${p.contestId}-${p.index}`];
            if (r) p.rating = r;
          }
        }
      } catch {
        // non-fatal — ratings are decorative
      }
    }
    return problems;
  }, force);
}

export async function getStandings(
  config: CFConfig,
  contestId: number,
  fromRank: number = 1,
  count: number = 50,
  handles: string = ""
): Promise<Standings> {
  const cacheKey = `standings_${contestId}_${fromRank}_${count}`;
  return updateCacheIfNeeded(cacheKey, async () => {
    const result = await cfGet<{ contest: Contest; problems: Problem[]; rows: RanklistRow[]; totalRows: number }>(
      "contest.standings", config, { contestId: contestId.toString() }
    );
    return {
      contest: result.contest,
      problems: result.problems.map((p) => ({ ...p, contestId: p.contestId || contestId })),
      rows: result.rows.slice(fromRank - 1, fromRank - 1 + count).map((r) => ({
        rank: r.rank,
        handle: r.handle || (r as any).party?.members?.[0]?.handle || "unknown",
        points: r.points,
        penalty: r.penalty,
        problemResults: r.problemResults,
      })),
      totalRows: result.totalRows,
    };
  });
}

export async function getContestSubmissions(
  config: CFConfig,
  contestId: number,
  handle?: string,
  force = false,
): Promise<SubmissionResult[]> {
  const cacheKey = `submissions_${contestId}_${handle || "all"}`;
  return updateCacheIfNeeded(cacheKey, async () => {
    const extra: Record<string, string> = { contestId: contestId.toString() };
    if (handle) extra.handle = handle;
    const raw = await cfGet<any[]>("contest.status", config, extra);
    return raw.slice(0, 50).map((s: any) => ({
      id: s.id,
      contestId: s.problem?.contestId || contestId,
      problemIndex: s.problem?.index || "",
      verdict: s.verdict || "",
      passedTestCount: s.passedTestCount || 0,
      timeConsumedMillis: s.timeConsumedMillis || 0,
      memoryConsumedBytes: s.memoryConsumedBytes || 0,
      programmingLanguage: s.programmingLanguage || "",
      creationTimeSeconds: s.creationTimeSeconds || 0,
    }));
  }, force);
}

// Per-contest verdict map for the configured handle. Returns "AC" for any
// problem with at least one OK submission, "WA" for problems that have been
// attempted but never AC'd, undefined for untouched problems. We pull the
// full status (no slice) so we don't miss old AC's on long-running gym /
// practice contests.
export async function getMyContestStatus(
  config: CFConfig,
  contestId: number,
  force = false,
): Promise<MyContestStatus> {
  const handle = (config.handle || "").trim();
  if (!handle) return { byIndex: {} };
  const cacheKey = `mystatus_${contestId}_${handle}`;
  return updateCacheIfNeeded(cacheKey, async () => {
    const extra: Record<string, string> = { contestId: contestId.toString(), handle };
    const raw = await cfGet<any[]>("contest.status", config, extra);
    const byIndex: Record<string, "AC" | "WA"> = {};
    for (const s of raw) {
      const idx: string = s?.problem?.index || "";
      if (!idx) continue;
      if (s.verdict === "OK") { byIndex[idx] = "AC"; }
      else if (byIndex[idx] !== "AC" && s.verdict) { byIndex[idx] = "WA"; }
    }
    return { byIndex };
  }, force);
}

// HTML fallback. contest.status only returns the most recent ~50 submissions
// per call and depends on a working API key (CF rate-limits hard for some
// requests). When the user is logged in via the webview, /contest/{id}/my
// always works and returns *every* submission they made in that contest.
// We parse the verdict + problem index out of the rows and merge into the
// API result.
export async function scrapeMyContestStatus(
  jar: CookieJar,
  config: CFConfig,
  contestId: number,
  force = false,
): Promise<MyContestStatus> {
  if (jar.isEmpty()) return { byIndex: {} };
  const cacheKey = `mystatus_scrape_${contestId}`;
  return updateCacheIfNeeded(cacheKey, async () => {
    const url = `https://codeforces.com/contest/${contestId}/my`;
    let html = "";
    try {
      const resp = await jarFetch(jar, url, {}, config);
      if (!resp.ok) return { byIndex: {} };
      html = await resp.text();
    } catch {
      return { byIndex: {} };
    }
    if (isCloudflareChallenge(200, html)) return { byIndex: {} };
    // Bail if CF redirected us to /enter (i.e. we're not actually logged in).
    if (/<form[^>]+action="\/enter/.test(html)) return { byIndex: {} };
    const byIndex: Record<string, "AC" | "WA"> = {};
    // Each submission row: <tr ... data-submission-id="...">. CF uses
    // hyphen-separated kebab-case for data attributes. The verdict span has
    // class="verdict-accepted" / "verdict-rejected" / "verdict-failed".
    const rowRe = /<tr[^>]*data-submission-id[\s\S]*?<\/tr>/gi;
    const rows = html.match(rowRe) ?? [];
    for (const row of rows) {
      const idxMatch = row.match(/\/contest\/\d+\/problem\/([A-Za-z]\d?)/);
      if (!idxMatch || !idxMatch[1]) continue;
      const idx = idxMatch[1];
      if (/verdict-accepted/i.test(row)) {
        byIndex[idx] = "AC";
      } else if (byIndex[idx] !== "AC" && /verdict-(rejected|failed)/i.test(row)) {
        byIndex[idx] = "WA";
      }
    }
    return { byIndex };
  }, force);
}

// Fetches every problem in CF's archive with its rating. The response is
// huge but cacheable for a day, so we pay the cost once. Used to fill in
// `rating` for problems that contest.standings returns without one (Div3/4
// contests sometimes do this).
export async function getAllProblemRatings(
  config: CFConfig,
  force = false,
): Promise<Record<string, number>> {
  const cacheKey = "problemset_ratings";
  return updateCacheIfNeeded(cacheKey, async () => {
    const result = await cfGet<{ problems: Array<{ contestId?: number; index?: string; rating?: number }> }>(
      "problemset.problems", config,
    );
    const map: Record<string, number> = {};
    for (const p of result.problems ?? []) {
      if (p.contestId == null || !p.index || !p.rating) continue;
      map[`${p.contestId}-${p.index}`] = p.rating;
    }
    return map;
  }, force);
}

export async function getProblemStatementStructured(
  config: CFConfig,
  contestId: number,
  problemIndex: string,
  force = false
): Promise<StatementJSON> {
  const cacheKey = `statement_html_v2_${contestId}_${problemIndex}`;
  return updateCacheIfNeeded(cacheKey, async () => {
    const url = `https://codeforces.com/contest/${contestId}/problem/${problemIndex}`;
    const resp = await fetch(url, withNetworkOptions(config, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; cfapp-ts/1.0)" },
    }));
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const html = await resp.text();
    return parseStatementToJSON(html);
  }, force);
}

// v3 = MathML-based LaTeX + structural sample extraction. This is the legacy
// markdown-statement fetcher used by the terminal UI. Kept verbatim so the
// TUI output is byte-identical to before the refactor.
export async function getProblemStatement(
  config: CFConfig,
  contestId: number,
  problemIndex: string
): Promise<string> {
  const cacheKey = `statement_v3_${contestId}_${problemIndex}`;
  return updateCacheIfNeeded(cacheKey, async () => {
    const url = `https://codeforces.com/contest/${contestId}/problem/${problemIndex}`;
    try {
      const resp = await fetch(url, withNetworkOptions(config, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; cfapp-ts/1.0)" },
      }));
      if (!resp.ok) return `Failed to fetch: HTTP ${resp.status}`;
      const html = await resp.text();
      return parseStatementHtml(html);
    } catch (e: any) {
      return `Failed to fetch: ${e.message}`;
    }
  });
}

// CF rating tier for color rendering. Mirrors the official scheme. Lives in
// the fs-free tiers.ts module so the browser bundle can import it too.
export { ratingTier } from "./tiers";

// user.info is anonymous-safe; we don't sign it. Cached briefly so the auth
// indicator's repeated polls don't hammer CF.
export async function getUserInfo(
  config: CFConfig,
  handle: string,
  force = false,
): Promise<UserInfo> {
  const cacheKey = `userinfo_${handle}`;
  return updateCacheIfNeeded(cacheKey, async () => {
    const url = `${BASE_URL}/user.info?handles=${encodeURIComponent(handle)}`;
    const resp = await fetch(url, withNetworkOptions(config, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; cfapp-ts/1.0)" },
    }));
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    if (data.status !== "OK") throw new Error(data.comment || "user.info error");
    const u = data.result?.[0] || {};
    return {
      handle: u.handle || handle,
      rating: typeof u.rating === "number" ? u.rating : null,
      maxRating: typeof u.maxRating === "number" ? u.maxRating : null,
      rank: u.rank || null,
      maxRank: u.maxRank || null,
      avatar: u.avatar || u.titlePhoto || null,
    };
  }, force);
}

// All submissions ever made by `handle` across every contest, with problem
// rating + tags. Drives the stats page (solve count, rating distribution,
// verdict breakdown, language usage, activity heatmap). CF caps a single call
// at 10000 rows; we fetch the most recent 10000 which covers virtually every
// real account. Cached 24h.
export async function getUserStatus(
  config: CFConfig,
  handle: string,
  force = false,
): Promise<UserSubmission[]> {
  const cacheKey = `user_status_${handle}`;
  return updateCacheIfNeeded(cacheKey, async () => {
    const raw = await cfGet<any[]>("user.status", config, {
      handle,
      from: "1",
      count: "10000",
    });
    return raw.map((s: any): UserSubmission => ({
      id: s.id,
      contestId: s.contestId ?? s.problem?.contestId ?? 0,
      problem: {
        contestId: s.problem?.contestId ?? s.contestId ?? 0,
        index: s.problem?.index ?? "",
        name: s.problem?.name ?? "",
        rating: typeof s.problem?.rating === "number" ? s.problem.rating : undefined,
        tags: Array.isArray(s.problem?.tags) ? s.problem.tags : [],
      },
      verdict: s.verdict ?? "",
      passedTestCount: s.passedTestCount ?? 0,
      timeConsumedMillis: s.timeConsumedMillis ?? 0,
      memoryConsumedBytes: s.memoryConsumedBytes ?? 0,
      programmingLanguage: s.programmingLanguage ?? "",
      creationTimeSeconds: s.creationTimeSeconds ?? 0,
    }));
  }, force);
}

// Rating-change history (one entry per rated contest the user participated
// in). Drives the rating-progression chart on the stats page. Cached 24h.
export async function getUserRatingHistory(
  config: CFConfig,
  handle: string,
  force = false,
): Promise<RatingChange[]> {
  const cacheKey = `user_rating_${handle}`;
  return updateCacheIfNeeded(cacheKey, async () => {
    const raw = await cfGet<any[]>("user.rating", config, { handle });
    return raw.map((c: any): RatingChange => ({
      contestId: c.contestId ?? 0,
      contestName: c.contestName ?? "",
      rank: c.rank ?? 0,
      ratingUpdateTimeSeconds: c.ratingUpdateTimeSeconds ?? 0,
      oldRating: c.oldRating ?? 0,
      newRating: c.newRating ?? 0,
    }));
  }, force);
}

// ---- re-exports so the barrel index stays tidy ----
export { locateClassDiv, plainText, renderMathInHtml, extractLoggedInHandle } from "./html";
