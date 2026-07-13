// Translation-annotation palettes. Picking one writes data-tr-theme onto
// <html>; CSS variables recolor every existing .cf-tr block instantly.
// Values must match the [data-tr-theme="…"] selectors in styles/themes.css.
export type TrTheme = "amber" | "ink" | "indigo" | "cinnabar" | "plum";
// name/hint are the Chinese labels; nameEn/hintEn the English ones. The Settings
// picker chooses per the active app language (see i18n.ts / pickLang below).
export const TR_THEMES: { id: TrTheme; name: string; nameEn: string; hint: string; hintEn: string; line: string; text: string; labelBg: string; labelFg: string }[] = [
  { id: "amber",    name: "赭黄", nameEn: "Amber",    hint: "暖调浸染，与皮装书调性一致", hintEn: "Warm wash, matches the Leather Book palette",
    line: "#b45309", text: "#7c4a12", labelBg: "#b45309", labelFg: "#fff8ec" },
  { id: "ink",      name: "青墨", nameEn: "Ink",      hint: "冷墨批注，与暖正文对仗最克制", hintEn: "Cool ink notes, most restrained against warm body text",
    line: "#3f6b78", text: "#3f6b78", labelBg: "#3f6b78", labelFg: "#f0f4f5" },
  { id: "indigo",   name: "靛蓝", nameEn: "Indigo",   hint: "古典注疏，区分度最高", hintEn: "Classic annotation, highest contrast",
    line: "#1e3a8a", text: "#1e3a8a", labelBg: "#1e3a8a", labelFg: "#eef2ff" },
  { id: "cinnabar", name: "朱砂", nameEn: "Cinnabar", hint: "传统批注红，醒目如朱笔圈点", hintEn: "Scholar's vermilion — bold as a red brush mark",
    line: "#b91c1c", text: "#9f1239", labelBg: "#b91c1c", labelFg: "#fff5f5" },
  { id: "plum",     name: "紫藤", nameEn: "Plum",     hint: "淡紫批注，与紫罗兰主题最相宜", hintEn: "Soft wisteria notes, pairs best with Violet",
    line: "#6d28d9", text: "#5b21b6", labelBg: "#6d28d9", labelFg: "#f5f3ff" },
];

// Resolve a bilingual pair for the active language. Kept here so themes.ts owns
// its own typography copy rather than duplicating it into the i18n dictionary.
// Only "en" gets the English copy; "zh" and "mix" both show Chinese (the
// original Settings page — which "mix" reproduces — was Chinese).
export function pickLang<T>(lang: "en" | "zh" | "mix", zh: T, en: T): T {
  return lang === "en" ? en : zh;
}
export function readTrTheme(): TrTheme {
  try {
    const v = localStorage.getItem("cfapp:tr-theme");
    if (v && TR_THEMES.some((t) => t.id === v)) return v as TrTheme;
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
export const COLOR_THEMES: { id: ColorTheme; name: string; nameEn: string; hint: string; hintEn: string;
  headerBg: string; accent: string; surface: string }[] = [
  { id: "",           name: "皮装书", nameEn: "Leather Book", hint: "暖棕皮面，cream 纸质", hintEn: "Warm brown leather, cream paper",
    headerBg: "#3d2817", accent: "#b45309", surface: "#ffffff" },
  { id: "cool-gray",  name: "冷灰蓝", nameEn: "Cool Gray", hint: "冷静科技感，GitHub Dark 中性冷调", hintEn: "Calm & technical, GitHub Dark neutral tone",
    headerBg: "#1e293b", accent: "#2563eb", surface: "#ffffff" },
  { id: "forest",     name: "森绿",   nameEn: "Forest", hint: "深森林苔藓，沉浸自然质感", hintEn: "Deep forest moss, immersive natural feel",
    headerBg: "#1a2e1a", accent: "#2d6a2e", surface: "#fafcf7" },
  { id: "rosegold",   name: "玫瑰金", nameEn: "Rose Gold", hint: "暖粉棕优雅柔美，偏女性化设计", hintEn: "Warm pink-brown, elegant & soft",
    headerBg: "#3d2028", accent: "#b76e79", surface: "#fffbf7" },
  { id: "violet",     name: "紫罗兰", nameEn: "Violet", hint: "深紫典雅，神秘中带优雅气质", hintEn: "Deep violet, mysterious yet refined",
    headerBg: "#2e1a47", accent: "#7c3aed", surface: "#fdfbff" },
  { id: "obsidian",   name: "墨黑",   nameEn: "Obsidian", hint: "纯黑极简，AMOLED 最大对比度", hintEn: "Pure-black minimal, max AMOLED contrast",
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
// `system: true` means the primary family is a pure OS font we don't ship
// via fonts.ts — the picker shows "系统" instead of a load ✓/✗ badge.
//
// Built-in "Georgia" is Gelasio (open, metric-compatible), registered as
// font-family "Georgia". Real Microsoft Georgia cannot be redistributed; it
// is imported into the custom-font library as "Microsoft Georgia" when the
// user already has the TTF locally (Proton / Wine / msttcorefonts).
//
// id "custom" is special: the CSS family comes from --font-<role>-custom
// (set by applyFont with a family name) and localStorage key
// cfapp:font-<role>-family.
export const CUSTOM_FONT_CHOICE_ID = "custom";

export type FontChoice = {
  id: string;
  name: string;
  hint: string;
  hintEn: string;      // English hint (name is a font family, same in both langs)
  family: string;      // primary family, used for the picker's live preview
  system?: boolean;    // true → not shipped by fonts.ts, always "available"
};
export type FontRole = {
  key: string;         // data attr suffix + storage key, e.g. "body"
  cssVar: string;      // the CSS variable this role drives, e.g. "--font-body"
  label: string;       // section label in Settings
  labelEn: string;     // English section label
  preview: string;     // sample text for the picker — mirror what this role renders
  choices: FontChoice[]; // choices[0] must be the default (id "")
};

export const FONT_ROLES: FontRole[] = [
  {
    key: "body", cssVar: "--font-body", label: "正文字体", labelEn: "Body font",
    preview: "Codeforces Round 1000 (Div. 2)",
    choices: [
      { id: "",             name: "Newsreader",     hint: "报刊衬线，笔画对比鲜明",     hintEn: "Newspaper serif, high stroke contrast",  family: "Newsreader" },
      { id: "source-serif", name: "Source Serif 4", hint: "Adobe 正文衬线，素净端正",   hintEn: "Adobe text serif, clean & upright",       family: "Source Serif 4" },
      { id: "eb-garamond",  name: "EB Garamond",    hint: "古典 Garamond，笔画纤细",   hintEn: "Classic Garamond, slender strokes",       family: "EB Garamond" },
      { id: "lora",         name: "Lora",           hint: "笔刷衬线，暖调柔和",         hintEn: "Brush serif, warm & soft",                family: "Lora" },
      { id: "spectral",     name: "Spectral",       hint: "文学正文衬线，精致文气",     hintEn: "Literary text serif, refined",            family: "Spectral" },
      { id: "bitter",       name: "Bitter",         hint: "板衬线，方正厚实",           hintEn: "Slab serif, square & sturdy",             family: "Bitter" },
      { id: "georgia",      name: "Georgia",        hint: "Gelasio 开源近似（项目缓存）", hintEn: "Gelasio open approx. (bundled)",          family: "Georgia" },
      { id: CUSTOM_FONT_CHOICE_ID, name: "自定义…", hint: "使用已上传的自定义字体",       hintEn: "Use an uploaded custom font",            family: "" },
    ],
  },
  {
    key: "statement", cssVar: "--font-statement", label: "题面字体", labelEn: "Statement font",
    preview: "You are given an array of n integers.",
    choices: [
      { id: "",             name: "Georgia",        hint: "Gelasio 开源近似（默认缓存）", hintEn: "Gelasio open approx. (default, bundled)", family: "Georgia" },
      { id: "eb-garamond",  name: "EB Garamond",    hint: "古典 Garamond，书卷气",     hintEn: "Classic Garamond, bookish",               family: "EB Garamond" },
      { id: "source-serif", name: "Source Serif 4", hint: "Adobe 正文衬线，素净端正",   hintEn: "Adobe text serif, clean & upright",       family: "Source Serif 4" },
      { id: "lora",         name: "Lora",           hint: "笔刷衬线，暖调柔和",         hintEn: "Brush serif, warm & soft",                family: "Lora" },
      { id: "spectral",     name: "Spectral",       hint: "文学正文衬线，精致文气",     hintEn: "Literary text serif, refined",            family: "Spectral" },
      { id: "libre-baskerville", name: "Libre Baskerville", hint: "高对比 Baskerville，字大清晰", hintEn: "High-contrast Baskerville, large & clear", family: "Libre Baskerville" },
      { id: CUSTOM_FONT_CHOICE_ID, name: "自定义…", hint: "使用已上传的自定义字体",       hintEn: "Use an uploaded custom font",            family: "" },
    ],
  },
  {
    key: "display", cssVar: "--font-display", label: "标题字体", labelEn: "Heading font",
    preview: "A. Two Buttons",
    choices: [
      { id: "",             name: "Playfair Display", hint: "高对比展示衬线（默认）",   hintEn: "High-contrast display serif (default)",   family: "Playfair Display" },
      { id: "cormorant",    name: "Cormorant",        hint: "古典 Garamond 展示体，优雅", hintEn: "Classic Garamond display, elegant",     family: "Cormorant Garamond" },
      { id: CUSTOM_FONT_CHOICE_ID, name: "自定义…",   hint: "使用已上传的自定义字体",     hintEn: "Use an uploaded custom font",            family: "" },
    ],
  },
];

const storageKey = (roleKey: string) => `cfapp:font-${roleKey}`;
const familyStorageKey = (roleKey: string) => `cfapp:font-${roleKey}-family`;
const dataAttr = (roleKey: string) => `data-font-${roleKey}`;
const customCssVar = (roleKey: string) => `--font-${roleKey}-custom`;

// Written when the user deliberately picks the built-in default (id "").
// Distinct from a missing key (never configured), so auto-prefer of
// Microsoft Georgia only runs once for brand-new installs — not after the
// user explicitly chooses Gelasio/"default" again.
export const FONT_DEFAULT_SENTINEL = "__default__";

export type ApplyFontOpts = {
  /**
   * true (default): write localStorage (user action or intentional preference).
   * false: restore DOM from already-stored prefs only — do not invent a
   * preference. Critical so applyAllFonts() does not stamp "__default__" and
   * block preferMicrosoftGeorgiaIfUnset on first launch.
   */
  persist?: boolean;
};

export function readFont(role: FontRole): string {
  try {
    const v = localStorage.getItem(storageKey(role.key));
    if (v === null) return "";
    // Explicit built-in default (or legacy empty string).
    if (v === FONT_DEFAULT_SENTINEL || v === "") return "";
    if (v === CUSTOM_FONT_CHOICE_ID) return CUSTOM_FONT_CHOICE_ID;
    if (role.choices.some((c) => c.id === v)) return v;
  } catch {}
  return "";
}

/** true only when the user has never written cfapp:font-<role> (first run). */
export function isFontPreferenceUnset(roleKey: string): boolean {
  try {
    return localStorage.getItem(storageKey(roleKey)) === null;
  } catch {
    return true;
  }
}

export function readCustomFontFamily(role: FontRole): string {
  try {
    return localStorage.getItem(familyStorageKey(role.key)) || "";
  } catch {
    return "";
  }
}

function setCustomFamilyVar(roleKey: string, family: string) {
  const el = document.documentElement;
  if (family) {
    // CSS var holds a quoted family so stacks can do: var(--font-X-custom), …
    el.style.setProperty(customCssVar(roleKey), `"${family.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);
  } else {
    el.style.removeProperty(customCssVar(roleKey));
  }
}

/**
 * Apply a font role pick.
 * @param id built-in choice id, "" for default, or CUSTOM_FONT_CHOICE_ID
 * @param customFamily required when id === "custom" — CSS font-family name
 */
export function applyFont(role: FontRole, id: string, customFamily?: string, opts?: ApplyFontOpts) {
  const persist = opts?.persist !== false;
  const el = document.documentElement;
  if (id === CUSTOM_FONT_CHOICE_ID) {
    const fam = (customFamily ?? readCustomFontFamily(role)).trim();
    if (!fam) {
      // Custom selected but no family yet — fall back to default until the
      // user picks one in the secondary dropdown.
      el.removeAttribute(dataAttr(role.key));
      setCustomFamilyVar(role.key, "");
      if (persist) {
        try {
          localStorage.setItem(storageKey(role.key), CUSTOM_FONT_CHOICE_ID);
        } catch {}
      }
      return;
    }
    el.setAttribute(dataAttr(role.key), CUSTOM_FONT_CHOICE_ID);
    setCustomFamilyVar(role.key, fam);
    if (persist) {
      try {
        localStorage.setItem(storageKey(role.key), CUSTOM_FONT_CHOICE_ID);
        localStorage.setItem(familyStorageKey(role.key), fam);
      } catch {}
    }
    return;
  }

  // Leaving custom: drop the CSS var so it doesn't leak into other stacks.
  setCustomFamilyVar(role.key, "");
  if (persist) {
    try { localStorage.removeItem(familyStorageKey(role.key)); } catch {}
  }

  // "" = built-in default: clear the attribute so the :root stack wins.
  if (id === "") {
    el.removeAttribute(dataAttr(role.key));
    if (persist) {
      // Stamp an explicit "user chose default" marker — do NOT removeItem.
      // Missing key is reserved for "never configured" (auto-prefer MS Georgia).
      try { localStorage.setItem(storageKey(role.key), FONT_DEFAULT_SENTINEL); } catch {}
    }
  } else {
    el.setAttribute(dataAttr(role.key), id);
    if (persist) {
      try { localStorage.setItem(storageKey(role.key), id); } catch {}
    }
  }
}

// Restore every role's saved pick — called once on startup.
// persist:false so we never invent "__default__" for never-configured roles.
export function applyAllFonts() {
  for (const role of FONT_ROLES) {
    const id = readFont(role);
    if (id === CUSTOM_FONT_CHOICE_ID) {
      applyFont(role, CUSTOM_FONT_CHOICE_ID, readCustomFontFamily(role), { persist: false });
    } else {
      applyFont(role, id, undefined, { persist: false });
    }
  }
}

/**
 * After custom fonts are loaded: if the user has **never** set a statement
 * pick (key absent) and Microsoft Georgia is in the library, prefer it for
 * statement (local MS TTF rather than open Gelasio "Georgia" default).
 *
 * Does NOT run when the user has explicitly chosen the built-in default
 * (FONT_DEFAULT_SENTINEL) or any other pick — including after they switch
 * back from MS Georgia to default.
 */
export function preferMicrosoftGeorgiaIfUnset(msFamily: string, availableFamilies: string[]) {
  if (!msFamily || !availableFamilies.includes(msFamily)) return;
  try {
    if (!isFontPreferenceUnset("statement")) return;
    const role = FONT_ROLES.find((r) => r.key === "statement");
    if (!role) return;
    applyFont(role, CUSTOM_FONT_CHOICE_ID, msFamily, { persist: true });
  } catch {}
}
