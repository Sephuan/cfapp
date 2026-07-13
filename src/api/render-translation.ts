// Render AI translation markdown-ish text into HTML with KaTeX formulas.
// Shared by server.ts (dev) and server-prod.ts (packaged builds).
//
// Placeholder history (do not regress):
//   • space-delimited ` MATH0 ` — list-item `.trim()` stripped the spaces →
//     literal "MATH37" on Windows packages.
//   • NUL `\0MATH0\0` — HTML parsers strip U+0000 → bare "MATH0".
//   • PUA `\uE000MATH0\uE001` / protect `\uE0100\uE011` — survive the DOM, so a
//     failed restore shows as private-use glyphs + "0" (Round 1090A screenshot).
//
// Current scheme: per-call ASCII tokens `%%CFM<nonce>_<i>%%` that are not HTML
// special, not whitespace, and not valid LaTeX — restored before return, with a
// final sweep that never leaves a token in the card.

import katex from "katex";

export function renderTranslationHtml(input: string): string {
  if (!input) return "";
  // Models often drop the dollar signs around a formula and only keep them on a
  // footnote marker, e.g. `\operatorname{min}(x,y)$^{\dagger}$\operatorname{min}…`.
  // Heal bare commands into $…$ first so KaTeX sees real math.
  const healed = healBareLatex(input);

  // Per-call nonce so a pathological model string "%%CFM0%%" cannot collide
  // with our slots (and so two concurrent renders never cross wires).
  const nonce = Math.random().toString(36).slice(2, 10);
  const token = (kind: "M" | "P", i: number) => `%%CF${kind}${nonce}_${i}%%`;
  const tokenRe = (kind: "M" | "P") =>
    new RegExp(`%%CF${kind}${nonce}_(\\d+)%%`, "g");

  const slots: string[] = [];
  const stash = (raw: string, displayMode: boolean) => {
    try {
      slots.push(
        katex.renderToString(raw, {
          displayMode,
          throwOnError: false,
          output: "html",
          strict: "ignore",
        }),
      );
    } catch {
      slots.push(`<code>${escapeHtml(raw)}</code>`);
    }
    return token("M", slots.length - 1);
  };

  // Delimiter order is mandatory (longest first):
  //   $$$…$$$  — CF / our extractor display (highlight.ts data-display=1)
  //   $$…$$    — common LaTeX / models' display; MUST run before single $
  //              otherwise `$$\bigoplus…$$` is parsed as leftover `$` +
  //              inline `\bigoplus…` + leftover `$` (visible dollar leak +
  //              no centering) — Round 1105B regression.
  //   $…$      — inline
  let s = healed.replace(/\$\$\$([\s\S]+?)\$\$\$/g, (_, m) => stash(m, true));
  s = s.replace(/\$\$([\s\S]+?)\$\$/g, (_, m) => stash(m, true));
  s = s.replace(/\$([^\n$]+?)\$/g, (_, m) => stash(m, false));
  s = escapeHtml(s);
  // Inline code only. We deliberately do NOT render **bold** / *italic*:
  // competitive-programming statements use "*" and "**" as literal content
  // (string examples like "u****u", multiplication), and the translation prompt
  // no longer asks the model to emit markdown emphasis — so any emphasis pass
  // here only corrupts literal asterisks into <strong>/<em>.
  s = s.replace(/`([^`\n]+?)`/g, (_, m) => `<code>${m}</code>`);
  // Paragraphs (blank line) + line breaks. List detection is lenient: the
  // extractor emits "- " for each <li>, but a flash-lite model often drops the
  // leading "- " on some lines, so a strict every-line check would fall back to
  // <p> and leave a literal "- " in the text (ugly). We render a <ul> whenever a
  // majority of the lines carry a bullet marker, and strip any leftover marker
  // from non-list lines so a literal "- " never leaks through either way.
  const blocks = s.split(/\n{2,}/).map((block) => {
    const lines = block.split("\n");
    const marked = lines.filter((l) => /^\s*[-*•]\s+/.test(l)).length;
    const isList = marked >= 2 && marked * 2 > lines.length;
    if (isList) {
      const items = lines
        .map((l) => `<li>${l.replace(/^\s*[-*•]\s+/, "").trim()}</li>`)
        .join("");
      return `<ul class="cf-tr-list">${items}</ul>`;
    }
    const clean = lines.map((l) => l.replace(/^\s*[-*•]\s+/, ""));
    return `<p>${clean.join("<br>")}</p>`;
  });
  s = blocks.join("");

  // Restore KaTeX HTML. Function replacer so `$` inside KaTeX output is literal.
  s = s.replace(tokenRe("M"), (_, i) => slots[Number(i)] ?? "");

  // Hard guarantee: never ship a token or legacy placeholder to the card.
  s = s.replace(tokenRe("M"), "");
  s = s.replace(tokenRe("P"), "");
  s = s.replace(/%%CF[MP][A-Za-z0-9_]+%%/g, "");
  // Legacy leaks from older builds still sitting in localStorage / mid-stream.
  s = s.replace(/\uE000MATH\d+\uE001/g, "");
  s = s.replace(/[\uE000-\uE011]/g, "");
  s = s.replace(/\u0000MATH\d+\u0000/g, "");
  s = s.replace(/\u0000/g, "");
  s = s.replace(/\bMATH\d+\b/g, "");

  return s;
}

// Wrap common LaTeX commands that the model emitted without `$…$` delimiters.
// Existing well-formed math regions are protected first so we never double-wrap.
// Exported for unit tests.
export function healBareLatex(input: string): string {
  const nonce = Math.random().toString(36).slice(2, 10);
  const token = (i: number) => `%%CFP${nonce}_${i}%%`;
  const tokenRe = new RegExp(`%%CFP${nonce}_(\\d+)%%`, "g");

  const protectedRegions: string[] = [];
  const protect = (m: string) => {
    protectedRegions.push(m);
    return token(protectedRegions.length - 1);
  };

  let s = input;
  s = s.replace(/\$\$\$[\s\S]+?\$\$\$/g, protect);
  s = s.replace(/\$\$[\s\S]+?\$\$/g, protect);
  s = s.replace(/\$[^\n$]+?\$/g, protect);

  // Optional trailing sub/superscript: ^{\ldots} _{…} ^\dagger etc.
  const script = String.raw`(?:\s*(?:\^|_)\s*(?:\{[^{}]*\}|[A-Za-z0-9\\]+))*`;

  // Wrap as $…$, but never glue against a neighboring `$` or a protect token —
  // after unprotect, `$A$$B$` is parsed as display-math `$$…$$` and swallows
  // the next formula.
  const wrap = (m: string, offset: number, full: string) => {
    const prev = offset > 0 ? full[offset - 1]! : "";
    const next = full[offset + m.length] ?? "";
    // Protect tokens start with '%'; raw $ is the other adjacency hazard.
    const lead = prev === "$" || prev === "%" ? " " : "";
    const trail = next === "$" || next === "%" ? " " : "";
    return `${lead}$${m}$${trail}`;
  };

  s = s.replace(
    new RegExp(
      String.raw`\\(?:operatorname|text|mathrm|mathbf|mathsf|mathit|boldsymbol|mathbb|mathcal|mathfrak)\{[^{}]*\}(?:\s*\([^)]*\))?` + script,
      "g",
    ),
    wrap,
  );
  s = s.replace(
    new RegExp(
      String.raw`\\(?:frac|dfrac|tfrac|binom)\{[^{}]*\}\{[^{}]*\}` + script,
      "g",
    ),
    wrap,
  );
  s = s.replace(
    new RegExp(
      String.raw`\\(?:sqrt|overline|underline|hat|bar|vec|tilde)(?:\{[^{}]*\}|\s+[A-Za-z0-9])` + script,
      "g",
    ),
    wrap,
  );
  s = s.replace(
    new RegExp(
      String.raw`\\(?:min|max|mid|gcd|lcm|log|ln|sin|cos|tan|det|dim|ker|sup|inf|lim|Pr|exp)(?![A-Za-z])(?:\s*\([^)]*\))?` + script,
      "g",
    ),
    wrap,
  );

  s = s.replace(tokenRe, (_, i) => protectedRegions[Number(i)] ?? "");
  // If anything went wrong, drop leftover protect tokens rather than showing them.
  s = s.replace(new RegExp(`%%CFP${nonce}_\\d+%%`, "g"), "");
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
