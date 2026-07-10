import { useEffect, useState } from "react";
import type { AppConfig } from "../shared";
import {
  COLOR_THEMES, TR_THEMES, FONT_ROLES,
  applyColorTheme, applyTrTheme, applyFont,
  readColorTheme, readTrTheme, readFont, pickLang,
  type ColorTheme, type TrTheme, type FontRole,
} from "../themes";
import { useLang, t, setLang, AI_TARGET_PRESETS, type Lang, type StrKey } from "../i18n";
import { DEFAULT_TRANSLATE_PROMPT } from "../../api/translate-prompt";

// Fill in fields an older server (or a config.json predating a feature) may omit,
// so the form never renders a blank control for something that has a default.
// Chiefly: ai.promptTemplate — a server running pre-promptTemplate code returns
// it as undefined, which would show an empty textarea and a spurious "reset" link.
function normalizeConfig(c: AppConfig): AppConfig {
  return { ...c, ai: { ...c.ai, promptTemplate: c.ai?.promptTemplate || DEFAULT_TRANSLATE_PROMPT, stream: c.ai?.stream ?? true } };
}

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

  // Fetch config on mount
  useEffect(() => {
    fetch("/api/config")
      .then(r => r.json())
      .then((c: AppConfig) => setCfg(normalizeConfig(c)))
      .catch(() => {});
  }, []);

  const onSave = async () => {
    if (!local) return;
    setMsg(null);
    try {
      const r = await fetch("/api/config", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify(local),
      });
      const j = await r.json();
      setLocal(normalizeConfig(j));
      setMsg({ ok: true, text: t(lang, "set.saved") });
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    }
  };

  if (!local) return <div className="container"><div className="loading">{t(lang, "set.loading")}</div></div>;
  const upd = (patch: Partial<AppConfig>) => setLocal({ ...local, ...patch });
  const updAi = (patch: Partial<AppConfig["ai"]>) => setLocal({ ...local, ai: { ...local.ai, ...patch } });

  // The translation target language auto-persists the moment it changes (like
  // the app-language toggle), so it doesn't silently revert if the user leaves
  // Settings without hitting Save. Sends only the targetLang delta; the server
  // merges it (undefined fields keep their stored value) so we never clobber
  // secrets the form doesn't hold in cleartext.
  const persistTargetLang = async (targetLang: string) => {
    updAi({ targetLang });
    try {
      const r = await fetch("/api/config", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ai: { targetLang } }),
      });
      const j = await r.json();
      setLocal(prev => (prev ? { ...prev, ai: { ...prev.ai, targetLang: j.ai.targetLang } } : prev));
      setMsg({ ok: true, text: t(lang, "set.saved") });
    } catch { /* keep the optimistic local value */ }
  };

  // Same auto-persist contract as the target language: the prompt textarea
  // commits on blur (and on reset) so leaving Settings without hitting Save
  // doesn't silently discard the edit. Sends only the promptTemplate delta so
  // the server merge keeps every other (secret) field untouched.
  const persistPromptTemplate = async (promptTemplate: string) => {
    updAi({ promptTemplate });
    try {
      const r = await fetch("/api/config", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ai: { promptTemplate } }),
      });
      const j = await r.json();
      setLocal(prev => (prev ? { ...prev, ai: { ...prev.ai, promptTemplate: j.ai?.promptTemplate || promptTemplate } } : prev));
      setMsg({ ok: true, text: t(lang, "set.saved") });
    } catch { /* keep the optimistic local value */ }
  };

  // Streaming toggle also auto-persists (a boolean, so send it through as-is).
  const persistStream = async (stream: boolean) => {
    updAi({ stream });
    try {
      const r = await fetch("/api/config", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ai: { stream } }),
      });
      const j = await r.json();
      setLocal(prev => (prev ? { ...prev, ai: { ...prev.ai, stream: j.ai?.stream ?? stream } } : prev));
      setMsg({ ok: true, text: t(lang, "set.saved") });
    } catch { /* keep the optimistic local value */ }
  };

  const secretBtn = (shown: boolean, toggle: () => void) => (
    <button
      type="button"
      onClick={toggle}
      title={shown ? t(lang, "set.hide") : t(lang, "set.show")}
      style={{ background: "none", border: "1px solid var(--border)", borderRadius: 5, cursor: "pointer", padding: "0.3rem 0.5rem", fontSize: "0.9rem", lineHeight: 1, color: "var(--text)" }}
    >{shown ? "🙈" : "👁"}</button>
  );
  const secretInput = (shown: boolean, value: string, onChange: (v: string) => void, placeholder: string) => (
    <input
      type={shown ? "text" : "password"}
      value={shown ? value : (value ? "***" : "")}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
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
        <div className="field">
          <label>{t(lang, "set.model")}</label>
          <input value={local.ai.model} onChange={e => updAi({ model: e.target.value })} placeholder="" />
        </div>
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
        {FONT_ROLES.map(role => <FontRolePicker key={role.key} role={role} lang={lang} />)}

        <h2 style={{ marginTop: "1.6rem" }}>{t(lang, "set.h.fontInfo")}</h2>
        <FontInfoTable lang={lang} />

        <div className="row">
          <button className="primary" onClick={onSave}>{t(lang, "set.save")}</button>
          {msg && <span className={`save-msg ${msg.ok ? "" : "err"}`}>{msg.text}</span>}
        </div>
      </div>
    </div>
  );
}

// Read-only diagnostic rows for the roles the user can't switch (the switchable
// ones — body/statement/display — get live pickers above). Shows which primary
// family each role resolved to and whether it actually loaded.
const DIAG_ROLES = [
  { labelKey: "diag.tr" as StrKey, cssVar: "--font-cjk", sample: "给你一个数组 a…", sampleStyle: {} },
  { labelKey: "diag.trLabel" as StrKey, cssVar: "--font-cjk-label", sample: "译", sampleStyle: { fontWeight: 700, fontSize: "0.8rem" } },
  { labelKey: "diag.code" as StrKey, cssVar: "--font-code", sample: "int main() {}", sampleStyle: {} },
] as const;

// Per-family load state. `document.fonts.load()` resolves with the matched
// FontFace list once the @font-face has downloaded (or immediately, empty, if
// no rule matches the family → it will render as a system fallback). That lets
// us honestly distinguish "loaded" from "silently fell back", which the old
// picker couldn't show.
type LoadState = "loading" | "loaded" | "fallback";
function useFontLoadStatus(families: string[]): Record<string, LoadState> {
  const key = families.join("|");
  const [status, setStatus] = useState<Record<string, LoadState>>({});
  useEffect(() => {
    let cancelled = false;
    setStatus(Object.fromEntries(families.map(f => [f, "loading" as LoadState])));
    for (const fam of families) {
      document.fonts.load(`16px "${fam}"`)
        .then(faces => {
          if (cancelled) return;
          setStatus(s => ({ ...s, [fam]: faces.length > 0 ? "loaded" : "fallback" }));
        })
        .catch(() => { if (!cancelled) setStatus(s => ({ ...s, [fam]: "fallback" })); });
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return status;
}

const LOAD_LABEL: Record<LoadState, StrKey> = { loading: "font.loading", loaded: "font.loaded", fallback: "font.fallback" };

// One compact picker per font role: a native dropdown to choose the face plus a
// single live-preview bar rendering the *selected* choice, so the section stays
// short no matter how many fonts a role offers. Owns its own selection state
// (seeded from localStorage) so adding a role is zero-wiring: SettingsPage just
// maps over FONT_ROLES. Applying a pick flips the data attribute — no re-render.
function FontRolePicker({ role, lang }: { role: FontRole; lang: Lang }) {
  const [value, setValue] = useState<string>(() => readFont(role));
  const load = useFontLoadStatus(role.choices.map(c => c.family));
  const current = role.choices.find(c => c.id === value) ?? role.choices[0]!;
  // System fonts (Georgia) aren't shipped by fonts.ts, so a load probe is
  // meaningless — always show them as "系统" available.
  const st: LoadState | "system" = current.system ? "system" : (load[current.family] ?? "loading");
  return (
    <div className="field">
      <label>{pickLang(lang, role.label, role.labelEn)}</label>
      <div className="font-row">
        <select
          className="font-select"
          value={value}
          onChange={e => { setValue(e.target.value); applyFont(role, e.target.value); }}
        >
          {role.choices.map(c => (
            <option key={c.id || "default"} value={c.id}>
              {c.name}{c.id === "" ? t(lang, "set.default") : ""}
            </option>
          ))}
        </select>
        <span className={`fp-status fp-${st}`}>{st === "system" ? t(lang, "set.system") : t(lang, LOAD_LABEL[st])}</span>
      </div>
      {/* Latin falls to Georgia (matching the real stacks) then CJK to LXGW, so
          the preview is honest whether or not the face loaded. Sample text
          mirrors what this role actually renders (role.preview). */}
      <div className="font-preview" style={{ fontFamily: `"${current.family}", Georgia, var(--font-cjk)` }}>
        {role.preview}
      </div>
      <span className="fp-hint">{pickLang(lang, current.hint, current.hintEn)}</span>
    </div>
  );
}

function FontInfoTable({ lang }: { lang: Lang }) {
  const [info, setInfo] = useState<{ primary: string; loaded: boolean }[]>([]);

  useEffect(() => {
    const check = () => {
      const root = getComputedStyle(document.documentElement);
      setInfo(DIAG_ROLES.map(r => {
        const stack = root.getPropertyValue(r.cssVar).trim();
        const primary = stack.split(",")[0]?.trim().replace(/^"|"$/g, "") || "serif";
        const loaded = document.fonts.check(`16px "${primary}"`);
        return { primary, loaded };
      }));
    };
    document.fonts.ready.then(check);
    document.fonts.addEventListener("loadingdone", check);
    return () => document.fonts.removeEventListener("loadingdone", check);
  }, []);

  if (!info.length) return null;

  return (
    <table className="font-info">
      <tbody>
        {DIAG_ROLES.map((r, i) => (
          <tr key={r.cssVar}>
            <th>{t(lang, r.labelKey)}</th>
            <td>
              <span className={info[i]?.loaded ? "fi-loaded" : "fi-fallback"}>
                {info[i]?.primary} {info[i]?.loaded ? "✓" : t(lang, "font.notLoaded")}
              </span>
              <br />
              <span className="fi-sample" style={{ fontFamily: `var(${r.cssVar})`, ...r.sampleStyle }}>{r.sample}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// AI-translation target language: a preset dropdown plus a "Custom…" entry that
// reveals a free-text field. The stored value is the plain language name that
// gets interpolated into the translate system prompt (api/translate-prompt.ts).
// A value not in the preset list is treated as custom (so a config saved with a
// hand-typed language still shows its text on reload).
//
// This control persists on its own (no Save needed): picking a preset commits
// immediately; the custom field updates the form live (onLive) and commits on
// blur (onCommit), so a half-typed language doesn't fire a PUT per keystroke.
function AiTargetPicker({ lang, value, onLive, onCommit }: { lang: Lang; value: string; onLive: (v: string) => void; onCommit: (v: string) => void }) {
  const isPreset = AI_TARGET_PRESETS.includes(value);
  const [custom, setCustom] = useState(!isPreset && value !== "");
  return (
    <div className="field">
      <label>{t(lang, "set.aiTarget")}</label>
      <div className="font-row">
        <select
          className="font-select"
          value={custom ? "__custom__" : value}
          onChange={e => {
            if (e.target.value === "__custom__") { setCustom(true); }
            else { setCustom(false); onCommit(e.target.value); }
          }}
        >
          {AI_TARGET_PRESETS.map(p => <option key={p} value={p}>{p}</option>)}
          <option value="__custom__">{t(lang, "set.aiTarget.custom")}</option>
        </select>
      </div>
      {custom && (
        <input
          style={{ marginTop: "0.4rem" }}
          value={isPreset ? "" : value}
          onChange={e => onLive(e.target.value)}
          onBlur={e => { const v = e.target.value.trim(); if (v) onCommit(v); }}
          placeholder={t(lang, "set.aiTarget.customPh")}
        />
      )}
      <span className="hint">{t(lang, "set.aiTarget.hint")}</span>
    </div>
  );
}
