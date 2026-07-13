// CF page HTML detection: CSRF, login state, Cloudflare challenge, handle.
import type { CFConfig } from "../../config";
import { decodeEntities, htmlAttr } from "./text";

// Locate a <div class="…X…">…</div> using bracket-balanced depth counting.
export function locateClassDiv(
  content: string,
  className: string
): { start: number; end: number; innerStart: number; innerEnd: number } | null {
  const re = new RegExp(`<div[^>]*class="[^"]*\\b${className}\\b[^"]*"[^>]*>`);
  const m = content.match(re);
  if (!m || m.index === undefined) return null;
  const start = m.index;
  const innerStart = start + m[0].length;
  let depth = 1, j = innerStart;
  while (j < content.length && depth > 0) {
    if (content.startsWith("<div", j)) { depth++; j += 4; }
    else if (content.startsWith("</div>", j)) {
      depth--;
      if (depth === 0) return { start, end: j + 6, innerStart, innerEnd: j };
      j += 6;
    } else j++;
  }
  return null;
}

export function plainText(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

export function diagSnippet(html: string): string {
  const t = html.replace(/\s+/g, " ").trim().slice(0, 220);
  return t || "(empty body)";
}

export function isCloudflareChallenge(status: number, html: string): boolean {
  return (
    status === 403 &&
    /Just a moment|challenges\.cloudflare\.com|cf-chl|cf_clearance/i.test(html)
  );
}

export function isCodeforcesLoginPage(url: string, html: string): boolean {
  return url.includes("/enter") || /name=["']handleOrEmail["']|action=["']enter["']/i.test(html);
}

export function findCsrf(html: string): string | null {
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const raw = tag[0];
    const name = htmlAttr(raw, "name");
    if (name?.toLowerCase() === "x-csrf-token") {
      const content = htmlAttr(raw, "content");
      if (content) return content;
    }
  }
  for (const tag of html.matchAll(/<input\b[^>]*>/gi)) {
    const raw = tag[0];
    const name = htmlAttr(raw, "name");
    if (name === "csrf_token") {
      const value = htmlAttr(raw, "value");
      if (value) return value;
    }
  }
  return (
    html.match(/name=["']X-Csrf-Token["']\s+content=["']([^"']+)["']/)?.[1] ??
    html.match(/name=["']csrf_token["']\s+value=["']([^"']+)["']/)?.[1] ??
    html.match(/data-csrf=["']([0-9a-fA-F]{32})["']/)?.[1] ??
    null
  );
}

export function extractInputFields(html: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const tag of html.matchAll(/<input\b[^>]*>/gi)) {
    const raw = tag[0];
    const name = htmlAttr(raw, "name");
    if (!name) continue;
    const type = htmlAttr(raw, "type")?.toLowerCase() ?? "";
    if (type && !["hidden", "submit", "text"].includes(type)) continue;
    fields[name] = htmlAttr(raw, "value") ?? "";
  }
  return fields;
}

export function cfAuthError(config: CFConfig): string {
  const proxy = config.proxy?.trim() ? ` using proxy ${config.proxy.trim()}` : "";
  return `Codeforces returned Cloudflare verification${proxy}. Run \`bun run auth\` in a terminal, finish browser login once, then retry.`;
}

// Extract the currently-logged-in CF handle from any HTML page.
//
// CF embeds the viewer's own handle in an inline bootstrap script on every
// page: `var handle = "theirHandle";`. That is the ONLY unambiguous signal —
// it is the logged-in user, full stop. We read it first.
//
// The old heuristic ("most-frequent /profile/X link") is unreliable: pages
// like /settings/general carry a recent-actions / streams sidebar full of
// OTHER users' profile links. A prolific poster (e.g. a Legendary GM) can
// out-number the viewer's own header links and get mis-detected as the
// logged-in account. We keep frequency only as a last-ditch fallback.
export function extractLoggedInHandle(html: string): string | null {
  // Primary: the inline `var handle = "..."` bootstrap. Tolerate single or
  // double quotes and arbitrary whitespace around the `=`.
  const inline = html.match(/\bvar\s+handle\s*=\s*["']([A-Za-z0-9_\-]+)["']/);
  if (inline && inline[1]) return inline[1];

  // Fallback: most-frequent /profile/ link. Only reached on pages without the
  // bootstrap script; imperfect, but better than nothing.
  const profileRe = /\/profile\/([A-Za-z0-9_\-]+)/g;
  const counts = new Map<string, number>();
  let m: RegExpExecArray | null;
  while ((m = profileRe.exec(html)) !== null) {
    const h = m[1];
    if (!h) continue;
    counts.set(h, (counts.get(h) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  let best: string | null = null, bestN = 0;
  for (const [h, n] of counts) {
    if (n > bestN) { best = h; bestN = n; }
  }
  return best;
}
