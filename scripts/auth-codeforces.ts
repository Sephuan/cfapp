#!/usr/bin/env bun
import { spawn } from "child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "fs";
import { join, relative } from "path";
import { homedir } from "os";
import { createInterface } from "readline/promises";
import { stdin as input, stdout as output } from "process";
import { loadConfig } from "../src/config";
import {
  CODEFORCES_COOKIE_FILE,
  CookieJar,
  saveCodeforcesCookieHeader,
  saveCodeforcesCookies,
  type SavedCookie,
  validateCodeforcesSession,
} from "../src/api";

const AUTH_URL = "https://codeforces.com/enter";
const CANDIDATE_BROWSERS = [
  "google-chrome-stable",
  "google-chrome",
  "chromium",
  "chromium-browser",
  "brave-browser",
  "microsoft-edge",
  "vivaldi",
];

type CdpCookie = SavedCookie & {
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
};

interface BrowserCookies {
  cookies: SavedCookie[];
  userAgent?: string;
}

function usage(): void {
  console.log(`Usage:
  bun run auth
  bun run auth --isolated
  bun run auth --default-profile
  bun run auth --clone-default-profile
  bun run auth --manual
  bun run auth --cookie "JSESSIONID=...; 39ce7=...; cf_clearance=..."
  bun run auth --cookie "..." --user-agent "Mozilla/5.0 ..."

Default mode copies the auth-relevant parts of your normal Chrome profile into
a cfapp-owned temp profile, reads Codeforces cookies through DevTools, then
stores them in:
  ${CODEFORCES_COOKIE_FILE}

--isolated launches a clean cfapp Chrome profile and asks you to log in there.

--default-profile uses your normal Chrome profile instead of an isolated cfapp
profile. Close existing Chrome windows first if DevTools cannot start.

--clone-default-profile is an explicit alias for the default behavior.`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findExecutable(name: string): string | null {
  if (name.includes("/")) return existsSync(name) ? name : null;
  const pathEnv = process.env.PATH ?? "";
  for (const dir of pathEnv.split(":")) {
    if (!dir) continue;
    const full = join(dir, name);
    if (existsSync(full)) return full;
  }
  return null;
}

function findBrowser(): string | null {
  const envBrowser = process.env.BROWSER ? [process.env.BROWSER] : [];
  for (const candidate of [...envBrowser, ...CANDIDATE_BROWSERS]) {
    const found = findExecutable(candidate);
    if (found) return found;
  }
  return null;
}

function findChromeUserDataDir(): string | null {
  const candidates = [
    process.env.CHROME_USER_DATA_DIR,
    join(homedir(), ".config", "google-chrome"),
    join(homedir(), ".config", "chromium"),
    join(homedir(), ".var", "app", "com.google.Chrome", "config", "google-chrome"),
    join(homedir(), ".var", "app", "org.chromium.Chromium", "config", "chromium"),
  ].filter(Boolean) as string[];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function findChromeProfileDirectory(userDataDir: string): string {
  const preferred = process.env.CHROME_PROFILE_DIRECTORY;
  if (preferred && existsSync(join(userDataDir, preferred))) return preferred;
  const candidates = ["Default", "Profile 1", "Profile 2", "Profile 3"];
  return candidates.find((candidate) => existsSync(join(userDataDir, candidate))) ?? "Default";
}

function cloneDefaultChromeProfile(destination: string): string {
  const source = findChromeUserDataDir();
  if (!source) throw new Error("Could not find a Chrome user data directory");
  const profileDirectory = findChromeProfileDirectory(source);
  if (!existsSync(join(source, profileDirectory))) {
    throw new Error(`Chrome profile directory not found: ${join(source, profileDirectory)}`);
  }

  const skipParts = new Set([
    "BrowserMetrics",
    "Cache",
    "Code Cache",
    "Crashpad",
    "DawnCache",
    "Extensions",
    "Extension Rules",
    "Extension Scripts",
    "Extension State",
    "GPUCache",
    "GrShaderCache",
    "Safe Browsing",
    "Safe Browsing Network",
    "ShaderCache",
    "Service Worker",
    "Storage",
    "component_crx_cache",
  ]);
  const skipFiles = new Set([
    "Bookmarks",
    "Favicons",
    "History",
    "History-journal",
    "Login Data",
    "Login Data For Account",
    "Login Data For Account-journal",
    "Login Data-journal",
    "Top Sites",
    "Visited Links",
    "Web Data",
    "Web Data-journal",
  ]);

  rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });
  cpSync(source, destination, {
    recursive: true,
    force: true,
    errorOnExist: false,
    filter: (sourcePath) => {
      const rel = relative(source, sourcePath);
      if (!rel) return true;
      if (rel === "Local State") return true;
      if (rel !== profileDirectory && !rel.startsWith(`${profileDirectory}/`)) return false;
      const parts = rel.split("/");
      if (parts.some((part) => skipParts.has(part))) return false;
      if (skipFiles.has(parts[parts.length - 1] ?? "")) return false;
      return true;
    },
  });
  return profileDirectory;
}

async function requestJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.json() as Promise<T>;
}

async function waitForCdp(port: number): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      await requestJson(`http://127.0.0.1:${port}/json/version`);
      return;
    } catch {
      await sleep(300);
    }
  }
  throw new Error("Browser DevTools endpoint did not start");
}

async function cdpCommand<T>(
  wsUrl: string,
  method: string,
  params?: Record<string, unknown>
): Promise<T> {
  const ws = new WebSocket(wsUrl);
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", () => reject(new Error("Failed to connect to browser DevTools")), { once: true });
  });

  const id = 1;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`Timed out waiting for ${method}`));
    }, 5_000);
    ws.addEventListener("message", (event) => {
      const data = JSON.parse(String(event.data));
      if (data.id !== id) return;
      clearTimeout(timer);
      ws.close();
      if (data.error) reject(new Error(data.error.message ?? `${method} failed`));
      else resolve(data.result as T);
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error(`Browser DevTools command failed: ${method}`));
    }, { once: true });
  });
}

async function readCookiesFromBrowser(port: number): Promise<BrowserCookies> {
  const pages = await requestJson<Array<{ type: string; webSocketDebuggerUrl?: string }>>(
    `http://127.0.0.1:${port}/json`
  );
  const page = pages.find((p) => p.type === "page" && p.webSocketDebuggerUrl) ?? pages.find((p) => p.webSocketDebuggerUrl);
  if (!page?.webSocketDebuggerUrl) throw new Error("No debuggable browser page found");
  const uaResult = await cdpCommand<{ result?: { value?: string } }>(page.webSocketDebuggerUrl, "Runtime.evaluate", {
    expression: "navigator.userAgent",
    returnByValue: true,
  });
  const result = await cdpCommand<{ cookies: CdpCookie[] }>(page.webSocketDebuggerUrl, "Network.getCookies", {
    urls: ["https://codeforces.com/"],
  });
  return {
    userAgent: uaResult.result?.value,
    cookies: result.cookies
      .filter((cookie) => /(^|\.)codeforces\.com$/i.test(cookie.domain))
      .map((cookie) => ({
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        expires: cookie.expires,
        httpOnly: cookie.httpOnly,
        secure: cookie.secure,
      })),
  };
}

async function saveAndValidate(cookies: SavedCookie[], source: string, userAgent?: string): Promise<boolean> {
  const config = loadConfig();
  const jar = CookieJar.fromCookies(cookies, userAgent);
  const result = await validateCodeforcesSession(config, jar);
  if (!result.ok) {
    console.log(`Not authenticated yet: ${result.error}`);
    return false;
  }
  saveCodeforcesCookies(cookies, source, userAgent);
  console.log(`Authenticated${result.handle ? ` as ${result.handle}` : ""}.`);
  console.log(`Saved cookies to ${CODEFORCES_COOKIE_FILE}`);
  return true;
}

function argValue(args: string[], ...names: string[]): string | undefined {
  for (const name of names) {
    const index = args.indexOf(name);
    if (index !== -1) return args[index + 1];
  }
  return undefined;
}

async function manualMode(cookieHeader?: string, userAgent?: string): Promise<void> {
  let header = cookieHeader?.trim() ?? "";
  if (!header) {
    console.log("Paste the full Codeforces Cookie request header.");
    console.log("It must include HttpOnly cookies such as cf_clearance when Cloudflare is active.");
    const rl = createInterface({ input, output });
    header = (await rl.question("Cookie: ")).trim();
    if (!userAgent) {
      const ua = (await rl.question("User-Agent (optional, Enter to use default): ")).trim();
      userAgent = ua || undefined;
    }
    rl.close();
  }
  if (!header) throw new Error("Cookie header is empty");
  const config = loadConfig();
  const jar = CookieJar.fromCookieHeader(header, userAgent);
  const result = await validateCodeforcesSession(config, jar);
  if (!result.ok) throw new Error(result.error ?? "Cookie validation failed");
  saveCodeforcesCookieHeader(header, "manual", userAgent);
  console.log(`Authenticated${result.handle ? ` as ${result.handle}` : ""}.`);
  console.log(`Saved cookies to ${CODEFORCES_COOKIE_FILE}`);
}

type BrowserProfileMode = "isolated" | "default" | "clone";

async function browserMode(profileMode: BrowserProfileMode = "isolated"): Promise<void> {
  const browser = findBrowser();
  if (!browser) {
    throw new Error(`No Chromium-compatible browser found. Use --manual, or set BROWSER=/path/to/chrome.`);
  }

  const config = loadConfig();
  const port = 30_000 + Math.floor(Math.random() * 10_000);
  const profileDir =
    profileMode === "clone"
      ? join(homedir(), ".config", "cfapp", "auth-browser-from-chrome")
      : join(homedir(), ".config", "cfapp", "auth-browser");
  let profileDirectory: string | undefined;
  if (profileMode === "clone") {
    console.log("Cloning auth-relevant Chrome profile data...");
    profileDirectory = cloneDefaultChromeProfile(profileDir);
  } else if (profileMode === "isolated") {
    mkdirSync(profileDir, { recursive: true });
  }

  const args = [
    "--remote-debugging-address=127.0.0.1",
    `--remote-debugging-port=${port}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--new-window",
  ];
  if (profileMode !== "default") args.push(`--user-data-dir=${profileDir}`);
  if (profileDirectory) args.push(`--profile-directory=${profileDirectory}`);
  if (config.proxy?.trim()) args.push(`--proxy-server=${config.proxy.trim()}`);
  args.push(AUTH_URL);

  console.log(`Launching ${browser}`);
  if (profileMode === "default") {
    console.log("Using your default Chrome profile. If Chrome is already running, close it and retry if this cannot connect.");
  } else if (profileMode === "clone") {
    console.log(`Using cloned Chrome profile ${profileDir}`);
  } else {
    console.log(`Using isolated profile ${profileDir}`);
  }
  if (config.proxy?.trim()) console.log(`Using proxy ${config.proxy.trim()}`);
  console.log("Finish Codeforces login/Cloudflare verification in the browser window.");
  console.log("This script will detect the session and save cookies automatically.");

  const child = spawn(browser, args, { stdio: "ignore" });
  try {
    await waitForCdp(port);

    const deadline = Date.now() + 5 * 60_000;
    let lastCookieCount = 0;
    while (Date.now() < deadline) {
      const browserCookies = await readCookiesFromBrowser(port);
      lastCookieCount = browserCookies.cookies.length;
      if (browserCookies.cookies.some((cookie) => cookie.name === "JSESSIONID" || cookie.name === "cf_clearance")) {
        if (await saveAndValidate(browserCookies.cookies, "browser-cdp", browserCookies.userAgent)) return;
      }
      await sleep(2_000);
    }
    throw new Error(`Timed out waiting for authenticated Codeforces cookies. Last cookie count: ${lastCookieCount}`);
  } finally {
    if (profileMode !== "default") {
      child.kill("SIGTERM");
    }
    if (profileMode === "clone") {
      await sleep(500);
      rmSync(profileDir, { recursive: true, force: true });
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    usage();
    return;
  }
  const userAgent = argValue(args, "--user-agent", "--ua");
  const cookieHeader = argValue(args, "--cookie");
  if (cookieHeader !== undefined) {
    await manualMode(cookieHeader, userAgent);
    return;
  }
  if (args.includes("--manual")) {
    await manualMode(undefined, userAgent);
    return;
  }
  await browserMode(
    args.includes("--default-profile") ? "default" :
    args.includes("--isolated") ? "isolated" :
    "clone"
  );
}

main().catch((error) => {
  console.error(`auth failed: ${error.message}`);
  if (process.argv.includes("--default-profile")) {
    console.error("If Chrome was already open, close all Chrome windows and rerun `bun run auth --default-profile`.");
  }
  console.error("Fallback: run `bun run auth --manual` and paste the Cookie request header from an authenticated Codeforces browser request.");
  process.exitCode = 1;
});
