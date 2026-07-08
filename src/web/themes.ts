// Translation-annotation palettes. Picking one writes data-tr-theme onto
// <html>; CSS variables recolor every existing .cf-tr block instantly.
// Values must match the [data-tr-theme="…"] selectors in styles/themes.css.
export type TrTheme = "amber" | "ink" | "indigo";
export const TR_THEMES: { id: TrTheme; name: string; hint: string; line: string; text: string; labelBg: string; labelFg: string }[] = [
  { id: "amber",  name: "赭黄", hint: "暖调浸染，与皮装书调性一致",
    line: "#b45309", text: "#7c4a12", labelBg: "#b45309", labelFg: "#fff8ec" },
  { id: "ink",    name: "青墨", hint: "冷墨批注，与暖正文对仗最克制",
    line: "#3f6b78", text: "#3f6b78", labelBg: "#3f6b78", labelFg: "#f0f4f5" },
  { id: "indigo", name: "靛蓝", hint: "古典注疏，区分度最高",
    line: "#1e3a8a", text: "#1e3a8a", labelBg: "#1e3a8a", labelFg: "#eef2ff" },
];
export function readTrTheme(): TrTheme {
  try {
    const v = localStorage.getItem("cfapp:tr-theme");
    if (v === "ink" || v === "indigo") return v;
  } catch {}
  return "amber";
}
export function applyTrTheme(t: TrTheme) {
  // amber is the default (no attribute needed); clear it so the
  // :root fallback wins and there's no stale override lingering.
  if (t === "amber") document.documentElement.removeAttribute("data-tr-theme");
  else document.documentElement.setAttribute("data-tr-theme", t);
  try { localStorage.setItem("cfapp:tr-theme", t); } catch {}
}

// Color themes — independent of light/dark, they set data-color-theme on
// <html>. "" (empty string) = the default leather-book palette.
export type ColorTheme = "" | "cool-gray" | "forest" | "rosegold" | "violet" | "obsidian";
export const COLOR_THEMES: { id: ColorTheme; name: string; hint: string;
  headerBg: string; accent: string; surface: string }[] = [
  { id: "",           name: "皮装书", hint: "暖棕皮面，cream 纸质",
    headerBg: "#3d2817", accent: "#b45309", surface: "#ffffff" },
  { id: "cool-gray",  name: "冷灰蓝", hint: "冷静科技感，GitHub Dark 中性冷调",
    headerBg: "#1e293b", accent: "#2563eb", surface: "#ffffff" },
  { id: "forest",     name: "森绿",   hint: "深森林苔藓，沉浸自然质感",
    headerBg: "#1a2e1a", accent: "#2d6a2e", surface: "#fafcf7" },
  { id: "rosegold",   name: "玫瑰金", hint: "暖粉棕优雅柔美，偏女性化设计",
    headerBg: "#3d2028", accent: "#b76e79", surface: "#fffbf7" },
  { id: "violet",     name: "紫罗兰", hint: "深紫典雅，神秘中带优雅气质",
    headerBg: "#2e1a47", accent: "#7c3aed", surface: "#fdfbff" },
  { id: "obsidian",   name: "墨黑",   hint: "纯黑极简，AMOLED 最大对比度",
    headerBg: "#111111", accent: "#333333", surface: "#f8f8f8" },
];
export function readColorTheme(): ColorTheme {
  try {
    const v = localStorage.getItem("cfapp:color-theme");
    if (v && COLOR_THEMES.some((t) => t.id === v)) return v as ColorTheme;
  } catch {}
  return "";
}
export function applyColorTheme(t: ColorTheme) {
  if (t === "") document.documentElement.removeAttribute("data-color-theme");
  else document.documentElement.setAttribute("data-color-theme", t);
  try { localStorage.setItem("cfapp:color-theme", t); } catch {}
}

// ===== Font roles =====
// A "font role" is one --font-* variable slot (body / statement / …) that the
// user can repoint at one of several fonts. The design splits cleanly:
//   • the actual font STACKS live in styles/themes.css, keyed by a data attr
//     [data-font-<role>="<choice>"] — CSS owns typography, and applying a pick
//     is a no-flash attribute flip with no React re-render;
//   • the UI METADATA (labels, hints, preview family) lives here.
//
// To ADD A FONT to a role: cache it in fonts.ts, add a [data-font-<role>="id"]
//   rule in themes.css, and add one entry to that role's `choices` below (plus
//   the id to BOOT_FONT_ROLES in index.html so it restores before paint).
// To ADD A ROLE: add a FontRole entry here + the matching --font-<var> in
//   themes.css. The Settings page renders a picker for every role automatically.
//
// A choice's `id` is the value written to data-font-<role> and localStorage;
// the empty-string id is the default (no attribute → CSS :root stack wins).
// `system: true` means the primary family is a system/OS font we don't ship
// (e.g. Georgia) — the picker shows "系统" instead of a load ✓/✗ badge.
export type FontChoice = {
  id: string;
  name: string;
  hint: string;
  family: string;      // primary family, used for the picker's live preview
  system?: boolean;    // true → not shipped by fonts.ts, always "available"
};
export type FontRole = {
  key: string;         // data attr suffix + storage key, e.g. "body"
  cssVar: string;      // the CSS variable this role drives, e.g. "--font-body"
  label: string;       // section label in Settings
  preview: string;     // sample text for the picker — mirror what this role renders
  choices: FontChoice[]; // choices[0] must be the default (id "")
};

export const FONT_ROLES: FontRole[] = [
  {
    key: "body", cssVar: "--font-body", label: "正文字体",
    preview: "Codeforces Round 1000 (Div. 2)",
    choices: [
      { id: "",             name: "Newsreader",     hint: "报刊衬线，笔画对比鲜明",     family: "Newsreader" },
      { id: "source-serif", name: "Source Serif 4", hint: "Adobe 正文衬线，素净端正",   family: "Source Serif 4" },
      { id: "eb-garamond",  name: "EB Garamond",    hint: "古典 Garamond，笔画纤细",   family: "EB Garamond" },
      { id: "lora",         name: "Lora",           hint: "笔刷衬线，暖调柔和",         family: "Lora" },
      { id: "spectral",     name: "Spectral",       hint: "文学正文衬线，精致文气",     family: "Spectral" },
      { id: "bitter",       name: "Bitter",         hint: "板衬线，方正厚实",           family: "Bitter" },
      { id: "georgia",      name: "Georgia",        hint: "系统衬线，屏幕易读",         family: "Georgia", system: true },
    ],
  },
  {
    key: "statement", cssVar: "--font-statement", label: "题面字体",
    preview: "You are given an array of n integers.",
    choices: [
      { id: "",             name: "Georgia",        hint: "系统衬线，屏幕易读（默认）", family: "Georgia", system: true },
      { id: "eb-garamond",  name: "EB Garamond",    hint: "古典 Garamond，书卷气",     family: "EB Garamond" },
      { id: "source-serif", name: "Source Serif 4", hint: "Adobe 正文衬线，素净端正",   family: "Source Serif 4" },
      { id: "lora",         name: "Lora",           hint: "笔刷衬线，暖调柔和",         family: "Lora" },
      { id: "spectral",     name: "Spectral",       hint: "文学正文衬线，精致文气",     family: "Spectral" },
      { id: "libre-baskerville", name: "Libre Baskerville", hint: "高对比 Baskerville，字大清晰", family: "Libre Baskerville" },
    ],
  },
  {
    key: "display", cssVar: "--font-display", label: "标题字体",
    preview: "A. Two Buttons",
    choices: [
      { id: "",             name: "Playfair Display", hint: "高对比展示衬线（默认）",   family: "Playfair Display" },
      { id: "cormorant",    name: "Cormorant",        hint: "古典 Garamond 展示体，优雅", family: "Cormorant Garamond" },
    ],
  },
];

const storageKey = (roleKey: string) => `cfapp:font-${roleKey}`;
const dataAttr = (roleKey: string) => `data-font-${roleKey}`;

export function readFont(role: FontRole): string {
  try {
    const v = localStorage.getItem(storageKey(role.key));
    if (v && role.choices.some((c) => c.id === v)) return v;
  } catch {}
  return "";
}
export function applyFont(role: FontRole, id: string) {
  // "" = default: clear the attribute so the :root stack in themes.css wins.
  if (id === "") document.documentElement.removeAttribute(dataAttr(role.key));
  else document.documentElement.setAttribute(dataAttr(role.key), id);
  try { localStorage.setItem(storageKey(role.key), id); } catch {}
}
// Restore every role's saved pick — called once on startup.
export function applyAllFonts() {
  for (const role of FONT_ROLES) applyFont(role, readFont(role));
}
