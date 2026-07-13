// Regression tests for renderMathInHtml — the CF problem-statement math
// renderer. Each block below pins a real bug we hit while displaying contest
// statements so a future edit to the regex/normalization can't silently
// reintroduce it. We assert on the `data-tex` attribute (the LaTeX we hand to
// KaTeX and later to the translator) rather than KaTeX's HTML output, since
// the tex string is where every bug actually manifested.
import { test, expect, describe } from "bun:test";
import { __mathTestInternals } from "./api";

const { renderMathInHtml, normalizeFootnoteTex } = __mathTestInternals;

// Pull every data-tex="..." out of the rendered HTML, in document order.
function texChunks(html: string): string[] {
  return [...html.matchAll(/data-tex="([^"]*)"/g)].map((m) => m[1]!);
}

describe("normalizeFootnoteTex", () => {
  test("text-mode asterisk (U+2217) becomes a dagger", () => {
    expect(normalizeFootnoteTex("^{\\text{∗}}")).toBe("^{\\text{†}}");
  });

  test("text-mode plain asterisk becomes a dagger", () => {
    expect(normalizeFootnoteTex("^{\\text{*}}")).toBe("^{\\text{†}}");
  });

  test("whitespace inside \\text{ * } is tolerated", () => {
    expect(normalizeFootnoteTex("^{\\text{ ∗ }}")).toBe("^{\\text{†}}");
  });

  test("math-mode conjugate a^* is untouched", () => {
    expect(normalizeFootnoteTex("a^*")).toBe("a^*");
  });

  test("\\ast multiplication is untouched", () => {
    expect(normalizeFootnoteTex("x \\ast y")).toBe("x \\ast y");
  });
});

describe("renderMathInHtml — normal cases (anti-regression)", () => {
  test("a simple inline formula renders to one clean cf-math span", () => {
    const out = renderMathInHtml("<p>value $$$n$$$ here</p>");
    const chunks = texChunks(out);
    expect(chunks).toEqual(["n"]);
    expect(out).toContain('class="cf-math"');
  });

  test("multiple inline formulas in a paragraph stay paired and ordered", () => {
    const out = renderMathInHtml("<p>$$$a$$$ and $$$b$$$ and $$$c$$$</p>");
    expect(texChunks(out)).toEqual(["a", "b", "c"]);
  });

  test("HTML tags between formulas are never absorbed into a tex chunk", () => {
    const out = renderMathInHtml('<p>$$$x$$$</p><p><a href="u">link</a> $$$y$$$</p>');
    const chunks = texChunks(out);
    expect(chunks).toEqual(["x", "y"]);
    // no chunk may contain a tag delimiter
    for (const c of chunks) expect(c).not.toMatch(/[<>]/);
  });

  test("no literal $ survives in the rendered output", () => {
    const out = renderMathInHtml("<p>$$$a$$$ then $$$b$$$</p>");
    expect(out).not.toContain("$");
  });
});

describe("renderMathInHtml — bug #1: footnote superscript", () => {
  test("$$$^{\\text{∗}}$$$ renders via the dagger normalization (data-tex shows †)", () => {
    const out = renderMathInHtml("holds$$$^{\\text{∗}}$$$.");
    const chunks = texChunks(out);
    expect(chunks).toEqual(["^{\\text{†}}"]);
    expect(out).not.toContain("∗");
  });
});

describe("renderMathInHtml — bug #2: malformed 4/5-dollar run", () => {
  // CF emitted `$$$$w(u,v)=…$$$` — a stray 4th dollar glued to an inline open.
  // The scanner opens inline on the 3+-run, drops the extra dollar(s), and the
  // tex must not start with `$` nor swallow following tags.
  test("a stray leading $ does not leak into the tex chunk", () => {
    const src = "<p>weight $$$$w(u, v) = \\frac{1}{2}$$$ done</p>";
    const out = renderMathInHtml(src);
    const chunks = texChunks(out);
    for (const c of chunks) expect(c.startsWith("$")).toBe(false);
    for (const c of chunks) expect(c).not.toMatch(/[<>]/);
  });

  test("tags after a malformed fence are not swallowed", () => {
    const src = '<p>$$$$a$$$</p><p><a href="x">L</a> b</p>';
    const out = renderMathInHtml(src);
    // The anchor tag must remain present as real markup, not inside a tex attr.
    expect(out).toContain('<a href="x">L</a>');
    for (const c of texChunks(out)) expect(c).not.toMatch(/[<>]/);
  });
});

describe("renderMathInHtml — bug #3: $$$$$$ is display, not a fence to collapse", () => {
  // CF's page source declares: inlineMath [['$$$','$$$']], displayMath
  // [['$$$$$$','$$$$$$']]. Six dollars is a LEGITIMATE display delimiter.
  test("six-dollar display delimiters render one display chunk, no leftover $", () => {
    const src = "<p>$$$$$$w(u, v) = \\frac{\\max(u, v)}{\\gcd(u, v)}$$$$$$</p>";
    const out = renderMathInHtml(src);
    expect(out).not.toContain("$");
    expect(texChunks(out)).toEqual(["w(u, v) = \\frac{\\max(u, v)}{\\gcd(u, v)}"]);
    expect(out).toContain('data-display="1"');
    // Display uses a block wrapper so it can center (not an inline span).
    expect(out).toMatch(/<div class="cf-math"[^>]*data-display="1"/);
  });

  test("bigoplus display (1105B-style) is a centered block wrapper", () => {
    const src = "<p>r, c: $$$$$$\\bigoplus_{x=i}^{i+r-1} \\bigoplus_{y=j}^{j+c-1} a_{x,y} = 0$$$$$$</p>";
    const out = renderMathInHtml(src);
    expect(out).not.toContain("$");
    expect(out).toContain("katex-display");
    expect(out).toMatch(/<div class="cf-math"[^>]*data-display="1"/);
    expect(texChunks(out).some((t) => t.includes("bigoplus"))).toBe(true);
  });

  test("a full statement fragment with mixed display+inline has zero stray $", () => {
    const src =
      "<p>weight:</p><p>$$$$$$w(u, v) = \\frac{\\max(u, v)}{\\gcd(u, v)}$$$$$$</p>" +
      '<p>Here $$$\\gcd(x, y)$$$ denotes the ' +
      '<a href="https://en.wikipedia.org/wiki/Greatest_common_divisor">GCD</a> ' +
      "of $$$x$$$ and $$$y$$$.</p>";
    const out = renderMathInHtml(src);
    expect(out).not.toContain("$");
    expect(out).toContain("/wiki/Greatest_common_divisor");
    expect(texChunks(out)).toEqual([
      "w(u, v) = \\frac{\\max(u, v)}{\\gcd(u, v)}",
      "\\gcd(x, y)",
      "x",
      "y",
    ]);
  });
});

describe("renderMathInHtml — bug #4: adjacent inline formulas (2234A regression)", () => {
  // Real CF source: `$$$^{\text{∗}}$$$$$$x \bmod y$$$ denotes ... $$$x$$$ ...`.
  // The `$$$$$$` between two inline formulas is "close $$$ + open $$$", NOT a
  // display delimiter. The old collapse rule (/\${4,}/→$$$) merged it into one
  // `$$$`, derailing every later pairing (footnote became text, the prose
  // "denotes the remainder when" got rendered as math). The scanner splits the
  // 6-run into close(3)+open(3) by state.
  test("$$$A$$$$$$B$$$ splits into two separate inline chunks", () => {
    const out = renderMathInHtml("<p>$$$^{\\text{∗}}$$$$$$x \\bmod y$$$ denotes</p>");
    expect(texChunks(out)).toEqual(["^{\\text{†}}", "x \\bmod y"]);
    expect(out).not.toContain("$");
    // both must be inline, not display
    expect(out).not.toContain('data-display="1"');
  });

  test("full 2234A footnote keeps prose as text and dollars balanced", () => {
    const src =
      '<div class="statement-footnote"><p>$$$^{\\text{∗}}$$$$$$x \\bmod y$$$ ' +
      "denotes the remainder when $$$x$$$ is divided by $$$y$$$.</p></div>";
    const out = renderMathInHtml(src);
    expect(out).not.toContain("$");
    expect(texChunks(out)).toEqual(["^{\\text{†}}", "x \\bmod y", "x", "y"]);
    // the prose must NOT have been captured as a tex chunk
    for (const c of texChunks(out)) expect(c).not.toContain("denotes");
    expect(out).toContain("denotes the remainder when");
  });
});
