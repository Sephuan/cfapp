// HTML helpers (entity decoding, tag stripping, attribute extraction, CSRF
// and login-state detection) plus the KaTeX math renderer that powers
// problem-statement and translation rendering.
import katex from "katex";
import type { StatementJSON } from "./types";
import { withNetworkOptions } from "./net";
import type { CFConfig } from "../config";

export function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

export function htmlAttr(tag: string, name: string): string | null {
  const re = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = tag.match(re);
  const raw = match?.[2] ?? match?.[3] ?? match?.[4];
  return raw === undefined ? null : decodeEntities(raw);
}

export function stripTags(html: string): string {
  // Block-level closes get a space so adjacent text doesn't smash together.
  let t = html.replace(/<\/(div|p|h[1-6]|li|tr|td|th)>/gi, " ");
  t = t.replace(/<br\s*\/?>/gi, " ");
  t = t.replace(/<[^>]+>/g, "");
  t = decodeEntities(t);
  return t.replace(/[ \t]+/g, " ").replace(/\s+\n/g, "\n");
}

export function cleanText(html: string): string {
  let t = html;
  // Paragraph boundaries become double-newlines; the renderer wraps each block.
  t = t.replace(/<\/p\s*>/gi, "\n\n");
  t = t.replace(/<p[^>]*>/gi, "");
  // <br> inside CF text is a hard line break; keep it.
  t = t.replace(/<br\s*\/?>/gi, "\n");
  t = t.replace(/<h[1-6][^>]*>/gi, "\n\n");
  t = t.replace(/<\/h[1-6]>/gi, "\n\n");
  t = t.replace(/<sup[^>]*>([\s\S]*?)<\/sup>/gi, (_, m) => toSuperscript(m));
  t = t.replace(/<sub[^>]*>([\s\S]*?)<\/sub>/gi, (_, m) => toSubscript(m));
  t = t.replace(/<pre[^>]*>/gi, "\n");
  t = t.replace(/<\/pre>/gi, "\n");
  t = t.replace(/<code[^>]*>/gi, "`");
  t = t.replace(/<\/code>/gi, "`");
  t = t.replace(/<li[^>]*>/gi, "\n  • ");
  t = t.replace(/<\/li>/gi, "");
  t = t.replace(/<ul[^>]*>/gi, "\n");
  t = t.replace(/<\/ul>/gi, "\n");
  t = t.replace(/<ol[^>]*>/gi, "\n");
  t = t.replace(/<\/ol>/gi, "\n");
  t = t.replace(/<blockquote[^>]*>/gi, "\n> ");
  t = t.replace(/<\/blockquote>/gi, "\n");
  t = t.replace(/<(strong|b)[^>]*>/gi, "**");
  t = t.replace(/<\/(strong|b)>/gi, "**");
  t = t.replace(/<(em|i)[^>]*>/gi, "*");
  t = t.replace(/<\/(em|i)>/gi, "*");
  t = t.replace(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)");
  t = t.replace(/<[^>]+>/g, "");
  t = decodeEntities(t);
  t = parseLatexFormulas(t);
  // Collapse internal whitespace within a paragraph to a single space; keep
  // paragraph breaks (double-newline) intact so the renderer can wrap each block.
  t = t.replace(/\r\n/g, "\n");
  t = t.replace(/[ \t]+\n/g, "\n");
  t = t.replace(/\n[ \t]+/g, "\n");
  t = t.replace(/\n{3,}/g, "\n\n");
  // Inside a paragraph (single \n surrounded by text), turn newline into a space
  // so the terminal wraps based on width rather than original HTML formatting.
  t = t.replace(/([^\n])\n([^\n])/g, "$1 $2");
  t = t.replace(/[ \t]{2,}/g, " ");
  return t.trim();
}

function toSubscript(s: string): string {
  const map: Record<string, string> = {
    "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄",
    "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
    "a": "ₐ", "e": "ₑ", "h": "ₕ", "i": "ᵢ", "j": "ⱼ",
    "k": "ₖ", "l": "ₗ", "m": "ₘ", "n": "ₙ", "o": "ₒ",
    "p": "ₚ", "r": "ᵣ", "s": "ₛ", "t": "ₜ", "u": "ᵤ",
    "v": "ᵥ", "x": "ₓ",
    "+": "₊", "-": "₋", "=": "₌", "(": "₍", ")": "₎",
  };
  let out = "";
  for (const ch of s) out += map[ch] ?? ("_" + ch);
  return out;
}

function toSuperscript(s: string): string {
  const map: Record<string, string> = {
    "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
    "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
    "a": "ᵃ", "b": "ᵇ", "c": "ᶜ", "d": "ᵈ", "e": "ᵉ",
    "f": "ᶠ", "g": "ᵍ", "h": "ʰ", "i": "ⁱ", "j": "ʲ",
    "k": "ᵏ", "l": "ˡ", "m": "ᵐ", "n": "ⁿ", "o": "ᵒ",
    "p": "ᵖ", "r": "ʳ", "s": "ˢ", "t": "ᵗ", "u": "ᵘ",
    "v": "ᵛ", "w": "ʷ", "x": "ˣ", "y": "ʸ", "z": "ᶻ",
    "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾",
  };
  let out = "";
  for (const ch of s) {
    if (map[ch]) { out += map[ch]; continue; }
    // CF uses <sup>*</sup> as a footnote marker. There's no Unicode super
    // asterisk that renders well in serif; map to U+2731 HEAVY ASTERISK
    // raised by font metrics — close enough, and visibly different from the
    // body asterisk so it doesn't read as italic markdown.
    if (ch === "*") { out += "†"; continue; }
    out += "^" + ch;
  }
  return out;
}

function renderLatex(expr: string, displayMode: boolean): string {
  try {
    // MathML output: every symbol is real Unicode (≤, ∑, π, αᵢ, …) and the
    // structure is semantic, so a small walker beats stripping HTML layout.
    const mathml = katex.renderToString(expr, {
      displayMode,
      throwOnError: false,
      output: "mathml",
      strict: "ignore",
    });
    return mathmlToText(mathml);
  } catch {
    return expr;
  }
}

function mathmlToText(mathml: string): string {
  let s = mathml.replace(/<annotation[\s\S]*?<\/annotation>/g, "");
  // Subscript / superscript with single-token children → real Unicode.
  s = s.replace(/<msub>\s*<m[in]>([^<]+)<\/m[in]>\s*<m[in]>([^<]+)<\/m[in]>\s*<\/msub>/g,
    (_, base, sub) => base + toSubscript(sub));
  s = s.replace(/<msup>\s*<m[in]>([^<]+)<\/m[in]>\s*<m[in]>([^<]+)<\/m[in]>\s*<\/msup>/g,
    (_, base, sup) => base + toSuperscript(sup));
  // Fraction.
  s = s.replace(/<mfrac>\s*<[^>]+>([^<]*)<\/[^>]+>\s*<[^>]+>([^<]*)<\/[^>]+>\s*<\/mfrac>/g,
    (_, a, b) => `(${a}/${b})`);
  // sqrt.
  s = s.replace(/<msqrt>\s*<[^>]+>([^<]*)<\/[^>]+>\s*<\/msqrt>/g, (_, x) => `√${x}`);
  // Strip remaining tags; their text content is already Unicode.
  s = s.replace(/<[^>]+>/g, "");
  s = decodeEntities(s);
  // Collapse MathML / KaTeX whitespace runs.
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function parseLatexFormulas(t: string): string {
  // Codeforces wraps inline math with $$$...$$$ (triple dollar) — handle first.
  t = t.replace(/\$\$\$([\s\S]+?)\$\$\$/g, (_, m) => renderLatex(m, false));
  t = t.replace(/\$\$([\s\S]*?)\$\$/g, (_, m) => "\n" + renderLatex(m, true) + "\n");
  t = t.replace(/(?<!\$)\$([^$\n]+)\$(?!\$)/g, (_, m) => renderLatex(m, false));
  return t;
}

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

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Replace CF math markers with KaTeX-rendered HTML. We render server-side so the
// browser only needs the KaTeX CSS — no client KaTeX runtime, no flash.
// Each math chunk is wrapped in <span class="cf-math" data-tex="…"
// data-display="…"> so the client can reverse the rendering when the user
// selects a region for translation (otherwise range.toString() collapses
// KaTeX's layout spans into garbled per-glyph text and the AI never sees the
// real `$…$` markers).
// Left-to-right scanner over CF's own MathJax delimiters. CF declares them in
// the page source: `inlineMath: [['$$$','$$$']], displayMath: [['$$$$$$','$$$$$$']]`
// — i.e. THREE dollars = inline, SIX dollars = display. Both are legitimate;
// neither is a bug. A regex pair can't honor this because `$$$$$$` is ambiguous
// out of context: between two adjacent inline formulas it's "close `$$$` +
// open `$$$`" (e.g. `$$$^{*}$$$$$$x \bmod y$$$`), but around a block it's a
// real display delimiter (e.g. `$$$$$$w(u,v)=…$$$$$$`). The scanner resolves it
// by state: when OUTSIDE math a run ≥6 opens display and 3–5 opens inline
// (extra dollars on a malformed 4/5-run are dropped); when INSIDE, a closing
// run consumes only what the open needs (3 or 6) and any leftover dollars are
// re-scanned from the outside — so a 6-run mid-text naturally splits into
// close+open. Math never crosses a tag boundary: hitting a raw `<`/`>` (CF
// HTML-encodes those inside math as &lt;/&gt;) aborts the span and emits the
// opener literally, guaranteeing tags can't be swallowed.
export function renderMathInHtml(html: string): string {
  const wrap = (tex: string, display: boolean, body: string) =>
    `<span class="cf-math" data-tex="${escapeAttr(tex)}" data-display="${display ? 1 : 0}">${body}</span>`;
  const renderChunk = (raw: string, display: boolean): string => {
    const e = normalizeFootnoteTex(decodeEntities(raw));
    try {
      const body = katex.renderToString(e, {
        displayMode: display, throwOnError: false, output: "html", strict: "ignore",
      });
      return wrap(e, display, body);
    } catch { return wrap(e, display, e); }
  };

  let out = "";
  let i = 0;
  const n = html.length;
  while (i < n) {
    if (html[i] !== "$") { out += html[i]; i++; continue; }
    let run = 0;
    while (i + run < n && html[i + run] === "$") run++;
    if (run < 3) { out += "$".repeat(run); i += run; continue; }

    const display = run >= 6;
    const need = display ? 6 : 3;          // dollars required to close
    // Inline consumes its whole opening run (drops a stray 4th/5th dollar);
    // display consumes exactly six (any extra become content, which is rare).
    const contentStart = display ? i + 6 : i + run;

    let k = contentStart;
    let closed = false;
    while (k < n) {
      const c = html[k];
      if (c === "<" || c === ">") break;   // tag boundary → abort this span
      if (c === "$") {
        let rr = 0;
        while (k + rr < n && html[k + rr] === "$") rr++;
        if (rr >= need) { closed = true; break; }
        break;                             // shorter run inside math = malformed
      }
      k++;
    }

    if (!closed) {                         // no valid close: emit opener literally
      out += html.slice(i, contentStart);
      i = contentStart;
      continue;
    }
    out += renderChunk(html.slice(contentStart, k), display);
    i = k + need;                          // leftover dollars re-scanned next loop
  }
  return out;
}

// CF marks footnotes with a text-mode asterisk superscript: `^{\text{∗}}`
// (∗ = U+2217 ASTERISK OPERATOR, sometimes a plain `*`). KaTeX renders it as a
// mid-height floating star that reads like a stray markdown `*`. Swap text-mode
// asterisks for a dagger so it looks like a real footnote marker. Math-mode
// asterisks (conjugates `a^*`, `\ast`) live outside `\text{}` and are untouched.
export function normalizeFootnoteTex(tex: string): string {
  return tex.replace(/\\text\s*\{\s*[∗*]\s*\}/g, "\\text{†}");
}

// Internal helpers surfaced for regression tests only — not part of the public
// API. See api.math.test.ts.
export const __mathTestInternals = { renderMathInHtml, normalizeFootnoteTex };

function extractSamples(sampleTestsInner: string): { input: string; output: string }[] {
  const pres = [...sampleTestsInner.matchAll(/<pre[^>]*>([\s\S]*?)<\/pre>/g)].map(m => m[1] ?? "");
  const formatPre = (s: string): string => {
    let t = s.replace(/<br\s*\/?>/gi, "\n");
    t = t.replace(/<div[^>]*>/gi, "").replace(/<\/div>/gi, "\n");
    t = t.replace(/<[^>]+>/g, "");
    t = decodeEntities(t);
    return t.replace(/\n{2,}/g, "\n").replace(/^\n+|\n+$/g, "");
  };
  const out: { input: string; output: string }[] = [];
  for (let i = 0; i < pres.length; i += 2) {
    out.push({ input: formatPre(pres[i] ?? ""), output: formatPre(pres[i + 1] ?? "") });
  }
  return out;
}

export function parseStatementToJSON(html: string): StatementJSON {
  let content = "";
  const startIndex = html.indexOf('class="problem-statement"');
  if (startIndex !== -1) {
    const divStart = html.lastIndexOf("<div", startIndex);
    if (divStart !== -1) {
      const tagOpenEnd = html.indexOf(">", divStart) + 1;
      let depth = 1, j = tagOpenEnd;
      while (j < html.length && depth > 0) {
        if (html.startsWith("<div", j)) { depth++; j += 4; }
        else if (html.startsWith("</div>", j)) {
          depth--;
          if (depth === 0) { content = html.substring(tagOpenEnd, j); break; }
          j += 6;
        } else j++;
      }
    }
  }

  const header = locateClassDiv(content, "header");
  const inputSpec = locateClassDiv(content, "input-specification");
  const outputSpec = locateClassDiv(content, "output-specification");
  const sampleTests = locateClassDiv(content, "sample-tests");
  const note = locateClassDiv(content, "note");

  const headerInner = header ? content.substring(header.innerStart, header.innerEnd) : "";
  const titleDiv = locateClassDiv(headerInner, "title");
  const timeLimitDiv = locateClassDiv(headerInner, "time-limit");
  const memLimitDiv = locateClassDiv(headerInner, "memory-limit");
  const title = titleDiv
    ? plainText(headerInner.substring(titleDiv.innerStart, titleDiv.innerEnd))
    : "";
  const timeRaw = timeLimitDiv
    ? plainText(headerInner.substring(timeLimitDiv.innerStart, timeLimitDiv.innerEnd))
    : "";
  const memRaw = memLimitDiv
    ? plainText(headerInner.substring(memLimitDiv.innerStart, memLimitDiv.innerEnd))
    : "";
  const timeLimit = timeRaw.replace(/^time limit per test\s*/i, "");
  const memoryLimit = memRaw.replace(/^memory limit per test\s*/i, "");

  const bodyEnd = Math.min(
    inputSpec?.start ?? Infinity,
    outputSpec?.start ?? Infinity,
    sampleTests?.start ?? Infinity,
    note?.start ?? Infinity,
    content.length
  );
  const bodyStart = header?.end ?? 0;
  const statementRaw = bodyEnd > bodyStart ? content.substring(bodyStart, bodyEnd) : "";

  const stripSectionTitle = (inner: string) =>
    inner.replace(/<div[^>]*class="[^"]*\bsection-title\b[^"]*"[^>]*>[\s\S]*?<\/div>/, "");

  const statementHtml = renderMathInHtml(statementRaw);
  const inputHtml = inputSpec
    ? renderMathInHtml(stripSectionTitle(content.substring(inputSpec.innerStart, inputSpec.innerEnd)))
    : "";
  const outputHtml = outputSpec
    ? renderMathInHtml(stripSectionTitle(content.substring(outputSpec.innerStart, outputSpec.innerEnd)))
    : "";
  const samples = sampleTests
    ? extractSamples(content.substring(sampleTests.innerStart, sampleTests.innerEnd))
    : [];
  const noteHtml = note
    ? renderMathInHtml(stripSectionTitle(content.substring(note.innerStart, note.innerEnd)))
    : "";

  return { title, timeLimit, memoryLimit, statementHtml, inputHtml, outputHtml, samples, noteHtml };
}

// Legacy markdown statement parser, retained for the terminal UI. Kept verbatim
// so the TUI output is byte-identical to before the refactor.
export function parseStatementHtml(html: string): string {
  const parts: string[] = [];

  let content = html;

  const startIndex = html.indexOf('class="problem-statement"');
  if (startIndex !== -1) {
    const divStart = html.lastIndexOf('<div', startIndex);
    if (divStart !== -1) {
      const remaining = html.substring(divStart);
      let depth = 1;
      let i = 5;
      while (i < remaining.length && depth > 0) {
        if (remaining.substring(i, i + 6) === '</div>') {
          depth--;
          if (depth === 0) {
            content = remaining.substring(5, i);
            break;
          }
          i += 6;
        } else if (remaining.substring(i, i + 4) === '<div') {
          depth++;
          i += 4;
        } else {
          i++;
        }
      }
    }
  }

  const titleMatch = content.match(/<div[^>]*class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/div>/);
  if (!titleMatch) {
    const h1Match = content.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
    if (h1Match) {
      parts.push(`# ${stripTags(h1Match[1]!).trim()}`);
    }
  } else {
    const title = stripTags(titleMatch[1]!).trim();
    if (title && !title.includes("Problem")) {
      parts.push(`# ${title}`);
    }
  }

  const timeMatch = content.match(/<div[^>]*class="[^"]*time-limit[^"]*"[^>]*>([\s\S]*?)<\/div>/);
  const memMatch = content.match(/<div[^>]*class="[^"]*memory-limit[^"]*"[^>]*>([\s\S]*?)<\/div>/);
  const limits: string[] = [];
  if (timeMatch) limits.push(stripTags(timeMatch[1]!).trim());
  if (memMatch) limits.push(stripTags(memMatch[1]!).trim());
  if (limits.length) {
    parts.push("");
    parts.push(`*${limits.join(" · ")}*`);
    parts.push("");
  }

  const paragraphs = content.match(/<p[^>]*>([\s\S]*?)<\/p>/g) || [];
  if (paragraphs.length > 0) {
    parts.push(cleanText(paragraphs.join("\n\n")));
  }

  const sampleTestsMatch = html.match(/<div[^>]*class="[^"]*\bsample-tests\b[^"]*"[^>]*>([\s\S]*)/);
  let sampleSection = sampleTestsMatch ? sampleTestsMatch[1] : "";
  if (sampleSection) {
    let depth = 1;
    let i = 0;
    while (i < sampleSection.length && depth > 0) {
      if (sampleSection.startsWith("<div", i)) { depth++; i += 4; }
      else if (sampleSection.startsWith("</div>", i)) { depth--; if (depth === 0) { sampleSection = sampleSection.slice(0, i); break; } i += 6; }
      else i++;
    }
  }
  const preBlocks = [...(sampleSection ?? "").matchAll(/<pre[^>]*>([\s\S]*?)<\/pre>/g)].map(m => m[1]);
  const sampleCount = Math.ceil(preBlocks.length / 2);

  const formatPre = (innerPre: string): string => {
    let t = innerPre.replace(/<br\s*\/?>/gi, "\n");
    t = t.replace(/<div[^>]*>/gi, "").replace(/<\/div>/gi, "\n");
    t = stripTags(t);
    return t.replace(/\n{2,}/g, "\n").trim();
  };

  for (let i = 0; i < sampleCount; i++) {
    parts.push("");
    parts.push(`### Example ${i + 1}`);
    const inBlock = preBlocks[i * 2];
    const inText = inBlock ? formatPre(inBlock) : "";
    if (inText) {
      parts.push("");
      parts.push("**Input**");
      parts.push("```");
      parts.push(inText);
      parts.push("```");
    }
    const outBlock = preBlocks[i * 2 + 1];
    const outText = outBlock ? formatPre(outBlock) : "";
    if (outText) {
      parts.push("");
      parts.push("**Output**");
      parts.push("```");
      parts.push(outText);
      parts.push("```");
    }
  }

  const noteMatch = content.match(/<div[^>]*class="[^"]*note[^"]*"[^>]*>([\s\S]*?)<\/div>/);
  if (noteMatch) {
    parts.push("");
    parts.push("## Note");
    parts.push(cleanText(noteMatch[1]!));
  }

  const result = parts.join("\n").replace(/\n{3,}/g, "\n\n").trim();

  if (!result) {
    const cleanContent = cleanText(content);
    const lines = cleanContent.split("\n").filter(line => line.trim().length > 10);
    if (lines.length > 0) {
      return lines.slice(0, 30).join("\n");
    }
    return "Could not parse statement.";
  }

  return result;
}

export { withNetworkOptions };
export type { CFConfig };
