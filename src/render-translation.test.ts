// Pins the MATH-slot round-trip of renderTranslationHtml. A packaged-build
// regression used space-delimited slots that list-item `.trim()` stripped,
// leaving literal "MATH37" in Windows builds.
import { test, expect, describe } from "bun:test";
import { renderTranslationHtml } from "./api/render-translation";

describe("renderTranslationHtml — MATH slot restore", () => {
  test("list of pure-math bullets restores KaTeX (not literal MATHN)", () => {
    // Mimics CF sample arrays selected as a list: each LI is only a formula.
    const input = [
      "- $[12]$",
      "- $[18]$",
      "- $[12, 18]$",
      "- $[18, 4]$",
    ].join("\n");
    const html = renderTranslationHtml(input);
    expect(html).toContain('<ul class="cf-tr-list">');
    expect(html).toContain("katex");
    // Space-delimiter bug left these visible; NUL delimiters must not.
    expect(html).not.toMatch(/MATH\d+/);
  });

  test("inline math mid-sentence restores", () => {
    const html = renderTranslationHtml("Consider $n = 3$ cases.");
    expect(html).toContain("katex");
    expect(html).not.toMatch(/MATH\d+/);
    expect(html).toContain("Consider");
    expect(html).toContain("cases");
  });

  test("display math with $$$ restores in display mode", () => {
    const html = renderTranslationHtml("See\n\n$$$a+b=c$$$\n\nok");
    expect(html).toContain("katex");
    expect(html).toContain("katex-display");
    expect(html).not.toMatch(/MATH\d+/);
    expect(html).not.toContain("$");
  });

  // Round 1105B: models often emit $$…$$ (LaTeX display). Parsing that as
  // single-$ pairs left a visible leading/trailing `$` and used inline mode
  // (no centering, smaller operators).
  test("display math with $$ does not leak dollars and uses displayMode", () => {
    const tex = "\\bigoplus_{x=i}^{i+r-1} \\bigoplus_{y=j}^{j+c-1} a_{x,y} = 0";
    const html = renderTranslationHtml(`$$${tex}$$`);
    expect(html).toContain("katex");
    expect(html).toContain("katex-display");
    expect(html).not.toContain("$");
    expect(html).not.toMatch(/MATH\d+/);
  });

  test("$$ display does not break adjacent inline $", () => {
    const html = renderTranslationHtml("Let $n=1$ then $$a+b=c$$ end $m$.");
    expect(html).toContain("katex-display");
    expect(html).not.toContain("$");
    expect(html).toContain("Let");
    expect(html).toContain("end");
  });

  test("mixed list with text + math", () => {
    const input = [
      "- first $a_i$",
      "- second $b_j$",
      "- third item",
    ].join("\n");
    const html = renderTranslationHtml(input);
    expect(html).toContain("<li>");
    expect(html).toContain("katex");
    expect(html).not.toMatch(/MATH\d+/);
    expect(html).toContain("third item");
  });

  // Round 1090A: model drops $ around \operatorname{min}(x,y) and only keeps
  // them on the footnote marker → used to render as
  // `\operatorname{min}(x, y)MATH0\operatorname{min}(x, y) 定义为…`.
  test("bare \\operatorname next to footnote $…$ does not leak MATHN or raw command", () => {
    const input =
      "使得 \\operatorname{min}(x, y)$^{\\dagger}$\\operatorname{min}(x, y) 定义为整数 x 和 y 中的最小值。";
    const html = renderTranslationHtml(input);
    expect(html).toContain("katex");
    expect(html).not.toMatch(/MATH\d+/);
    expect(html).not.toContain("\\operatorname");
    expect(html).toContain("定义为");
  });

  test("bare \\min(x,y) is healed into KaTeX", () => {
    const html = renderTranslationHtml("choose y so that \\min(x,y) is maximized");
    expect(html).toContain("katex");
    expect(html).not.toContain("\\min");
    expect(html).toContain("maximized");
  });

  test("already-delimited math is not double-wrapped", () => {
    const html = renderTranslationHtml("keep $\\min(x,y)$ intact");
    expect(html).toContain("katex");
    // One formula → one katex root (not nested / duplicated).
    expect(html.split("class=\"katex\"").length - 1).toBe(1);
  });

  test("never leaks PUA sentinels or %%CF tokens (1090A screenshot regression)", () => {
    const input =
      "猕猴得到一个整数 $x$。你的任务是选择一个整数 $y$，使得 " +
      "\\operatorname{min}(x, y)$^{\\dagger}$\\operatorname{min}(x, y) " +
      "定义为整数 $x$ 和 $y$ 中的最小值。";
    const html = renderTranslationHtml(input);
    expect(html).toContain("katex");
    expect(html).not.toMatch(/MATH\d+/);
    expect(html).not.toMatch(/%%CF[MP]/);
    expect(html).not.toMatch(/[\uE000-\uE011]/);
    expect(html).not.toContain("\\operatorname");
    expect(html).toContain("定义为");
    expect(html).toContain("猕猴");
  });

  test("legacy PUA/NUL placeholders in stored text are stripped", () => {
    // Simulate a card body that still carries an old un-restored slot.
    const html = renderTranslationHtml(
      "before \uE000MATH0\uE001 after \\min(a,b) end",
    );
    expect(html).not.toMatch(/MATH\d+/);
    expect(html).not.toMatch(/[\uE000-\uE011]/);
    expect(html).toContain("katex");
    expect(html).toContain("before");
    expect(html).toContain("after");
  });
});
