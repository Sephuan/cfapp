// App UI language (English / 中文 / 混合). This mirrors the themes.ts read/apply
// idiom but adds a tiny subscribe store so that switching the language re-renders
// every subscriber (nav chrome + Settings) at once, without prop-drilling.
//
// "mix" reproduces the app's original pre-i18n look: English navigation chrome
// with a Chinese Settings page — a deliberate bilingual blend rather than a
// third full translation.
//
// UI language is a pure client concern (like the color/tr themes and fonts):
// it lives in localStorage and flips instantly. It is SEPARATE from the AI
// translation target language (config.ai.targetLang), which is server-consumed
// and persisted in config.json.
import { useSyncExternalStore } from "react";

export type Lang = "en" | "zh" | "mix";

const STORAGE_KEY = "cfapp:lang";

// First-run default follows the system locale: a zh* browser locale → 中文,
// everything else → English. Once the user picks explicitly we honor that
// (including the "mix" bilingual option).
export function readLang(): Lang {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "en" || v === "zh" || v === "mix") return v;
  } catch {}
  try {
    if (navigator.language?.toLowerCase().startsWith("zh")) return "zh";
  } catch {}
  return "en";
}

let current: Lang = readLang();
const listeners = new Set<() => void>();

export function getLang(): Lang {
  return current;
}

// <html lang> is tagged by the dominant script: mix is chrome-English but
// mostly-Chinese content, so we treat it like zh for the document language.
function htmlLangOf(l: Lang): string {
  return l === "en" ? "en" : "zh-CN";
}

export function setLang(l: Lang) {
  current = l;
  try { localStorage.setItem(STORAGE_KEY, l); } catch {}
  try { document.documentElement.lang = htmlLangOf(l); } catch {}
  listeners.forEach(fn => fn());
}

// Seed <html lang> once at module load so the very first paint is tagged right.
try { document.documentElement.lang = htmlLangOf(current); } catch {}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

// Subscribe a component to language changes. Returns [lang, setLang].
export function useLang(): [Lang, (l: Lang) => void] {
  const lang = useSyncExternalStore(subscribe, getLang, getLang);
  return [lang, setLang];
}

// ----- AI translation target languages -----
// Presets shown in the Settings dropdown, plus a "custom" escape hatch that
// reveals a free-text field. The stored value is the plain language name that
// gets interpolated into the translate system prompt (see api/translate-prompt).
export const AI_TARGET_PRESETS: string[] = [
  "中文", "English", "日本語", "한국어",
  "Español", "Français", "Deutsch", "Русский", "Português",
];

// ----- UI string dictionary -----
// Scope (agreed): navigation chrome + Settings page. Page bodies stay as-is.
export type StrKey =
  // nav — topbar titles
  | "nav.contests" | "nav.settings" | "nav.statistics"
  | "nav.submit" | "nav.standings" | "nav.mysubs" | "nav.login"
  // nav — bottom bar buttons
  | "bottom.main" | "bottom.submit" | "bottom.standings" | "bottom.mysubs" | "bottom.stats"
  | "bottom.pickContest"
  // nav — theme toggle + auth
  | "theme.dark" | "theme.light"
  | "auth.loggedIn" | "auth.rated" | "auth.unrated" | "auth.logout" | "auth.loginTooltip" | "auth.max"
  // settings — section headers
  | "set.h.account" | "set.h.ai" | "set.h.theme" | "set.h.trTheme"
  | "set.h.fonts" | "set.h.fontInfo" | "set.h.language" | "set.trPreview"
  // settings — account fields
  | "set.handle" | "set.handle.hint"
  | "set.apiKey" | "set.keepBlank" | "set.apiKey.hint"
  | "set.apiSecret" | "set.password" | "set.password.hint"
  // settings — ai fields
  | "set.baseUrl" | "set.baseUrl.hint" | "set.model"
  | "set.aiTarget" | "set.aiTarget.hint" | "set.aiTarget.custom" | "set.aiTarget.customPh"
  | "set.prompt" | "set.prompt.hint" | "set.prompt.reset"
  | "set.stream" | "set.stream.hint" | "set.stream.on" | "set.stream.off"
  // settings — language section
  | "set.appLang" | "set.appLang.hint" | "set.appLang.mix"
  // settings — theme controls
  | "set.mode" | "set.mode.light" | "set.mode.dark" | "set.palette"
  // settings — misc
  | "set.show" | "set.hide" | "set.save" | "set.saved" | "set.loading"
  | "set.default" | "set.system" | "font.loading" | "font.loaded" | "font.fallback" | "font.notLoaded"
  // settings — font-info diagnostic row labels
  | "diag.tr" | "diag.trLabel" | "diag.code"
  // problem page — inline AI translation status
  | "tr.busy" | "tr.failed";

const EN: Record<StrKey, string> = {
  "nav.contests": "Contests",
  "nav.settings": "Settings",
  "nav.statistics": "Statistics",
  "nav.submit": "Submit",
  "nav.standings": "Standings",
  "nav.mysubs": "My submissions",
  "nav.login": "Login",
  "bottom.main": "Main",
  "bottom.submit": "Submit",
  "bottom.standings": "Standings",
  "bottom.mysubs": "My subs",
  "bottom.stats": "Stats",
  "bottom.pickContest": "Pick a contest first",
  "theme.dark": "☾ dark",
  "theme.light": "☀ light",
  "auth.loggedIn": "Logged in",
  "auth.rated": "rated",
  "auth.unrated": "unrated",
  "auth.logout": "Log out",
  "auth.loginTooltip": "Open Codeforces login. Cookies sync back automatically.",
  "auth.max": "max",
  "set.h.account": "Codeforces account",
  "set.h.ai": "AI translation (OpenAI-compatible)",
  "set.h.theme": "Appearance",
  "set.h.trTheme": "Annotation style",
  "set.h.fonts": "Fonts",
  "set.h.fontInfo": "Font diagnostics",
  "set.h.language": "Language",
  "set.trPreview": "Statement annotation preview",
  "set.handle": "Handle",
  "set.handle.hint": "Your username — needed for submitting and personal standings",
  "set.apiKey": "API Key",
  "set.keepBlank": "Leave blank to keep unchanged",
  "set.apiKey.hint": "API Key from your CF settings (used only for signed query APIs)",
  "set.apiSecret": "API Secret",
  "set.password": "Password (for web-form code submission)",
  "set.password.hint": "Stored locally in ~/.config/cfapp/config.json in plaintext. Skip it and use just the API key if you prefer (but submitting code needs the password login).",
  "set.baseUrl": "Base URL",
  "set.baseUrl.hint": "Don't include /chat/completions — only up to /v1",
  "set.model": "Model",
  "set.aiTarget": "Translation target language",
  "set.aiTarget.hint": "The language AI translation renders into — saved automatically",
  "set.aiTarget.custom": "Custom…",
  "set.aiTarget.customPh": "e.g. Italiano, Tiếng Việt, العربية",
  "set.prompt": "Prompt template",
  "set.prompt.hint": "System prompt for translation. {lang} is replaced with the target language above; {source_text} is replaced with the text to translate.",
  "set.prompt.reset": "Reset to default",
  "set.stream": "Streaming translation",
  "set.stream.hint": "Show the translation word-by-word as it is generated",
  "set.stream.on": "On",
  "set.stream.off": "Off",
  "set.appLang": "App language",
  "set.appLang.hint": "Language of this app's interface",
  "set.appLang.mix": "Bilingual",
  "set.mode": "Light / dark",
  "set.mode.light": "Light",
  "set.mode.dark": "Dark",
  "set.palette": "Color palette",
  "set.show": "Show",
  "set.hide": "Hide",
  "set.save": "Save",
  "set.saved": "Saved.",
  "set.loading": "Loading…",
  "set.default": " (default)",
  "set.system": "system",
  "font.loading": "loading",
  "font.loaded": "loaded",
  "font.fallback": "fallback",
  "font.notLoaded": "(not loaded)",
  "diag.tr": "Annotation",
  "diag.trLabel": "Annotation tag",
  "diag.code": "Code",
  "tr.busy": "Translating…",
  "tr.failed": "Translation failed",
};

const ZH: Record<StrKey, string> = {
  "nav.contests": "比赛",
  "nav.settings": "设置",
  "nav.statistics": "统计",
  "nav.submit": "提交",
  "nav.standings": "榜单",
  "nav.mysubs": "我的提交",
  "nav.login": "登录",
  "bottom.main": "主页",
  "bottom.submit": "提交",
  "bottom.standings": "榜单",
  "bottom.mysubs": "我的提交",
  "bottom.stats": "统计",
  "bottom.pickContest": "请先选择一个比赛",
  "theme.dark": "☾ 深色",
  "theme.light": "☀ 浅色",
  "auth.loggedIn": "已登录",
  "auth.rated": "rated",
  "auth.unrated": "unrated",
  "auth.logout": "退出登录",
  "auth.loginTooltip": "打开 Codeforces 登录，Cookie 会自动同步回来。",
  "auth.max": "最高",
  "set.h.account": "Codeforces 账号",
  "set.h.ai": "AI 翻译（OpenAI 兼容）",
  "set.h.theme": "界面主题",
  "set.h.trTheme": "译注样式",
  "set.h.fonts": "字体",
  "set.h.fontInfo": "字体信息",
  "set.h.language": "语言",
  "set.trPreview": "题面译注预览",
  "set.handle": "Handle",
  "set.handle.hint": "用户名，做提交和查个人榜需要",
  "set.apiKey": "API Key",
  "set.keepBlank": "留空表示保持不变",
  "set.apiKey.hint": "CF 个人设置里的 API Key（仅用于查询签名 API）",
  "set.apiSecret": "API Secret",
  "set.password": "Password（用于网页登录提交代码）",
  "set.password.hint": "仅本机存储于 ~/.config/cfapp/config.json，明文。不想存就只用 API Key（但提交代码需要密码登录）",
  "set.baseUrl": "Base URL",
  "set.baseUrl.hint": "不要带 /chat/completions，只填到 /v1",
  "set.model": "Model",
  "set.aiTarget": "翻译目标语言",
  "set.aiTarget.hint": "AI 翻译输出的目标语言（选择后自动保存）",
  "set.aiTarget.custom": "自定义…",
  "set.aiTarget.customPh": "如 Italiano、Tiếng Việt、العربية",
  "set.prompt": "提示词模板",
  "set.prompt.hint": "翻译使用的系统提示词，其中 {lang} 会被替换为上面的目标语言，{source_text} 会被替换为待翻译的原文。",
  "set.prompt.reset": "恢复默认",
  "set.stream": "流式翻译",
  "set.stream.hint": "边生成边逐字显示译文",
  "set.stream.on": "开",
  "set.stream.off": "关",
  "set.appLang": "应用语言",
  "set.appLang.hint": "本应用界面的显示语言",
  "set.appLang.mix": "混合",
  "set.mode": "明暗模式",
  "set.mode.light": "浅色",
  "set.mode.dark": "深色",
  "set.palette": "配色方案",
  "set.show": "显示",
  "set.hide": "隐藏",
  "set.save": "保存",
  "set.saved": "已保存。",
  "set.loading": "加载中…",
  "set.default": "（默认）",
  "set.system": "系统",
  "font.loading": "加载中",
  "font.loaded": "已加载",
  "font.fallback": "回退",
  "font.notLoaded": "(未加载)",
  "diag.tr": "译注",
  "diag.trLabel": "译注标签",
  "diag.code": "代码",
  "tr.busy": "翻译中…",
  "tr.failed": "翻译失败",
};

// "mix" = the original pre-i18n bilingual look: English navigation chrome
// (nav / bottom bar / theme toggle / auth) with a Chinese Settings page and
// Chinese inline-translation status. Derived from EN/ZH by key prefix so it
// stays in sync automatically as strings are added. Chrome keys → EN; the rest
// (set. / font. / diag. / tr.) → ZH.
const CHROME_PREFIXES = ["nav.", "bottom.", "theme.", "auth."];
const MIX: Record<StrKey, string> = Object.fromEntries(
  (Object.keys(EN) as StrKey[]).map(k => [
    k,
    CHROME_PREFIXES.some(p => k.startsWith(p)) ? EN[k] : ZH[k],
  ]),
) as Record<StrKey, string>;

const TABLES: Record<Lang, Record<StrKey, string>> = { en: EN, zh: ZH, mix: MIX };

export function t(lang: Lang, key: StrKey): string {
  return TABLES[lang][key] ?? TABLES.en[key] ?? key;
}
