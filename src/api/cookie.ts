// CookieJar + the curl-based fetch transport used to defeat Cloudflare's
// JA3 fingerprinting on codeforces.com. Everything CF-bound is routed through
// `jarFetch`/`jarFetchViaCurl`; non-CF traffic (AI translate, fonts) uses
// plain bun fetch via withNetworkOptions.
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { CFConfig } from "../config";
import type { BunFetchInit, SavedCookie, SavedCookieFile } from "./types";
import { UA, withNetworkOptions } from "./net";

export const CODEFORCES_COOKIE_FILE = join(homedir(), ".config", "cfapp", "codeforces-cookies.json");

export class CookieJar {
  private store = new Map<string, SavedCookie>();
  private userAgentValue?: string;

  constructor(userAgent?: string) {
    this.userAgentValue = userAgent;
  }

  static fromCookieHeader(cookieHeader: string, userAgent?: string): CookieJar {
    const jar = new CookieJar(userAgent);
    for (const part of cookieHeader.split(/;\s*/)) {
      const eq = part.indexOf("=");
      if (eq <= 0) continue;
      const name = part.slice(0, eq).trim();
      const value = part.slice(eq + 1).trim();
      if (name && value) jar.store.set(name, { name, value, domain: ".codeforces.com", path: "/" });
    }
    return jar;
  }

  static fromCookies(cookies: SavedCookie[], userAgent?: string): CookieJar {
    const jar = new CookieJar(userAgent);
    jar.mergeCookies(cookies);
    return jar;
  }

  setUserAgent(userAgent: string | undefined) {
    this.userAgentValue = userAgent?.trim() || undefined;
  }

  userAgent(): string {
    return this.userAgentValue || UA;
  }

  ingest(setCookieHeader: string | null) {
    if (!setCookieHeader) return;
    // Bun coalesces multiple Set-Cookie into one comma-joined string. Splitting
    // naively breaks on commas inside `Expires=...`, so we split on ", " only
    // when the next token looks like `name=`.
    const parts = setCookieHeader.split(/, (?=[A-Za-z0-9_!#$%&'*+\-.^`|~]+=)/);
    for (const part of parts) {
      const segments = part.split(";").map((seg) => seg.trim()).filter(Boolean);
      const pair = segments[0];
      if (!pair) continue;
      const eq = pair.indexOf("=");
      if (eq <= 0) continue;
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      if (value === "" || value === "deleted") {
        this.store.delete(name);
        continue;
      }

      const existing = this.store.get(name);
      const cookie: SavedCookie = { ...(existing ?? {}), name, value };
      let deleteCookie = false;
      for (const attr of segments.slice(1)) {
        const attrEq = attr.indexOf("=");
        const key = (attrEq === -1 ? attr : attr.slice(0, attrEq)).toLowerCase();
        const attrValue = attrEq === -1 ? "" : attr.slice(attrEq + 1);
        if (key === "domain") cookie.domain = attrValue;
        else if (key === "path") cookie.path = attrValue;
        else if (key === "expires") {
          const time = Date.parse(attrValue);
          if (Number.isFinite(time)) cookie.expires = time / 1000;
        } else if (key === "max-age") {
          const maxAge = Number(attrValue);
          if (Number.isFinite(maxAge)) {
            if (maxAge <= 0) {
              this.store.delete(name);
              deleteCookie = true;
              break;
            }
            cookie.expires = Math.floor(Date.now() / 1000) + maxAge;
          }
        } else if (key === "secure") cookie.secure = true;
        else if (key === "httponly") cookie.httpOnly = true;
      }
      if (deleteCookie) continue;
      this.store.set(name, cookie);
    }
  }

  ingestHeaders(headers: Headers) {
    const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
    const setCookies = typeof getSetCookie === "function" ? getSetCookie.call(headers) : [];
    if (setCookies.length > 0) {
      for (const setCookie of setCookies) this.ingest(setCookie);
      return;
    }
    this.ingest(headers.get("set-cookie"));
  }

  mergeCookies(cookies: SavedCookie[]) {
    const nowSeconds = Date.now() / 1000;
    for (const cookie of cookies) {
      if (cookie.expires && cookie.expires > 0 && cookie.expires < nowSeconds) continue;
      if (cookie.name && cookie.value) this.store.set(cookie.name, { ...cookie });
    }
  }

  isEmpty(): boolean {
    return this.store.size === 0;
  }

  header(): string {
    return [...this.store.values()].map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
  }

  toCookies(): SavedCookie[] {
    return [...this.store.values()].map((cookie) => ({ ...cookie }));
  }

  deleteCookie(name: string): boolean {
    return this.store.delete(name);
  }

  hasCookie(name: string): boolean {
    return this.store.has(name);
  }
}

// Re-export for callers that imported withNetworkOptions from ./api directly.
export { withNetworkOptions };
export type { BunFetchInit };

export async function jarFetch(
  jar: CookieJar,
  url: string,
  init: RequestInit = {},
  config?: CFConfig
): Promise<Response> {
  const host = new URL(url).hostname;
  // Cloudflare bot management on codeforces.com fingerprints the TLS
  // handshake (JA3). Bun's fetch (and Node's, Deno's) all have a
  // recognizable non-Chrome JA3 and get hit with the "Just a moment"
  // challenge — even with a real cf_clearance cookie. curl's JA3 happens
  // to pass. Route CF traffic through a curl subprocess; everything else
  // (AI translate, fonts) goes through bun fetch.
  if (/(^|\.)codeforces\.com$/i.test(host)) {
    return jarFetchViaCurl(jar, url, init, config);
  }
  const headers = new Headers(init.headers);
  if (!headers.has("User-Agent")) headers.set("User-Agent", jar.userAgent());
  if (!headers.has("Accept"))
    headers.set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
  if (!headers.has("Accept-Language")) headers.set("Accept-Language", "en-US,en;q=0.9");
  const cookie = jar.header();
  if (cookie) headers.set("Cookie", cookie);
  const resp = await fetch(url, withNetworkOptions(config, { ...init, headers, redirect: "manual" }));
  jar.ingestHeaders(resp.headers);
  if (resp.status >= 300 && resp.status < 400 && resp.headers.get("location")) {
    const next = new URL(resp.headers.get("location")!, url).toString();
    return jarFetch(jar, next, { ...init, method: "GET", body: undefined }, config);
  }
  return resp;
}

// curl-driven fetch for CF. Returns a real Response (via new Response()).
// Final URL after redirects is patched onto the object so callers that
// branch on resp.url (validateCodeforcesSession, the submit flow) still
// work. Each hop re-ingests Set-Cookie into the jar.
export async function jarFetchViaCurl(
  jar: CookieJar,
  url: string,
  init: RequestInit = {},
  config?: CFConfig,
  hop = 0,
): Promise<Response> {
  if (hop > 8) throw new Error("Too many redirects");
  // CF fingerprints header casing — `user-agent:` (lowercase, what Headers
  // normalizes to) trips the bot check; `User-Agent:` (real-Chrome casing)
  // passes. Build the header list from a plain object so we keep the case
  // we send. Callers can override with raw entries via init.headers.
  const baseHeaders: Array<[string, string]> = [
    ["User-Agent", jar.userAgent()],
    ["Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"],
    ["Accept-Language", "en-US,en;q=0.9"],
  ];
  const haveBase = new Set(baseHeaders.map((h) => h[0].toLowerCase()));
  const extraHeaders: Array<[string, string]> = [];
  if (init.headers) {
    // Preserve incoming case if caller used a plain object; only fall back
    // to lowercased Headers iteration when it's a Headers instance.
    if (init.headers instanceof Headers) {
      for (const [k, v] of (init.headers as any).entries() as IterableIterator<[string, string]>) {
        if (k.toLowerCase() === "cookie") continue;
        if (haveBase.has(k.toLowerCase())) continue;
        extraHeaders.push([k, v]);
      }
    } else if (Array.isArray(init.headers)) {
      for (const [k, v] of init.headers as Array<[string, string]>) {
        if (k.toLowerCase() === "cookie") continue;
        if (haveBase.has(k.toLowerCase())) continue;
        extraHeaders.push([k, v]);
      }
    } else {
      for (const [k, v] of Object.entries(init.headers as Record<string, string>)) {
        if (k.toLowerCase() === "cookie") continue;
        if (haveBase.has(k.toLowerCase())) continue;
        extraHeaders.push([k, v]);
      }
    }
  }

  const args: string[] = [
    "-sS",
    "-i",
    "--http1.1",
    "--max-time", "30",
    "--connect-timeout", "10",
    "--compressed",
  ];
  if (config?.proxy?.trim()) { args.push("--proxy", config.proxy.trim()); }
  if (config && config.verifySsl === false) { args.push("-k"); }
  const method = (init.method || "GET").toUpperCase();
  if (method !== "GET") args.push("-X", method);
  for (const [k, v] of [...baseHeaders, ...extraHeaders]) {
    args.push("-H", `${k}: ${v}`);
  }
  const cookieHeader = jar.header();
  if (cookieHeader) args.push("--cookie", cookieHeader);
  const body = init.body;
  if (body != null && method !== "GET" && method !== "HEAD") {
    if (typeof body === "string") {
      args.push("--data-binary", body);
    } else if (body instanceof URLSearchParams) {
      args.push("--data-binary", body.toString());
      const hasCT = baseHeaders.some(([k]) => k.toLowerCase() === "content-type")
        || extraHeaders.some(([k]) => k.toLowerCase() === "content-type");
      if (!hasCT) args.push("-H", "Content-Type: application/x-www-form-urlencoded");
    } else {
      args.push("--data-binary", String(body));
    }
  }
  args.push(url);

  const proc = Bun.spawn(["curl", ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdoutBuf, stderrBuf, exitCode] = await Promise.all([
    new Response(proc.stdout).arrayBuffer(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`curl exit ${exitCode}: ${stderrBuf.trim().slice(0, 200)}`);
  }
  // Some curl invocations emit multiple header blocks (HTTP/1.1 100 Continue,
  // proxy CONNECT, …). Find the *last* status line and parse from there.
  const raw = new Uint8Array(stdoutBuf);
  const text = new TextDecoder("latin1").decode(raw); // latin1 keeps byte-level fidelity for the boundary search
  let idx = 0;
  let headerStart = 0;
  let bodyStart = -1;
  while (true) {
    const pivot = text.indexOf("\r\n\r\n", idx);
    if (pivot < 0) break;
    const next = pivot + 4;
    // If the block starts with HTTP/ and the next status line follows immediately, this is an interim block.
    const looksLikeNextStatus = /^HTTP\/[0-9.]+\s+1\d\d\s/.test(text.slice(next));
    if (looksLikeNextStatus) {
      headerStart = next;
      idx = next;
      continue;
    }
    bodyStart = next;
    break;
  }
  if (bodyStart < 0) {
    throw new Error("curl returned no header/body separator");
  }
  const headerBlock = text.slice(headerStart, bodyStart - 4);
  const bodyBytes = raw.slice(new TextEncoder().encode(text.slice(0, bodyStart)).length);

  const lines = headerBlock.split(/\r?\n/);
  const statusLine = lines[0] ?? "";
  const m = statusLine.match(/^HTTP\/[0-9.]+\s+(\d{3})/);
  if (!m || !m[1]) throw new Error(`curl: unexpected status line: ${statusLine.slice(0, 80)}`);
  const status = Number(m[1]);
  const respHeaders = new Headers();
  const setCookies: string[] = [];
  for (const line of lines.slice(1)) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const name = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (!name) continue;
    if (name.toLowerCase() === "set-cookie") {
      setCookies.push(value);
    } else {
      // Headers.append handles dup keys correctly.
      respHeaders.append(name, value);
    }
  }
  // Feed cookies into the jar one by one.
  for (const sc of setCookies) jar.ingest(sc);

  if (status >= 300 && status < 400) {
    const loc = respHeaders.get("location");
    if (loc) {
      const next = new URL(loc, url).toString();
      // Drop body on redirect, switch to GET (standard browser behavior).
      return jarFetchViaCurl(jar, next, { ...init, method: "GET", body: undefined }, config, hop + 1);
    }
  }

  // Response constructor disallows body for 1xx/204/304. Pass `null` for those.
  const noBody = status === 204 || status === 304 || (status >= 100 && status < 200);
  const resp = new Response(noBody ? null : bodyBytes, { status, headers: respHeaders });
  // Patch resp.url since Response.url is read-only by default.
  Object.defineProperty(resp, "url", { value: url, configurable: true });
  return resp;
}

function loadCookieFile(): SavedCookieFile | null {
  if (!existsSync(CODEFORCES_COOKIE_FILE)) return null;
  try {
    const data = JSON.parse(readFileSync(CODEFORCES_COOKIE_FILE, "utf-8")) as SavedCookieFile;
    if (!Array.isArray(data.cookies)) return null;
    return data;
  } catch {
    return null;
  }
}

export function loadCodeforcesCookieJar(): CookieJar {
  const data = loadCookieFile();
  return data ? CookieJar.fromCookies(data.cookies, data.userAgent) : new CookieJar();
}

function writeCookieFile(cookies: SavedCookie[], source: string, userAgent?: string): void {
  mkdirSync(join(homedir(), ".config", "cfapp"), { recursive: true });
  const data: SavedCookieFile = {
    version: 1,
    savedAt: Date.now(),
    source,
    userAgent: userAgent?.trim() || undefined,
    cookies,
  };
  writeFileSync(CODEFORCES_COOKIE_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
  try {
    chmodSync(CODEFORCES_COOKIE_FILE, 0o600);
  } catch {
    // Best effort. Some filesystems ignore chmod.
  }
}

export function saveCodeforcesCookieJar(jar: CookieJar, source = "runtime"): void {
  writeCookieFile(jar.toCookies(), source, jar.userAgent());
}

export function saveCodeforcesCookieHeader(cookieHeader: string, source = "manual", userAgent?: string): void {
  saveCodeforcesCookieJar(CookieJar.fromCookieHeader(cookieHeader, userAgent), source);
}

export function saveCodeforcesCookies(cookies: SavedCookie[], source = "browser-cdp", userAgent?: string): void {
  writeCookieFile(cookies, source, userAgent);
}
