// Server-side KaTeX rendering for problem statements and translations.
import katex from "katex";
import { decodeEntities } from "./text";

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
  // Display math uses a block wrapper so it centers as its own row (a span
  // containing .katex-display is invalid-ish HTML and often sits left-aligned
  // next to the preceding ":" / prose instead of on a centered line).
  const wrap = (tex: string, display: boolean, body: string) => {
    const tag = display ? "div" : "span";
    return `<${tag} class="cf-math" data-tex="${escapeAttr(tex)}" data-display="${display ? 1 : 0}">${body}</${tag}>`;
  };
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
