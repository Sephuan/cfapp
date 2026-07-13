// HTML entity decoding, tag stripping, and plain-text cleanup used by the
// TUI statement renderer and auth HTML scrapers.
import katex from "katex";

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
