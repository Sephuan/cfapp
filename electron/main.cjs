// Electron main process for cfapp.
// Responsibilities:
//   1. Spawn the Bun HTTP server (src/server.ts) as a child process.
//   2. Wait for it to bind a port, then open a BrowserWindow pointing at it.
//   3. Enable <webview> tags so the renderer can embed real Codeforces pages
//      under a persistent partition (persist:cf) — that partition gives us
//      Chromium-backed cookies, cf_clearance, fingerprint, the lot.
const { app, BrowserWindow, Menu, session, ipcMain } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const net = require("net");

const PORT = Number(process.env.CFAPP_PORT || 3000);
const IS_PACKAGED = app.isPackaged;
const REPO_ROOT = IS_PACKAGED ? path.join(process.resourcesPath, "app") : path.resolve(__dirname, "..");
const BUN_PATH = IS_PACKAGED ? path.join(process.resourcesPath, "bun") : "bun";
const COOKIE_FILE = path.join(os.homedir(), ".config", "cfapp", "codeforces-cookies.json");
// Pin a UA whose major Chrome version matches the actual Chromium that
// Electron ships with — Cloudflare Turnstile compares the UA string to
// real TLS/JS fingerprints and challenge-loops anything that lies. Bumped
// from 124 to 148 (Electron 42 → Chromium 148). Also keep this in sync
// with `UA` in src/api.ts so the curl replay matches what cf_clearance
// was issued under.
const CF_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/148.0.0.0 Safari/537.36";
let bunProc = null;
let mainWindow = null;

async function syncCfCookiesToFile() {
  // Read all codeforces.com cookies from the persist:cf session and write
  // them to ~/.config/cfapp/codeforces-cookies.json in the same shape
  // saveCodeforcesCookies() uses, so /api/auth/status (and any future
  // server-side CF call) can pick up the webview's logged-in session.
  try {
    const ses = session.fromPartition("persist:cf");
    const cookies = await ses.cookies.get({});
    const cfCookies = cookies
      .filter((c) => /(^|\.)codeforces\.com$/i.test(c.domain || ""))
      .map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        expires: c.expirationDate,
        httpOnly: c.httpOnly,
        secure: c.secure,
      }));
    if (cfCookies.length === 0) return;
    fs.mkdirSync(path.dirname(COOKIE_FILE), { recursive: true });
    const data = {
      version: 1,
      savedAt: Date.now(),
      source: "electron-webview",
      userAgent: CF_USER_AGENT,
      cookies: cfCookies,
    };
    fs.writeFileSync(COOKIE_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
    try { fs.chmodSync(COOKIE_FILE, 0o600); } catch {}
  } catch (e) {
    console.error(`[cfapp] cookie sync failed: ${e.message}`);
  }
}

async function purgeStaleClearance() {
  // The cf_clearance cookie is bound to the exact UA that solved Cloudflare's
  // challenge. If the saved cookie file was issued under an older
  // CF_USER_AGENT (e.g. we just bumped Chrome/124 → Chrome/148), the existing
  // cf_clearance will be rejected immediately and the user will see an
  // endless Cloudflare verification loop. Delete only cf_clearance — keep
  // JSESSIONID/X-User so the login session is preserved. Webview will solve
  // a fresh challenge on the next CF visit under the new UA.
  try {
    const ses = session.fromPartition("persist:cf");
    let savedUA = null;
    try {
      const data = JSON.parse(fs.readFileSync(COOKIE_FILE, "utf-8"));
      savedUA = data && typeof data.userAgent === "string" ? data.userAgent : null;
    } catch {}
    if (savedUA && savedUA !== CF_USER_AGENT) {
      console.log(`[cfapp] UA changed (${savedUA.match(/Chrome\/[0-9]+/)?.[0]} → ${CF_USER_AGENT.match(/Chrome\/[0-9]+/)?.[0]}); purging cf_clearance`);
      try {
        const cookies = await ses.cookies.get({ name: "cf_clearance" });
        for (const c of cookies) {
          const proto = c.secure ? "https" : "http";
          const host = (c.domain || "").replace(/^\./, "");
          if (!host) continue;
          await ses.cookies.remove(`${proto}://${host}${c.path || "/"}`, c.name);
        }
      } catch (e) {
        console.error(`[cfapp] cf_clearance purge failed: ${e.message}`);
      }
      // Rewrite the file so the new UA is pinned immediately, even before
      // the next Set-Cookie event arrives.
      await syncCfCookiesToFile();
    }
  } catch {}
}

let lastClearancePurgeAt = 0;
let clearanceSolverWindow = null;
let lastSolverLaunchAt = 0;

async function solveClearanceInBackground(reason) {
  // Open a small visible BrowserWindow on persist:cf and navigate it to
  // codeforces.com. Cloudflare serves the interstitial; Turnstile JS runs,
  // pulls challenge.cloudflare.com assets, and writes a fresh cf_clearance
  // into the partition's cookie store. We then close the window.
  //
  // The window MUST be visible (not show:false) — Chromium pauses/throttles
  // JS timers on hidden windows, and Turnstile relies on setTimeout/rAF
  // tick rates that get strangled below ~1Hz when hidden. The window starts
  // tucked into a 1x1 corner so it's nearly invisible; if Turnstile is still
  // running after 10s we resize it so the user can see what's happening.
  if (Date.now() - lastSolverLaunchAt < 60_000) {
    console.log(`[cfapp] solver throttled (cooldown)`);
    return;
  }
  lastSolverLaunchAt = Date.now();
  if (clearanceSolverWindow && !clearanceSolverWindow.isDestroyed()) {
    console.log(`[cfapp] solver already running`);
    return;
  }
  try {
    console.log(`[cfapp] launching background clearance solver: ${reason}`);
    const win = new BrowserWindow({
      // Tiny, in the bottom-right corner — visible to Chromium but easy to
      // miss. Will get resized later if Turnstile takes too long.
      width: 200,
      height: 80,
      x: 10,
      y: 10,
      show: true,
      frame: false,
      skipTaskbar: true,
      alwaysOnTop: false,
      focusable: false,
      title: "cfapp — refreshing CF access…",
      webPreferences: {
        partition: "persist:cf",
        nodeIntegration: false,
        contextIsolation: true,
      },
    });
    clearanceSolverWindow = win;
    const ses = session.fromPartition("persist:cf");
    let done = false;
    let resizeTimer = null;
    let hardTimer = null;
    const cleanup = (reason) => {
      if (done) return;
      done = true;
      console.log(`[cfapp] solver closing: ${reason}`);
      if (resizeTimer) clearTimeout(resizeTimer);
      if (hardTimer) clearTimeout(hardTimer);
      try { ses.cookies.off("changed", onChanged); } catch {}
      try { if (!win.isDestroyed()) win.close(); } catch {}
      clearanceSolverWindow = null;
    };
    const onChanged = (_e, cookie) => {
      if (cookie?.name === "cf_clearance" && /(^|\.)codeforces\.com$/i.test(cookie.domain || "")) {
        console.log(`[cfapp] solver got fresh cf_clearance`);
        // Sync to disk now so /api/* recovers immediately rather than
        // waiting for the debounced cookie-sync timer.
        syncCfCookiesToFile().catch(() => {});
        cleanup("got cf_clearance");
      }
    };
    ses.cookies.on("changed", onChanged);
    // If Turnstile is still running after 10s, surface the window so the
    // user can see the interstitial / click the checkbox if needed.
    resizeTimer = setTimeout(() => {
      try {
        if (!win.isDestroyed()) {
          console.log(`[cfapp] solver still working after 10s — making visible`);
          win.setSize(500, 400);
          win.center();
          win.setTitle("cfapp — Cloudflare verification");
        }
      } catch {}
    }, 10_000);
    // Hard timeout — if Turnstile never finishes, don't leak the window.
    hardTimer = setTimeout(() => cleanup("30s timeout"), 30_000);
    // If the user closes the surfaced window manually, treat it as done.
    win.on("closed", () => cleanup("window closed"));
    win.webContents.on("did-fail-load", (_e, code, desc, url) => {
      console.log(`[cfapp] solver nav fail ${code} ${desc} @ ${url}`);
    });
    win.webContents.on("did-finish-load", () => {
      console.log(`[cfapp] solver nav finished — Turnstile may still be in flight`);
    });
    try {
      await win.loadURL("https://codeforces.com/");
    } catch (e) {
      console.error(`[cfapp] solver loadURL threw: ${e.message}`);
      // Don't cleanup yet — loadURL throws on non-2xx but Turnstile is
      // typically served with 403 + HTML, and the JS still runs.
    }
  } catch (e) {
    console.error(`[cfapp] solver launch failed: ${e.message}`);
    clearanceSolverWindow = null;
  }
}

// Cooldown so a burst of 403s (parallel requests, retries, fetch chains) only
// triggers one cookie wipe. 30s is short enough that a genuinely revoked
// clearance gets cleaned up quickly, long enough that we don't thrash.
async function purgeClearanceCookies(reason) {
  if (Date.now() - lastClearancePurgeAt < 30_000) return;
  lastClearancePurgeAt = Date.now();
  try {
    const ses = session.fromPartition("persist:cf");
    const cookies = await ses.cookies.get({ name: "cf_clearance" });
    if (cookies.length === 0) return;
    console.log(`[cfapp] purging cf_clearance (${cookies.length}): ${reason}`);
    for (const c of cookies) {
      const proto = c.secure ? "https" : "http";
      const host = (c.domain || "").replace(/^\./, "");
      if (!host) continue;
      try {
        await ses.cookies.remove(`${proto}://${host}${c.path || "/"}`, c.name);
      } catch {}
    }
    // Push the change to the on-disk cookie file so server-side calls see
    // the missing cf_clearance immediately, instead of waiting for the
    // debounced "changed" event to flush.
    await syncCfCookiesToFile();
    // Don't just delete and wait — kick off a background nav that lets
    // Turnstile JS issue a fresh clearance, so the user isn't stranded.
    solveClearanceInBackground(`after purge: ${reason}`);
  } catch (e) {
    console.error(`[cfapp] cf_clearance purge failed: ${e.message}`);
  }
}

async function probeAndPurgeBadClearance() {
  // Make a quick request to codeforces.com from the persist:cf session and
  // see if CF accepts our current cf_clearance. A 403 from CF's edge means
  // the cookie has been revoked — keeping it just locks every future
  // request out. Drop cf_clearance so webview re-solves Turnstile once.
  try {
    const ses = session.fromPartition("persist:cf");
    const cookies = await ses.cookies.get({ name: "cf_clearance" });
    if (cookies.length === 0) return; // nothing to probe
    const { net: electronNet } = require("electron");
    const status = await new Promise((resolve) => {
      const req = electronNet.request({
        method: "GET",
        url: "https://codeforces.com/",
        session: ses,
        useSessionCookies: true,
        redirect: "manual",
      });
      req.setHeader("User-Agent", CF_USER_AGENT);
      req.setHeader("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
      req.setHeader("Accept-Language", "en-US,en;q=0.9");
      let settled = false;
      const finish = (code) => { if (!settled) { settled = true; resolve(code); } };
      req.on("response", (r) => { finish(r.statusCode); r.on("data", () => {}); r.on("end", () => {}); });
      req.on("error", () => finish(0));
      req.on("abort", () => finish(0));
      setTimeout(() => { try { req.abort(); } catch {} finish(0); }, 8000);
      req.end();
    });
    if (status === 403) {
      await purgeClearanceCookies("probe got 403");
    }
  } catch (e) {
    console.error(`[cfapp] clearance probe failed: ${e.message}`);
  }
}

function attachCookieSync() {
  const ses = session.fromPartition("persist:cf");
  // Pin the partition UA so the cf_clearance Cloudflare hands out is bound
  // to this exact UA — and so the server can replay it without triggering
  // a fresh challenge.
  try { ses.setUserAgent(CF_USER_AGENT); } catch {}
  // Electron's default Sec-CH-UA brands include `"Electron";v="42"`, which
  // Cloudflare uses to flag the visitor as a bot. We can't simply rewrite
  // the header to a fake Chrome value: navigator.userAgentData inside the
  // webview still reports Electron, so CF's JS challenge compares the two
  // and revokes cf_clearance once it spots the lie. Safer choice: DELETE
  // the client-hint headers on CF requests entirely. Missing hints look
  // like a legacy/non-Chromium client, which CF falls back on UA for —
  // no contradiction to detect.
  try {
    ses.webRequest.onBeforeSendHeaders((details, cb) => {
      const h = details.requestHeaders;
      const host = (() => { try { return new URL(details.url).hostname; } catch { return ""; } })();
      if (/(^|\.)codeforces\.com$/i.test(host) || /(^|\.)cloudflare\.com$/i.test(host)) {
        h["User-Agent"] = CF_USER_AGENT;
        delete h["sec-ch-ua"];
        delete h["Sec-CH-UA"];
        delete h["sec-ch-ua-mobile"];
        delete h["Sec-CH-UA-Mobile"];
        delete h["sec-ch-ua-platform"];
        delete h["Sec-CH-UA-Platform"];
        delete h["sec-ch-ua-full-version-list"];
        delete h["Sec-CH-UA-Full-Version-List"];
        delete h["X-DevTools-Emulate-Network-Conditions-Client-Id"];
      }
      cb({ requestHeaders: h });
    });
  } catch (e) {
    console.error(`[cfapp] header rewrite hook failed: ${e.message}`);
  }
  // Catch mid-session cf_clearance revocation: any 403 from a codeforces.com
  // request inside the webview means the edge rejected our clearance cookie.
  // Drop it so the next CF navigation triggers a fresh Turnstile challenge,
  // instead of leaving the user stuck behind 403s until they manually reload.
  try {
    ses.webRequest.onHeadersReceived((details, cb) => {
      try {
        const host = (() => { try { return new URL(details.url).hostname; } catch { return ""; } })();
        if (details.statusCode === 403 && /(^|\.)codeforces\.com$/i.test(host)) {
          // Fire-and-forget — don't block the response.
          purgeClearanceCookies(`webview 403 on ${host}`);
        }
      } catch {}
      cb({});
    });
  } catch (e) {
    console.error(`[cfapp] response hook failed: ${e.message}`);
  }
  let pending = false;
  // Debounce — CF login fires several Set-Cookie events in quick succession.
  ses.cookies.on("changed", (_e, cookie) => {
    if (!/(^|\.)codeforces\.com$/i.test(cookie.domain || "")) return;
    if (pending) return;
    pending = true;
    setTimeout(() => { pending = false; syncCfCookiesToFile(); }, 300);
  });
}

function waitForPort(port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const sock = net.createConnection({ host: "127.0.0.1", port });
      sock.once("connect", () => { sock.destroy(); resolve(); });
      sock.once("error", () => {
        sock.destroy();
        if (Date.now() > deadline) reject(new Error(`port ${port} never opened`));
        else setTimeout(tryOnce, 200);
      });
    };
    tryOnce();
  });
}

function startBun() {
  // Spawn `bun run src/server.ts` from the repo root. Inherit stdio so logs
  // go to the same terminal Electron was launched from.
  const SERVER_ENTRY = IS_PACKAGED ? "src/server-prod.ts" : "src/server.ts";
  bunProc = spawn(BUN_PATH, ["run", SERVER_ENTRY], {
    cwd: REPO_ROOT,
    env: { ...process.env, PORT: String(PORT), ...(IS_PACKAGED ? { NODE_ENV: "production" } : {}) },
    stdio: "inherit",
  });
  bunProc.on("exit", (code) => {
    console.log(`[cfapp] bun server exited (${code})`);
    // If the server dies, kill the window so we don't leave a useless app open.
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: "cfapp",
    autoHideMenuBar: true,
    webPreferences: {
      // <webview> is required for embedded CF pages.
      webviewTag: true,
      // We don't expose any Node APIs to the renderer — the UI is plain
      // React talking to the Bun HTTP API. Keeping these off matches a
      // normal browser security model.
      nodeIntegration: false,
      contextIsolation: true,
      // Bridges window.cfapp.logoutCf() to ipcMain.handle below.
      preload: path.join(__dirname, "preload.cjs"),
    },
  });
  // Clear only the HTTP cache (not cookies/localStorage) before loading. All
  // assets come from the local Bun server, so re-fetching costs nothing, and
  // this guarantees runtime-generated resources like /fonts/fonts.css are never
  // shadowed by a stale cached copy after fonts are added. Without this, new
  // font picks render as "回退" until the old cache entry expires.
  try { await mainWindow.webContents.session.clearCache(); } catch {}
  await mainWindow.loadURL(`http://127.0.0.1:${PORT}/`);
}

// Logout: clear the persist:cf partition so cf_clearance, JSESSIONID,
// X-User, the lot, are wiped. Also delete the cookie file the server uses
// for API calls (the server clears its own copy in /api/auth/logout, this
// is belt + suspenders for the case where the renderer calls the IPC alone).
ipcMain.handle("cfapp:logout-cf", async () => {
  try {
    const ses = session.fromPartition("persist:cf");
    await ses.clearStorageData({ storages: ["cookies", "localstorage", "indexdb", "websql", "serviceworkers", "cachestorage"] });
    try { fs.unlinkSync(COOKIE_FILE); } catch {}
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

app.whenReady().then(async () => {
  // Drop the default File/Edit/View/Window menubar — this is a single-page
  // app and the Chromium menu offers nothing useful (and clutters the chrome).
  try { Menu.setApplicationMenu(null); } catch {}
  startBun();
  try {
    await waitForPort(PORT);
  } catch (e) {
    console.error(`[cfapp] ${e.message}`);
    app.quit();
    return;
  }
  attachCookieSync();
  // Purge stale cf_clearance BEFORE the window opens so webview doesn't
  // send a cookie issued under an older UA (which would trigger a CF loop).
  await purgeStaleClearance();
  // Also probe whether the current cf_clearance is actually accepted by CF.
  // If it's been revoked (mid-session revocation, fingerprint drift, etc.)
  // and we still send it, CF returns 403 on every request. Better to drop
  // it now and let webview re-solve Turnstile once.
  await probeAndPurgeBadClearance();
  await syncCfCookiesToFile();
  await createWindow();

  // Periodically re-probe — CF can revoke cf_clearance mid-session (fingerprint
  // drift, Turnstile re-check fail, etc). Server-side /api/* calls won't trigger
  // the webview's onHeadersReceived hook, so they'd stay locked out until the
  // user manually loads a CF page. 60s is short enough to recover quickly
  // without being noisy — purge has its own 30s cooldown so we won't thrash.
  setInterval(() => { probeAndPurgeBadClearance(); }, 60 * 1000);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (bunProc && !bunProc.killed) bunProc.kill("SIGTERM");
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (bunProc && !bunProc.killed) bunProc.kill("SIGTERM");
});
