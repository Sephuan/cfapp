// Production server — identical to server.ts but serves the pre-built
// frontend from dist-web/ instead of using Bun's HTML import (which
// requires the runtime bundler and fails in packaged builds).

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, extname } from "path";
import { homedir } from "os";
import katex from "katex";
import { loadConfig, saveConfig, isAuthenticated, type CFConfig } from "./config";
import {
  getContests, getContestProblems, getProblemStatementStructured,
  submitCode, LANGUAGES,
  loadCodeforcesCookieJar, saveCodeforcesCookieJar,
  validateCodeforcesSession,
  getMyContestStatus, scrapeMyContestStatus, getUserInfo, ratingTier,
  getUserStatus, getUserRatingHistory,
  CookieJar,
} from "./api";
import { mergeContestAc, mergeContestAcBulk, recordProblemCount, loadAcSummary, loadContestAc } from "./ac-store";
import { primeFontCache, fontFile, fontsCss } from "./fonts";

const DIST_WEB = join(import.meta.dir, "..", "dist-web");
const indexHtml = readFileSync(join(DIST_WEB, "index.html"), "utf-8");

const DRAFT_DIR = join(homedir(), ".config", "cfapp", "drafts");

function renderTranslationHtml(input: string): string {
  if (!input) return "";
  const slots: string[] = [];
  const stash = (raw: string, displayMode: boolean) => {
    try {
      const html = katex.renderToString(raw, { displayMode, throwOnError: false, output: "html" });
      slots.push(html);
    } catch {
      slots.push(`<code>${escapeHtml(raw)}</code>`);
    }
    return ` MATH${slots.length - 1} `;
  };
  let s = input.replace(/\$\$\$([\s\S]+?)\$\$\$/g, (_, m) => stash(m, false));
  s = s.replace(/\$([^\n$]+?)\$/g, (_, m) => stash(m, false));
  s = escapeHtml(s);
  s = s.replace(/`([^`\n]+?)`/g, (_, m) => `<code>${m}</code>`);
  s = s.replace(/\*\*([^\n*]+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^\n*]+?)\*(?!\*)/g, "$1<em>$2</em>");
  const paras = s.split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`);
  s = paras.join("");
  s = s.replace(/ MATH(\d+) /g, (_, i) => slots[Number(i)] ?? "");
  return s;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function draftPath(contestId: string, index: string): string {
  return join(DRAFT_DIR, `${contestId}${index}.txt`);
}
function loadDraft(contestId: string, index: string): string {
  try {
    const p = draftPath(contestId, index);
    if (existsSync(p)) return readFileSync(p, "utf-8");
  } catch {}
  return "";
}
function saveDraft(contestId: string, index: string, code: string): void {
  try {
    if (!existsSync(DRAFT_DIR)) mkdirSync(DRAFT_DIR, { recursive: true });
    writeFileSync(draftPath(contestId, index), code);
  } catch (e: any) {
    throw new Error(`Failed to save draft: ${e.message}`);
  }
}

const json = (data: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });

let config: CFConfig = loadConfig();
primeFontCache();

let cfJar: CookieJar = loadCodeforcesCookieJar();

let authCache: { ok: boolean; handle?: string; error?: string; ts: number } | null = null;
const AUTH_CACHE_OK_MS = 10_000;
const AUTH_CACHE_FAIL_MS = 30_000;

function purgeCfClearanceFromJar() {
  if (cfJar.deleteCookie("cf_clearance")) {
    saveCodeforcesCookieJar(cfJar, "purged-cf-clearance");
  }
}

// Resolve the handle whose solve data we should read/write. Prefers the handle
// the live cookie session identifies us as (authoritative — the user may be
// logged into a different account than config.handle), reusing the auth cache
// to avoid an extra CF round-trip. Falls back to the configured handle, then "".
async function currentHandle(): Promise<string> {
  const now = Date.now();
  if (authCache && authCache.ok && authCache.handle && now - authCache.ts < AUTH_CACHE_OK_MS) {
    return authCache.handle;
  }
  cfJar = loadCodeforcesCookieJar();
  if (!cfJar.isEmpty()) {
    try {
      const r = await validateCodeforcesSession(config, cfJar);
      authCache = { ok: r.ok, handle: r.handle, error: r.error, ts: now };
      if (r.ok && r.handle) return r.handle;
    } catch {}
  }
  return (config.handle || "").trim();
}

const sanitize = (c: CFConfig) => ({
  handle: c.handle,
  apiKey: c.apiKey,
  apiSecret: c.apiSecret,
  password: c.password,
  proxy: c.proxy,
  verifySsl: c.verifySsl,
  ai: {
    baseUrl: c.ai.baseUrl,
    apiKey: c.ai.apiKey,
    model: c.ai.model,
  },
});

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  idleTimeout: 60,
  routes: {
    "/": () => new Response(indexHtml, {
      headers: { "content-type": "text/html; charset=utf-8" },
    }),

    "/fonts/fonts.css": () => new Response(fontsCss(), {
      // Runtime-generated from FACES — see server.ts. Must be no-cache so a new
      // font's @font-face isn't shadowed by a stale copy at this fixed URL
      // (the immutable woff2 files below keep their long max-age).
      headers: { "content-type": "text/css", "cache-control": "no-cache" },
    }),
    "/fonts/:file": (req) => {
      const f = fontFile(req.params.file);
      if (!f) return new Response("not found", { status: 404 });
      return new Response(f.body, {
        headers: { "content-type": f.type, "cache-control": "max-age=2592000" },
      });
    },

    "/api/languages": () => json(LANGUAGES),

    "/api/config": {
      GET: () => json(sanitize(config)),
      PUT: async (req) => {
        const body = await req.json();
        const next: CFConfig = {
          handle: body.handle ?? config.handle,
          apiKey: body.apiKey !== undefined ? body.apiKey : config.apiKey,
          apiSecret: body.apiSecret !== undefined ? body.apiSecret : config.apiSecret,
          password: body.password !== undefined ? body.password : config.password,
          proxy: body.proxy ?? config.proxy,
          verifySsl: body.verifySsl ?? config.verifySsl,
          ai: {
            baseUrl: body.ai?.baseUrl ?? config.ai.baseUrl,
            apiKey: body.ai?.apiKey !== undefined ? body.ai.apiKey : config.ai.apiKey,
            model: body.ai?.model ?? config.ai.model,
          },
        };
        config = next;
        saveConfig(next);
        return json(sanitize(config));
      },
    },

    "/api/contests": async (req) => {
      try {
        const force = new URL(req.url).searchParams.get("refresh") === "1";
        return json(await getContests(config, force));
      }
      catch (e: any) { return json({ error: e.message }, { status: 500 }); }
    },

    "/api/contests/:id/problems": async (req) => {
      try {
        const id = Number(req.params.id);
        const force = new URL(req.url).searchParams.get("refresh") === "1";
        const problems = await getContestProblems(config, id, force);
        try { recordProblemCount(await currentHandle(), id, problems.length); } catch {}
        return json(problems);
      } catch (e: any) { return json({ error: e.message }, { status: 500 }); }
    },

    "/api/contests/:id/problem/:index": async (req) => {
      try {
        const id = Number(req.params.id);
        const force = new URL(req.url).searchParams.get("refresh") === "1";
        return json(await getProblemStatementStructured(config, id, req.params.index, force));
      } catch (e: any) { return json({ error: e.message }, { status: 500 }); }
    },

    "/api/contests/:id/my-status": async (req) => {
      try {
        const id = Number(req.params.id);
        const force = new URL(req.url).searchParams.get("refresh") === "1";
        cfJar = loadCodeforcesCookieJar();
        let effectiveHandle = (config.handle || "").trim();
        try {
          const r = await validateCodeforcesSession(config, cfJar);
          if (r.ok && r.handle) effectiveHandle = r.handle;
        } catch {}
        const cfgWithHandle = effectiveHandle
          ? { ...config, handle: effectiveHandle }
          : config;
        let api: { byIndex: Record<string, "AC" | "WA"> } = { byIndex: {} };
        try {
          api = await getMyContestStatus(cfgWithHandle, id, force);
        } catch {}
        let scrape: { byIndex: Record<string, "AC" | "WA"> } = { byIndex: {} };
        if (!cfJar.isEmpty()) {
          try {
            scrape = await scrapeMyContestStatus(cfJar, config, id, force);
          } catch {}
        }
        const byIndex: Record<string, "AC" | "WA"> = { ...scrape.byIndex };
        for (const [k, v] of Object.entries(api.byIndex)) {
          if (v === "AC" || !byIndex[k]) byIndex[k] = v;
        }
        let merged = byIndex;
        try {
          if (Object.keys(byIndex).length > 0) {
            const entry = mergeContestAc(effectiveHandle, id, byIndex);
            merged = entry.byIndex;
          } else {
            const prev = loadContestAc(effectiveHandle, id);
            if (prev) merged = prev.byIndex;
          }
        } catch {}
        return json({ byIndex: merged });
      } catch (e: any) { return json({ error: e.message }, { status: 500 }); }
    },

    "/api/ac-summary": async () => {
      try {
        return json(loadAcSummary(await currentHandle()));
      } catch (e: any) {
        return json({ error: e.message }, { status: 500 });
      }
    },

    // Sync ALL solves in one shot: pull the full submission history
    // (user.status), fold it into per-contest AC/WA, persist under the current
    // handle, and return the fresh summary. This is what the contest list's
    // refresh calls so "x/y solved" fills in for every contest at once, instead
    // of only the ones the user has opened. Falls back to the stored summary if
    // no handle / the pull fails, so the list still shows what we already know.
    "/api/ac-sync": async (req) => {
      try {
        const force = new URL(req.url).searchParams.get("refresh") === "1";
        const handle = await currentHandle();
        if (!handle) return json(loadAcSummary(""));
        try {
          const subs = await getUserStatus(config, handle, force);
          const byContest: Record<string, Record<string, "AC" | "WA">> = {};
          for (const s of subs) {
            const cid = s.problem.contestId || s.contestId;
            const idx = s.problem.index;
            if (!cid || !idx) continue;
            const key = String(cid);
            const bucket = (byContest[key] ??= {});
            if (s.verdict === "OK") bucket[idx] = "AC";
            else if (bucket[idx] !== "AC") bucket[idx] = "WA";
          }
          mergeContestAcBulk(handle, byContest);
        } catch { /* keep whatever is already stored */ }
        return json(loadAcSummary(handle));
      } catch (e: any) {
        return json({ error: e.message }, { status: 500 });
      }
    },

    "/api/user/me": async (req) => {
      try {
        const force = new URL(req.url).searchParams.get("refresh") === "1";
        cfJar = loadCodeforcesCookieJar();
        let handle = (config.handle || "").trim();
        try {
          const r = await validateCodeforcesSession(config, cfJar);
          if (r.ok && r.handle) handle = r.handle;
        } catch {}
        if (!handle) return json({ error: "no handle" }, { status: 404 });
        const u = await getUserInfo(config, handle, force);
        return json({ ...u, tier: ratingTier(u.rating) });
      } catch (e: any) { return json({ error: e.message }, { status: 500 }); }
    },

    "/api/user/status": async (req) => {
      try {
        if (!isAuthenticated(config)) return json({ error: "API key required. Set handle, apiKey, apiSecret in Settings." }, { status: 400 });
        const force = new URL(req.url).searchParams.get("refresh") === "1";
        cfJar = loadCodeforcesCookieJar();
        let handle = (config.handle || "").trim();
        try {
          const r = await validateCodeforcesSession(config, cfJar);
          if (r.ok && r.handle) handle = r.handle;
        } catch {}
        if (!handle) return json({ error: "no handle" }, { status: 404 });
        return json(await getUserStatus(config, handle, force));
      } catch (e: any) { return json({ error: e.message }, { status: 500 }); }
    },

    "/api/user/rating-history": async (req) => {
      try {
        if (!isAuthenticated(config)) return json({ error: "API key required. Set handle, apiKey, apiSecret in Settings." }, { status: 400 });
        const force = new URL(req.url).searchParams.get("refresh") === "1";
        cfJar = loadCodeforcesCookieJar();
        let handle = (config.handle || "").trim();
        try {
          const r = await validateCodeforcesSession(config, cfJar);
          if (r.ok && r.handle) handle = r.handle;
        } catch {}
        if (!handle) return json({ error: "no handle" }, { status: 404 });
        return json(await getUserRatingHistory(config, handle, force));
      } catch (e: any) { return json({ error: e.message }, { status: 500 }); }
    },

    "/api/auth/logout": {
      POST: () => {
        try {
          const file = join(homedir(), ".config", "cftui", "codeforces-cookies.json");
          if (existsSync(file)) writeFileSync(file, JSON.stringify({ version: 1, cookies: [] }, null, 2));
        } catch {}
        cfJar = loadCodeforcesCookieJar();
        authCache = null;
        return json({ ok: true });
      },
    },

    "/api/draft/:id/:index": {
      GET: (req) => json({ code: loadDraft(req.params.id, req.params.index) }),
      PUT: async (req) => {
        try {
          const { code } = await req.json();
          if (code !== undefined && typeof code !== "string") {
            return json({ error: "code must be a string" }, { status: 400 });
          }
          saveDraft(req.params.id, req.params.index, code ?? "");
          return json({ ok: true });
        } catch (e: any) {
          return json({ error: e.message }, { status: 500 });
        }
      },
    },

    "/api/submit/:id/:index": {
      POST: async (req) => {
        try {
          const { code, languageId } = await req.json();
          if (typeof code !== "string" || !code.trim()) {
            return json({ error: "code must be a non-empty string" }, { status: 400 });
          }
          if (!Number.isInteger(languageId)) {
            return json({ error: "languageId must be an integer" }, { status: 400 });
          }
          if (!LANGUAGES.some((language) => language.id === languageId)) {
            return json({ error: `unsupported languageId: ${languageId}` }, { status: 400 });
          }
          const id = Number(req.params.id);
          if (!Number.isInteger(id)) {
            return json({ error: "contest id must be an integer" }, { status: 400 });
          }
          const result = await submitCode(config, id, req.params.index, code, languageId);
          return json({ result });
        } catch (e: any) { return json({ error: e.message }, { status: 500 }); }
      },
    },

    "/api/translate": {
      POST: async (req) => {
        try {
          const { text } = await req.json();
          if (!config.ai.apiKey) return json({ error: "AI key not configured" }, { status: 400 });
          const r = await fetch(`${config.ai.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "authorization": `Bearer ${config.ai.apiKey}`,
            },
            body: JSON.stringify({
              model: config.ai.model,
              messages: [
                { role: "system", content: "你是一个翻译助手。把用户输入的英文（编程竞赛题面片段）翻译成中文。只输出译文，不要解释，不要加引号。保留原文中的 LaTeX 公式（$...$ 或 $$$...$$$）和代码（`...`）原样不动。保留段落分隔（空行）。可以使用 Markdown 的粗体（**text**）、斜体（*text*）。" },
                { role: "user", content: text },
              ],
              temperature: 0.2,
            }),
          });
          if (!r.ok) {
            const t = await r.text();
            return json({ error: `Upstream ${r.status}: ${t.slice(0, 200)}` }, { status: 502 });
          }
          const j = await r.json();
          const out = j?.choices?.[0]?.message?.content ?? "";
          const translation = String(out).trim();
          return json({ translation, html: renderTranslationHtml(translation) });
        } catch (e: any) {
          return json({ error: e.message }, { status: 500 });
        }
      },
    },

    "/api/auth/status": async () => {
      cfJar = loadCodeforcesCookieJar();
      if (cfJar.isEmpty()) {
        authCache = null;
        return json({ ok: false, error: "No saved cookies" });
      }
      const now = Date.now();
      if (authCache) {
        const ttl = authCache.ok ? AUTH_CACHE_OK_MS : AUTH_CACHE_FAIL_MS;
        if (now - authCache.ts < ttl) {
          return json({ ok: authCache.ok, handle: authCache.handle ?? null, error: authCache.error ?? null });
        }
      }
      try {
        const r = await validateCodeforcesSession(config, cfJar);
        if (!r.ok && r.error && /Cloudflare/.test(r.error)) {
          purgeCfClearanceFromJar();
        }
        authCache = { ok: r.ok, handle: r.handle, error: r.error, ts: now };
        return json({ ok: r.ok, handle: r.handle ?? null, error: r.error ?? null });
      } catch (e: any) {
        authCache = { ok: false, error: e.message, ts: now };
        return json({ ok: false, error: e.message });
      }
    },

    "/api/auth/ping": () => {
      cfJar = loadCodeforcesCookieJar();
      if (cfJar.isEmpty()) return json({ ok: false, fresh: false });
      const hasClearance = cfJar.hasCookie("cf_clearance");
      return json({ ok: true, fresh: hasClearance });
    },

    "/api/auth/start": {
      POST: async (req) => {
        try {
          const body = await req.json().catch(() => ({}));
          const mode: string =
            body?.mode === "isolated" ? "--isolated" :
            body?.mode === "default-profile" ? "--default-profile" :
            "";
          const args = ["run", "scripts/auth-codeforces.ts"];
          if (mode) args.push(mode);
          Bun.spawn(["bun", ...args], {
            stdio: ["ignore", "inherit", "inherit"],
            cwd: import.meta.dir + "/..",
          });
          return json({ ok: true });
        } catch (e: any) {
          return json({ error: e.message }, { status: 500 });
        }
      },
    },
  },
  fetch(req) {
    const url = new URL(req.url);
    const MIME: Record<string, string> = {
      ".js": "application/javascript",
      ".css": "text/css",
      ".html": "text/html",
      ".woff2": "font/woff2",
      ".woff": "font/woff",
      ".ttf": "font/ttf",
      ".otf": "font/otf",
      ".png": "image/png",
      ".svg": "image/svg+xml",
    };
    const filePath = join(DIST_WEB, url.pathname);
    if (!filePath.startsWith(DIST_WEB)) return new Response("forbidden", { status: 403 });
    try {
      const body = readFileSync(filePath);
      const ext = extname(url.pathname);
      return new Response(body, {
        headers: { "content-type": MIME[ext] || "application/octet-stream" },
      });
    } catch {
      return new Response("not found", { status: 404 });
    }
  },
  development: false,
});

console.log(`cfapp → http://localhost:${server.port}`);
