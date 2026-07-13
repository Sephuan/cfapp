import { useEffect, useRef, useState } from "react";
import type { AppConfig } from "../shared";
import {
  COLOR_THEMES, TR_THEMES,
  applyColorTheme, applyTrTheme,
  readColorTheme, readTrTheme, pickLang,
  type ColorTheme, type TrTheme,
} from "../themes";
import { useLang, t, setLang } from "../i18n";
import { DEFAULT_TRANSLATE_PROMPT } from "../../api/translate-prompt";
import { normalizeConfig } from "./settings/normalize-config";
import { FontsSection, FontInfoTable } from "./settings/FontSettings";
import { AiTargetPicker } from "./settings/AiTargetPicker";
import { ModelPicker } from "./settings/ModelPicker";
import { AutoTranslateSettings } from "./settings/AutoTranslateSettings";

const AUTOSAVE_MS = 400;

export function SettingsPage({ theme, onToggleTheme }: { theme: "light" | "dark"; onToggleTheme: () => void }) {
  const [lang] = useLang();
  // The config object is mutable and the Settings form must own its own copy,
  // so we fetch it directly (no cache) and mirror into local state.
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [trTheme, setTrTheme] = useState<TrTheme>(readTrTheme);
  const [colorTheme, setColorTheme] = useState<ColorTheme>(readColorTheme);
  const [showApiKey, setShowApiKey] = useState(false);
  const [showApiSecret, setShowApiSecret] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showAiKey, setShowAiKey] = useState(false);

  // useFetchJSON seeds state from a module-scoped Map; but the config object
  // is mutable and we want the Settings form to own its own copy. The hook's
  // `data` is read-only, so we mirror it into local state once it arrives.
  const [local, setLocal] = useState<AppConfig | null>(null);
  useEffect(() => { if (cfg && !local) setLocal(cfg); }, [cfg, local]);

  // Auto-save: every field change schedules a debounced PUT of the full form.
  // pendingRef holds the latest snapshot so a slow response never overwrites a
  // newer local edit (we never setLocal from the PUT response while typing).
  const pendingRef = useRef<AppConfig | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveGenRef = useRef(0);
  const langRef = useRef(lang);
  langRef.current = lang;

  // Fetch config on mount
  useEffect(() => {
    fetch("/api/config")
      .then(r => r.json())
      .then((c: AppConfig) => setCfg(normalizeConfig(c)))
      .catch(() => {});
  }, []);

  // Flush any pending autosave when leaving the page.
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      const pending = pendingRef.current;
      if (pending) {
        pendingRef.current = null;
        void fetch("/api/config", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(pending),
        }).catch(() => {});
      }
    };
  }, []);

  const flushPersist = async (next: AppConfig) => {
    const gen = ++saveGenRef.current;
    try {
      const r = await fetch("/api/config", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      // Ignore stale responses — a newer keystroke already supersedes this save.
      if (gen !== saveGenRef.current) return;
      pendingRef.current = null;
      setMsg({ ok: true, text: t(langRef.current, "set.saved") });
    } catch (e: any) {
      if (gen !== saveGenRef.current) return;
      setMsg({ ok: false, text: e.message || String(e) });
    }
  };

  const schedulePersist = (next: AppConfig) => {
    setLocal(next);
    pendingRef.current = next;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const toSave = pendingRef.current;
      if (toSave) void flushPersist(toSave);
    }, AUTOSAVE_MS);
  };

  if (!local) return <div className="container"><div className="loading">{t(lang, "set.loading")}</div></div>;
  const upd = (patch: Partial<AppConfig>) => schedulePersist({ ...local, ...patch });
  const updAi = (patch: Partial<AppConfig["ai"]>) => schedulePersist({ ...local, ai: { ...local.ai, ...patch } });

  // Immediate persist (toggles / presets): skip the debounce so a single click
  // is durable before the user navigates away.
  const persistNow = (next: AppConfig) => {
    setLocal(next);
    pendingRef.current = next;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    void flushPersist(next);
  };
  const persistTargetLang = (targetLang: string) => persistNow({ ...local, ai: { ...local.ai, targetLang } });
  const persistPromptTemplate = (promptTemplate: string) => persistNow({ ...local, ai: { ...local.ai, promptTemplate } });
  const persistStream = (stream: boolean) => persistNow({ ...local, ai: { ...local.ai, stream } });
  const persistModel = (model: string) => persistNow({ ...local, ai: { ...local.ai, model } });
  // Auto-translate controls persist immediately too (toggles/dropdowns, like
  // stream/model) so a pick is durable before the user navigates away.
  const persistAiNow = (patch: Partial<AppConfig["ai"]>) =>
    persistNow({ ...local, ai: { ...local.ai, ...patch } });

  const secretBtn = (shown: boolean, toggle: () => void) => (
    <button
      type="button"
      onClick={toggle}
      title={shown ? t(lang, "set.hide") : t(lang, "set.show")}
      style={{ background: "none", border: "1px solid var(--border)", borderRadius: 5, cursor: "pointer", padding: "0.3rem 0.5rem", fontSize: "0.9rem", lineHeight: 1, color: "var(--text)" }}
    >{shown ? "🙈" : "👁"}</button>
  );
  // Real value always; type=password masks via the browser. Never substitute
  // "***" as the controlled value — that blocked mid-edit and corrupted the
  // secret on the first keystroke while hidden.
  const secretInput = (shown: boolean, value: string, onChange: (v: string) => void, placeholder: string) => (
    <input
      type={shown ? "text" : "password"}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      autoComplete="off"
      spellCheck={false}
      style={{ flex: 1 }}
    />
  );

  return (
    <div className="container">
      <div className="card settings">
        <h2>{t(lang, "set.h.account")}</h2>
        <div className="field">
          <label>{t(lang, "set.handle")}</label>
          <input value={local.handle} onChange={e => upd({ handle: e.target.value })} placeholder="your_handle" />
          <span className="hint">{t(lang, "set.handle.hint")}</span>
        </div>
        <div className="field">
          <label>{t(lang, "set.apiKey")}</label>
          <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
            {secretInput(showApiKey, local.apiKey, v => upd({ apiKey: v }), t(lang, "set.keepBlank"))}
            {secretBtn(showApiKey, () => setShowApiKey(!showApiKey))}
          </div>
          <span className="hint">{t(lang, "set.apiKey.hint")}</span>
        </div>
        <div className="field">
          <label>{t(lang, "set.apiSecret")}</label>
          <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
            {secretInput(showApiSecret, local.apiSecret, v => upd({ apiSecret: v }), t(lang, "set.keepBlank"))}
            {secretBtn(showApiSecret, () => setShowApiSecret(!showApiSecret))}
          </div>
        </div>
        <div className="field">
          <label>{t(lang, "set.password")}</label>
          <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
            {secretInput(showPassword, local.password, v => upd({ password: v }), t(lang, "set.keepBlank"))}
            {secretBtn(showPassword, () => setShowPassword(!showPassword))}
          </div>
          <span className="hint">{t(lang, "set.password.hint")}</span>
        </div>

        <h2 style={{ marginTop: "1.6rem" }}>{t(lang, "set.h.language")}</h2>
        <div className="field">
          <label>{t(lang, "set.appLang")}</label>
          <div className="mode-toggle">
            <button className="mode-btn" aria-pressed={lang === "en"} onClick={() => setLang("en")}>English</button>
            <button className="mode-btn" aria-pressed={lang === "zh"} onClick={() => setLang("zh")}>中文</button>
            <button className="mode-btn" aria-pressed={lang === "mix"} onClick={() => setLang("mix")}>{t(lang, "set.appLang.mix")}</button>
          </div>
          <span className="hint">{t(lang, "set.appLang.hint")}</span>
        </div>

        <h2 style={{ marginTop: "1.6rem" }}>{t(lang, "set.h.ai")}</h2>
        <div className="field">
          <label>{t(lang, "set.baseUrl")}</label>
          <input value={local.ai.baseUrl} onChange={e => updAi({ baseUrl: e.target.value })} placeholder="https://api.example.com/v1" />
          <span className="hint">{t(lang, "set.baseUrl.hint")}</span>
        </div>
        <div className="field">
          <label>{t(lang, "set.apiKey")}</label>
          <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
            {secretInput(showAiKey, local.ai.apiKey, v => updAi({ apiKey: v }), "sk-...")}
            {secretBtn(showAiKey, () => setShowAiKey(!showAiKey))}
          </div>
        </div>
        <ModelPicker lang={lang} value={local.ai.model} baseUrl={local.ai.baseUrl} apiKey={local.ai.apiKey} onLive={v => updAi({ model: v })} onCommit={v => persistModel(v)} />
        <AiTargetPicker lang={lang} value={local.ai.targetLang} onLive={v => updAi({ targetLang: v })} onCommit={persistTargetLang} />
        <div className="field">
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "0.6rem" }}>
            <label>{t(lang, "set.prompt")}</label>
            {(() => {
              const isDefault = local.ai.promptTemplate === DEFAULT_TRANSLATE_PROMPT;
              return (
                <button
                  type="button"
                  className="link-btn"
                  disabled={isDefault}
                  onClick={() => persistPromptTemplate(DEFAULT_TRANSLATE_PROMPT)}
                >{t(lang, "set.prompt.reset")}</button>
              );
            })()}
          </div>
          <textarea
            value={local.ai.promptTemplate}
            onChange={e => updAi({ promptTemplate: e.target.value })}
            onBlur={e => persistPromptTemplate(e.target.value)}
            rows={5}
            spellCheck={false}
            style={{ resize: "vertical", fontFamily: "var(--font-code)", fontSize: "0.85rem", lineHeight: 1.5 }}
          />
          <span className="hint">{t(lang, "set.prompt.hint")}</span>
        </div>
        <div className="field">
          <label>{t(lang, "set.stream")}</label>
          <div className="mode-toggle">
            <button className="mode-btn" aria-pressed={local.ai.stream} onClick={() => persistStream(true)}>{t(lang, "set.stream.on")}</button>
            <button className="mode-btn" aria-pressed={!local.ai.stream} onClick={() => persistStream(false)}>{t(lang, "set.stream.off")}</button>
          </div>
          <span className="hint">{t(lang, "set.stream.hint")}</span>
        </div>

        <AutoTranslateSettings lang={lang} ai={local.ai} persist={persistAiNow} />

        <h2 style={{ marginTop: "1.6rem" }}>{t(lang, "set.h.theme")}</h2>
        <div className="field">
          <label>{t(lang, "set.mode")}</label>
          <div className="mode-toggle">
            <button
              className="mode-btn"
              aria-pressed={theme === "light"}
              onClick={() => { if (theme === "dark") onToggleTheme(); }}
            >
              <span className="mode-ico">☀</span> {t(lang, "set.mode.light")}
            </button>
            <button
              className="mode-btn"
              aria-pressed={theme === "dark"}
              onClick={() => { if (theme === "light") onToggleTheme(); }}
            >
              <span className="mode-ico">☾</span> {t(lang, "set.mode.dark")}
            </button>
          </div>
        </div>
        <div className="field">
          <label>{t(lang, "set.palette")}</label>
          <div className="theme-picker">
            {COLOR_THEMES.map(ct => (
              <button
                key={ct.id}
                aria-pressed={colorTheme === ct.id}
                onClick={() => { setColorTheme(ct.id); applyColorTheme(ct.id); }}
                title={pickLang(lang, ct.hint, ct.hintEn)}
              >
                <span className="tp-name">{pickLang(lang, ct.name, ct.nameEn)}</span>
                <div className="tp-swatch">
                  <span style={{ background: ct.headerBg }} />
                  <span style={{ background: ct.accent }} />
                  <span style={{ background: ct.surface, border: "1px solid var(--border)" }} />
                </div>
                <span className="tp-hint">{pickLang(lang, ct.hint, ct.hintEn)}</span>
              </button>
            ))}
          </div>
        </div>

        <h2 style={{ marginTop: "1.6rem" }}>{t(lang, "set.h.trTheme")}</h2>
        <div className="tr-picker">
          {TR_THEMES.map(tr => (
            <button
              key={tr.id}
              aria-pressed={trTheme === tr.id}
              onClick={() => { setTrTheme(tr.id); applyTrTheme(tr.id); }}
              title={pickLang(lang, tr.hint, tr.hintEn)}
            >
              <span className="tr-pick-name">{pickLang(lang, tr.name, tr.nameEn)}</span>
              <span
                className="tr-pick-preview"
                style={{ borderColor: tr.line, color: tr.text, background: `color-mix(in srgb, ${tr.line} 12%, transparent)` }}
              >
                <span className="seal" style={{ background: tr.labelBg, color: tr.labelFg }}>译</span>
                <span>{t(lang, "set.trPreview")}</span>
              </span>
              <span className="tr-pick-hint">{pickLang(lang, tr.hint, tr.hintEn)}</span>
            </button>
          ))}
        </div>

        <h2 style={{ marginTop: "1.6rem" }}>{t(lang, "set.h.fonts")}</h2>
        <FontsSection lang={lang} />

        <h2 style={{ marginTop: "1.6rem" }}>{t(lang, "set.h.fontInfo")}</h2>
        <FontInfoTable lang={lang} />

        {/* Autosave only — every field commits via schedulePersist / persistNow.
            Surface the last save status (or error) without a manual Save button. */}
        {msg && (
          <div className="row">
            <span className={`save-msg ${msg.ok ? "" : "err"}`}>{msg.text}</span>
          </div>
        )}
      </div>
    </div>
  );
}
