// Production server — identical to server.ts but serves the pre-built
// frontend from dist-web/ instead of using Bun's HTML import (which
// requires the runtime bundler and fails in packaged builds).

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join, extname } from "path";
import { homedir } from "os";
import { loadConfig, saveConfig, isAuthenticated, type CFConfig } from "./config";
import {
  getContests, getContestProblems, getProblemStatementStructured,
  submitCode, LANGUAGES,
  loadCodeforcesCookieJar, saveCodeforcesCookieJar,
  validateCodeforcesSession,
  getMyContestStatus, scrapeMyContestStatus, getUserInfo, ratingTier,
  getUserStatus, getUserRatingHistory,
  serveAvatar,
  CookieJar,
} from "./api";
import { mergeContestAc, mergeContestAcBulk, recordProblemCount, loadAcSummary, loadContestAc } from "./ac-store";
import { buildTranslateMessages } from "./api/translate-prompt";
import { buildTranslateStreamResponse } from "./api/translate-stream";
import { renderTranslationHtml } from "./api/render-translation";
import { listAiModels, testAiChat, probeAiRateLimit } from "./api/ai-probe";
import { primeFontCache, fontFile, fontsCss } from "./fonts";
import {
  listCustomFonts, addCustomFont, deleteCustomFont,
  customFontFile, importCustomFontFromPath, MS_GEORGIA_FAMILY,
} from "./custom-fonts";
import { loadDraft, saveDraft } from "./server-lib/drafts";
import { json } from "./server-lib/json";
import { sanitize } from "./server-lib/sanitize";

const DIST_WEB = join(import.meta.dir, "..", "dist-web");
const indexHtml = readFileSync(join(DIST_WEB, "index.html"), "utf-8");



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


const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  // Keep at Bun's max: CF standings can take 10+s, and a long AI translation
  // may spin before the first byte — 60s would drop the socket mid-stream.
  idleTimeout: 255,
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
    // More specific path first — otherwise /fonts/:file steals "custom".
    "/fonts/custom/:file": (req) => {
      const f = customFontFile(req.params.file);
      if (!f) return new Response("not found", { status: 404 });
      return new Response(f.body, {
        headers: { "content-type": f.type, "cache-control": "max-age=2592000" },
      });
    },
    "/fonts/:file": (req) => {
      const f = fontFile(req.params.file);
      if (!f) return new Response("not found", { status: 404 });
      return new Response(f.body, {
        headers: { "content-type": f.type, "cache-control": "max-age=2592000" },
      });
    },

    "/api/fonts/custom": {
      GET: () => json({
        fonts: listCustomFonts(),
        msGeorgiaFamily: MS_GEORGIA_FAMILY,
      }),
      POST: async (req) => {
        try {
          const body = await req.json().catch(() => ({}));
          if (body?.path) {
            const r = importCustomFontFromPath({
              family: String(body.family || "").trim(),
              path: String(body.path),
              weight: body.weight != null ? Number(body.weight) : 400,
              style: body.style === "italic" ? "italic" : "normal",
              source: body.source ? String(body.source) : undefined,
            });
            if (!r.ok) return json({ error: r.error }, { status: 400 });
            return json({ font: r.font });
          }
          const family = String(body?.family || "").trim();
          const facesIn = Array.isArray(body?.faces) ? body.faces : [];
          if (!facesIn.length && body?.dataBase64) {
            facesIn.push({
              name: body.name,
              dataBase64: body.dataBase64,
              weight: body.weight,
              style: body.style,
            });
          }
          const faces = [];
          for (const f of facesIn) {
            const b64 = String(f?.dataBase64 || "").replace(/^data:[^;]+;base64,/, "");
            if (!b64) return json({ error: "Missing face data" }, { status: 400 });
            let data: Buffer;
            try {
              data = Buffer.from(b64, "base64");
            } catch {
              return json({ error: "Invalid base64" }, { status: 400 });
            }
            if (data.length > 12 * 1024 * 1024) {
              return json({ error: "Font file too large (max 12MB)" }, { status: 400 });
            }
            faces.push({
              name: f?.name ? String(f.name) : undefined,
              data,
              weight: f?.weight != null ? Number(f.weight) : 400,
              style: f?.style === "italic" ? "italic" as const : "normal" as const,
            });
          }
          const r = addCustomFont({
            family,
            id: body?.id ? String(body.id) : undefined,
            faces,
            source: body?.source ? String(body.source) : "uploaded",
          });
          if (!r.ok) return json({ error: r.error }, { status: 400 });
          return json({ font: r.font });
        } catch (e: any) {
          return json({ error: e.message }, { status: 500 });
        }
      },
    },
    "/api/fonts/custom/:id": {
      DELETE: (req) => {
        const r = deleteCustomFont(req.params.id);
        if (!r.ok) return json({ error: r.error }, { status: 404 });
        return json({ ok: true });
      },
    },

    // Avatar proxy: fetch CF avatars through the app's (proxy-aware) network
    // path and cache the bytes to disk, so they load without a VPN and survive
    // restarts. ?u=<encoded CF avatar url>. Falls back to 404 (client shows
    // initials) when the host isn't allowed or the image can't be fetched.
    "/api/avatar": async (req) => {
      const u = new URL(req.url).searchParams.get("u");
      if (!u) return new Response("missing u", { status: 400 });
      const img = await serveAvatar(config, u);
      if (!img) return new Response("not found", { status: 404 });
      return new Response(img.body, {
        headers: { "content-type": img.type, "cache-control": "max-age=2592000" },
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
            // Coalesce empty → keep stored value (matches loadConfig's `||`), so
            // an accidentally-blank targetLang never persists and then flips to
            // the 中文 default on the next restart.
            targetLang: body.ai?.targetLang || config.ai.targetLang,
            // Blank template → keep stored value (Settings sends the default text
            // on reset, never an empty string, so a real edit is never lost).
            promptTemplate: body.ai?.promptTemplate || config.ai.promptTemplate,
            stream: body.ai?.stream ?? config.ai.stream,
            autoMode: body.ai?.autoMode ?? config.ai.autoMode,
            autoTrigger: body.ai?.autoTrigger ?? config.ai.autoTrigger,
            rpm: body.ai?.rpm ?? config.ai.rpm,
            concurrency: body.ai?.concurrency ?? config.ai.concurrency,
            autoCollapse: body.ai?.autoCollapse ?? config.ai.autoCollapse,
            requestIntervalMs: body.ai?.requestIntervalMs ?? config.ai.requestIntervalMs,
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

    // Settings: list models from the OpenAI-compatible provider. Body may
    // override baseUrl/apiKey so the form can probe values before autosave
    // lands on disk.
    "/api/ai/models": {
      POST: async (req) => {
        try {
          const body = await req.json().catch(() => ({}));
          const baseUrl = String(body?.baseUrl ?? config.ai.baseUrl ?? "").trim();
          const apiKey = String(body?.apiKey ?? config.ai.apiKey ?? "");
          const result = await listAiModels({ baseUrl, apiKey });
          if ("error" in result) return json({ error: result.error }, { status: 502 });
          return json({ models: result.models });
        } catch (e: any) {
          return json({ error: e.message }, { status: 500 });
        }
      },
    },

    // Settings: smoke-test chat/completions (stream or non-stream). Same
    // override contract as /api/ai/models.
    "/api/ai/test": {
      POST: async (req) => {
        try {
          const body = await req.json().catch(() => ({}));
          const baseUrl = String(body?.baseUrl ?? config.ai.baseUrl ?? "").trim();
          const apiKey = String(body?.apiKey ?? config.ai.apiKey ?? "");
          const model = String(body?.model ?? config.ai.model ?? "").trim();
          const stream = !!body?.stream;
          const result = await testAiChat({ baseUrl, apiKey, model, stream });
          if (!result.ok) return json(result, { status: 502 });
          return json(result);
        } catch (e: any) {
          return json({ ok: false, error: e.message, latencyMs: 0 }, { status: 500 });
        }
      },
    },

    // Settings: fire several tiny completions under the current concurrency +
    // requestIntervalMs (+ rpm). A 429 means those knobs are too aggressive.
    "/api/ai/rate-test": {
      POST: async (req) => {
        try {
          const body = await req.json().catch(() => ({}));
          const baseUrl = String(body?.baseUrl ?? config.ai.baseUrl ?? "").trim();
          const apiKey = String(body?.apiKey ?? config.ai.apiKey ?? "");
          const model = String(body?.model ?? config.ai.model ?? "").trim();
          const concurrency = Number(body?.concurrency ?? config.ai.concurrency ?? 2);
          const requestIntervalMs = Number(
            body?.requestIntervalMs ?? config.ai.requestIntervalMs ?? 200,
          );
          const rpm = Number(body?.rpm ?? config.ai.rpm ?? 0);
          const result = await probeAiRateLimit({
            baseUrl,
            apiKey,
            model,
            concurrency,
            requestIntervalMs,
            rpm,
          });
          if (result.error && result.total === 0) {
            return json(result, { status: 400 });
          }
          return json(result);
        } catch (e: any) {
          return json({
            ok: false,
            rateLimited: false,
            total: 0,
            succeeded: 0,
            rateLimitedCount: 0,
            failedCount: 0,
            elapsedMs: 0,
            error: e.message,
            shots: [],
          }, { status: 500 });
        }
      },
    },

    "/api/translate": {
      POST: async (req) => {
        try {
          const { text } = await req.json();
          if (!config.ai.apiKey) return json({ error: "AI key not configured" }, { status: 400 });
          const wantStream = config.ai.stream;
          // Abort only the *headers* phase: once the provider starts streaming,
          // the body is governed by translate-stream's per-read idle timeout. A
          // single global AbortController would wrongly kill a healthy long
          // translation, but a header-only timeout lets "provider never
          // responds at all" surface as a 502 instead of hanging forever
          // ("long text → silent no output").
          const ac = new AbortController();
          const headerTimer = setTimeout(() => ac.abort(), 60_000);
          const r = await fetch(`${config.ai.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "authorization": `Bearer ${config.ai.apiKey}`,
            },
            body: JSON.stringify({
              model: config.ai.model,
              messages: buildTranslateMessages(config.ai.targetLang, text, config.ai.promptTemplate),
              temperature: 0.2,
              stream: wantStream,
            }),
            signal: ac.signal,
          }).finally(() => clearTimeout(headerTimer));
          if (!r.ok) {
            const t = await r.text();
            return json({ error: `Upstream ${r.status}: ${t.slice(0, 200)}` }, { status: 502 });
          }
          if (wantStream && r.body) {
            return buildTranslateStreamResponse(r, renderTranslationHtml);
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
