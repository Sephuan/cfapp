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
  | "set.baseUrl" | "set.baseUrl.hint" | "set.model" | "set.model.hint"
  | "set.model.fetching" | "set.model.fetchErr"
  | "set.model.custom" | "set.model.customPh"
  | "set.aiTarget" | "set.aiTarget.hint" | "set.aiTarget.custom" | "set.aiTarget.customPh"
  | "set.prompt" | "set.prompt.hint" | "set.prompt.reset"
  | "set.stream" | "set.stream.hint" | "set.stream.on" | "set.stream.off"
  | "set.test" | "set.testing" | "set.test.stream" | "set.test.nonstream" | "set.test.emptyCreds"
  // settings — automatic translation section
  | "set.h.autoTr"
  | "set.autoMode" | "set.autoMode.hint"
  | "set.autoMode.off" | "set.autoMode.full" | "set.autoMode.section" | "set.autoMode.paragraph"
  | "set.autoTrigger" | "set.autoTrigger.hint"
  | "set.autoTrigger.manual" | "set.autoTrigger.onopen"
  | "set.rpm" | "set.rpm.hint"
  | "set.concurrency" | "set.concurrency.hint"
  | "set.requestInterval" | "set.requestInterval.hint"
  | "set.rateTest" | "set.rateTest.run" | "set.rateTest.testing" | "set.rateTest.hint"
  | "set.rateTest.ok" | "set.rateTest.rateLimited" | "set.rateTest.failed"
  | "set.rateTest.card.testing" | "set.rateTest.card.testingSub" | "set.rateTest.card.testingNote"
  | "set.rateTest.card.okTitle" | "set.rateTest.card.okNote"
  | "set.rateTest.card.rateLimitedTitle" | "set.rateTest.card.rateLimitedNote"
  | "set.rateTest.card.failTitle" | "set.rateTest.card.failNote"
  | "set.rateTest.card.errTitle" | "set.rateTest.card.elapsed"
  | "set.rateTest.stat.ok" | "set.rateTest.stat.429" | "set.rateTest.stat.fail" | "set.rateTest.stat.time"
  | "set.rateTest.chip.conc" | "set.rateTest.chip.interval" | "set.rateTest.chip.rpm"
  | "set.rateTest.shotsHint"
  | "set.autoCollapse" | "set.autoCollapse.hint"
  | "set.autoCollapse.off" | "set.autoCollapse.on"
  // settings — language section
  | "set.appLang" | "set.appLang.hint" | "set.appLang.mix"
  // settings — theme controls
  | "set.mode" | "set.mode.light" | "set.mode.dark" | "set.palette"
  // settings — misc
  | "set.show" | "set.hide" | "set.save" | "set.saved" | "set.loading"
  | "set.default" | "set.system" | "font.loading" | "font.loaded" | "font.fallback" | "font.notLoaded"
  | "font.custom.choice" | "font.custom.lib" | "font.custom.libHint"
  | "font.custom.upload" | "font.custom.uploading" | "font.custom.uploaded"
  | "font.custom.delete" | "font.custom.familyPh" | "font.custom.normal" | "font.custom.italic"
  | "font.custom.empty" | "font.custom.pickHint" | "font.custom.using" | "font.custom.msHint"
  // settings — font-info diagnostic row labels
  | "diag.tr" | "diag.trLabel" | "diag.code"
  // problem page — inline AI translation status
  | "tr.busy" | "tr.failed"
  // problem page — auto-translate controls
  | "prob.autoTr" | "prob.autoTring" | "prob.autoTrDone"
  | "prob.autoRetry" | "prob.autoRetryOne" | "prob.autoErr" | "prob.autoClear"
  | "prob.autoCollapse" | "prob.autoCollapse.expand"
  | "prob.retranslate" | "prob.autoTrOffHint";

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
  "set.keepBlank": "Paste or edit — auto-saves",
  "set.apiKey.hint": "API Key from your CF settings (used only for signed query APIs). Auto-saves as you type.",
  "set.apiSecret": "API Secret",
  "set.password": "Password (for web-form code submission)",
  "set.password.hint": "Stored locally in the app config file (platform data dir) in plaintext. Use the eye button to show/hide while editing. Auto-saves.",
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
  // settings — auto-translate section
  "set.h.autoTr": "Auto-translate",
  "set.autoMode": "Granularity",
  "set.autoMode.hint": "Off: manual selection only. Full: whole statement in one request. Section: one block per section. Paragraph: one block per paragraph.",
  "set.autoMode.off": "Off",
  "set.autoMode.full": "Full",
  "set.autoMode.section": "Section",
  "set.autoMode.paragraph": "Paragraph",
  "set.autoTrigger": "Trigger",
  "set.autoTrigger.hint": "Manual: translate only when you press the button. On open: start automatically when a problem opens (if a cache hit exists, show it instead).",
  "set.autoTrigger.manual": "Manual",
  "set.autoTrigger.onopen": "On open",
  "set.rpm": "Rate limit (requests / min)",
  "set.rpm.hint": "Hard cap: max translation request starts in any rolling 60 seconds. ∞ = unlimited. Independent of the interval below (does not turn into a fixed 60s/rpm pause between every request).",
  "set.concurrency": "Concurrency",
  "set.concurrency.hint": "How many segments to translate in parallel.",
  "set.requestInterval": "Request interval (ms)",
  "set.requestInterval.hint": "Minimum gap between successive request starts (ms). With concurrency=3 and 200ms: start #1 at T0, #2 at T0+200, #3 at T0+400; when a slot frees, wait until 200ms after the previous start. Separate from RPM (per-minute total budget).",
  "set.rateTest": "Test current rate settings",
  "set.rateTest.run": "Run rate test",
  "set.rateTest.testing": "Testing…",
  "set.rateTest.hint": "Uses the concurrency, interval, and RPM above (same scheduler as auto-translate). A 429 means those knobs are too aggressive. Does not change your settings.",
  "set.rateTest.ok": "{n}/{total} ok in {ms}ms — current settings look fine",
  "set.rateTest.rateLimited": "429 on {n}/{total} in {ms}ms — current concurrency/interval/RPM is too aggressive",
  "set.rateTest.failed": "{ok} ok, {fail} failed of {total} in {ms}ms (not rate-limited — check key/model/network)",
  "set.rateTest.card.testing": "Running rate probe…",
  "set.rateTest.card.testingSub": "please wait",
  "set.rateTest.card.testingNote": "Sending short chat pings under your current rate knobs.",
  "set.rateTest.card.okTitle": "Settings look fine",
  "set.rateTest.card.okNote": "Every probe request succeeded — this concurrency / interval / RPM should work for auto-translate.",
  "set.rateTest.card.rateLimitedTitle": "Rate limited (429)",
  "set.rateTest.card.rateLimitedNote": "The provider rejected some requests. Lower concurrency, raise the interval, or lower RPM, then test again.",
  "set.rateTest.card.failTitle": "Probe incomplete",
  "set.rateTest.card.failNote": "Some requests failed without a 429 — check API key, model, or network.",
  "set.rateTest.card.errTitle": "Could not start probe",
  "set.rateTest.card.elapsed": "took {ms}",
  "set.rateTest.stat.ok": "Succeeded",
  "set.rateTest.stat.429": "HTTP 429",
  "set.rateTest.stat.fail": "Other errors",
  "set.rateTest.stat.time": "Elapsed",
  "set.rateTest.chip.conc": "Concurrency {n}",
  "set.rateTest.chip.interval": "Interval {n}ms",
  "set.rateTest.chip.rpm": "RPM {n}",
  "set.rateTest.shotsHint": "Each square is one probe request (hover for detail)",
  "set.autoCollapse": "Collapse full-text translation",
  "set.autoCollapse.hint": "In Full mode, whether the translation card starts collapsed.",
  "set.autoCollapse.off": "Start expanded",
  "set.autoCollapse.on": "Start collapsed",
  // problem page — auto-translate controls
  "prob.autoTr": "Auto-translate",
  "prob.autoTring": "Translating…",
  "prob.autoTrDone": "Done",
  "prob.autoRetry": "Retry failed",
  "prob.autoRetryOne": "Retry",
  "prob.autoErr": "{n} failed",
  "prob.autoClear": "Clear",
  "prob.autoCollapse": "Collapse",
  "prob.autoCollapse.expand": "Expand",
  "prob.retranslate": "Re-translate",
  "prob.autoTrOffHint": "Enable auto-translate in Settings",
  "set.model.hint": "Pull models from provider, or type a custom id",
  "set.model.fetching": "Pulling…",
  "set.model.fetchErr": "Pull failed — type manually",
  "set.model.custom": "Custom…",
  "set.model.customPh": "model id, e.g. gpt-4o",
  "set.test": "Test connection",
  "set.testing": "Testing…",
  "set.test.stream": "Stream",
  "set.test.nonstream": "Non-stream",
  "set.test.emptyCreds": "Set base URL, key and model first",
  "set.appLang": "App language",
  "set.appLang.hint": "Language of this app's interface",
  "set.appLang.mix": "Bilingual",
  "set.mode": "Light / dark",
  "set.mode.light": "Light",
  "set.mode.dark": "Dark",
  "set.palette": "Color palette",
  "set.show": "Show",
  "set.hide": "Hide",
  "set.save": "Save now",
  "set.saved": "Saved.",
  "set.loading": "Loading…",
  "set.default": " (default)",
  "set.system": "system",
  "font.loading": "loading",
  "font.loaded": "loaded",
  "font.fallback": "fallback",
  "font.notLoaded": "(not loaded)",
  "font.custom.choice": "Custom…",
  "font.custom.lib": "Custom fonts",
  "font.custom.libHint": "Upload TTF / OTF / WOFF / WOFF2. Built-in “Georgia” is open Gelasio; real Microsoft Georgia (if found on this machine) is imported here as a separate family.",
  "font.custom.upload": "Choose font file…",
  "font.custom.uploading": "Uploading…",
  "font.custom.uploaded": "Added “{family}”",
  "font.custom.delete": "Remove",
  "font.custom.familyPh": "CSS family name (e.g. Microsoft Georgia)",
  "font.custom.normal": "Regular",
  "font.custom.italic": "Italic",
  "font.custom.empty": "No custom fonts yet — upload one above",
  "font.custom.pickHint": "Pick a family from your custom library",
  "font.custom.using": "Using custom family “{family}”",
  "font.custom.msHint": "“{family}” was imported from a local Windows/Proton font file — this is the real Microsoft Georgia, not the bundled Gelasio.",
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
  "set.keepBlank": "直接粘贴或编辑，自动保存",
  "set.apiKey.hint": "CF 个人设置里的 API Key（仅用于查询签名 API）。输入后自动保存。",
  "set.apiSecret": "API Secret",
  "set.password": "Password（用于网页登录提交代码）",
  "set.password.hint": "仅本机存储于应用配置目录（各系统路径见 README）的 config.json，明文。用右侧眼睛按钮显示/隐藏以便修改。输入后自动保存。",
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
  "set.h.autoTr": "自动翻译",
  "set.autoMode": "拆分粒度",
  "set.autoMode.hint": "全文=整篇一次请求；大段=题面/输入/输出/注释各一块；逐段=每个 <p>/<ul>/<div> 一片",
  "set.autoMode.off": "关闭",
  "set.autoMode.full": "全文",
  "set.autoMode.section": "大段",
  "set.autoMode.paragraph": "逐段",
  "set.autoTrigger": "触发方式",
  "set.autoTrigger.hint": "手动=题目页点按钮；打开题面自动=数据到达且无缓存即开始",
  "set.autoTrigger.manual": "手动",
  "set.autoTrigger.onopen": "打开题面自动",
  "set.rpm": "速率 (RPM)",
  "set.rpm.hint": "硬上限：任意滚动 60 秒内最多启动这么多次请求，∞ 表示不限制。与下方启动间隔独立——不会把 RPM 折成「每次固定等 60/rpm 秒」。",
  "set.concurrency": "并发数",
  "set.concurrency.hint": "同时在途的翻译请求数",
  "set.requestInterval": "请求启动间隔",
  "set.requestInterval.hint": "相邻两次请求 *启动* 的最小间隔（毫秒）。例如并发=3、间隔=200ms：T0 发#1，T0+200 发#2，T0+400 发#3；任一完成后距上次启动满 200ms 再发下一个。与 RPM（每分钟总数）是两套限制。",
  "set.rateTest": "测试当前限流配置",
  "set.rateTest.run": "开始测试",
  "set.rateTest.testing": "测试中…",
  "set.rateTest.hint": "按上方并发、启动间隔、RPM 调度（与自动翻译相同）。出现 429 说明配置过激。不会自动改设置。",
  "set.rateTest.ok": "{n}/{total} 成功，耗时 {ms}ms — 当前配置可用",
  "set.rateTest.rateLimited": "{n}/{total} 次返回 429，耗时 {ms}ms — 当前并发/间隔/RPM 过激",
  "set.rateTest.failed": "{ok} 成功、{fail} 失败 / 共 {total}，耗时 {ms}ms（非限流问题，请检查密钥/模型/网络）",
  "set.rateTest.card.testing": "正在探测限流…",
  "set.rateTest.card.testingSub": "请稍候",
  "set.rateTest.card.testingNote": "按当前限流参数发送极短 chat 请求。",
  "set.rateTest.card.okTitle": "当前配置可用",
  "set.rateTest.card.okNote": "全部探测请求成功——这组并发 / 间隔 / RPM 可用于自动翻译。",
  "set.rateTest.card.rateLimitedTitle": "触发限流 (429)",
  "set.rateTest.card.rateLimitedNote": "服务商拒绝了部分请求。请降低并发、加大间隔或降低 RPM 后再测。",
  "set.rateTest.card.failTitle": "探测未完成",
  "set.rateTest.card.failNote": "有请求失败但不是 429——请检查密钥、模型或网络。",
  "set.rateTest.card.errTitle": "无法开始探测",
  "set.rateTest.card.elapsed": "耗时 {ms}",
  "set.rateTest.stat.ok": "成功",
  "set.rateTest.stat.429": "HTTP 429",
  "set.rateTest.stat.fail": "其他失败",
  "set.rateTest.stat.time": "总耗时",
  "set.rateTest.chip.conc": "并发 {n}",
  "set.rateTest.chip.interval": "间隔 {n}ms",
  "set.rateTest.chip.rpm": "RPM {n}",
  "set.rateTest.shotsHint": "每个方块为一次探测请求（悬停看详情）",
  "set.autoCollapse": "全文译文默认收起",
  "set.autoCollapse.hint": "仅全文模式：译文卡片打开时默认折叠",
  "set.autoCollapse.off": "默认展开",
  "set.autoCollapse.on": "默认收起",
  "prob.autoTr": "自动翻译",
  "prob.autoTring": "翻译中…",
  "prob.autoTrDone": "完成",
  "prob.autoRetry": "重试失败段",
  "prob.autoRetryOne": "重试",
  "prob.autoErr": "{n} 段失败",
  "prob.autoClear": "清除译文",
  "prob.autoCollapse": "收起",
  "prob.autoCollapse.expand": "展开",
  "prob.retranslate": "重新翻译",
  "prob.autoTrOffHint": "请在设置里开启自动翻译",
  "set.model.hint": "从服务商拉取模型，或手动输入 id",
  "set.model.fetching": "拉取中…",
  "set.model.fetchErr": "拉取失败，请手输",
  "set.model.custom": "自定义…",
  "set.model.customPh": "模型 id，如 gpt-4o",
  "set.test": "测试连接",
  "set.testing": "测试中…",
  "set.test.stream": "流式",
  "set.test.nonstream": "非流式",
  "set.test.emptyCreds": "请先填写 Base URL、密钥和模型",
  "set.appLang": "应用语言",
  "set.appLang.hint": "本应用界面的显示语言",
  "set.appLang.mix": "混合",
  "set.mode": "明暗模式",
  "set.mode.light": "浅色",
  "set.mode.dark": "深色",
  "set.palette": "配色方案",
  "set.show": "显示",
  "set.hide": "隐藏",
  "set.save": "立即保存",
  "set.saved": "已保存。",
  "set.loading": "加载中…",
  "set.default": "（默认）",
  "set.system": "系统",
  "font.loading": "加载中",
  "font.loaded": "已加载",
  "font.fallback": "回退",
  "font.notLoaded": "(未加载)",
  "font.custom.choice": "自定义…",
  "font.custom.lib": "自定义字体库",
  "font.custom.libHint": "可上传 TTF / OTF / WOFF / WOFF2。内置「Georgia」是开源 Gelasio 近似体；本机若有微软 Georgia（Proton/Wine/系统），会自动导入到此库，族名独立。",
  "font.custom.upload": "选择字体文件…",
  "font.custom.uploading": "上传中…",
  "font.custom.uploaded": "已添加「{family}」",
  "font.custom.delete": "删除",
  "font.custom.familyPh": "CSS 族名（如 Microsoft Georgia）",
  "font.custom.normal": "常规",
  "font.custom.italic": "斜体",
  "font.custom.empty": "还没有自定义字体 — 请先上传",
  "font.custom.pickHint": "从自定义字体库中选择一个族名",
  "font.custom.using": "正在使用自定义族「{family}」",
  "font.custom.msHint": "已从本机 Windows/Proton 字体文件导入「{family}」——这是真正的微软 Georgia，不是项目内的 Gelasio。",
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
