import { useEffect, useState } from "react";
import type { AppConfig } from "../shared";
import {
  COLOR_THEMES, TR_THEMES, FONT_ROLES,
  applyColorTheme, applyTrTheme, applyFont,
  readColorTheme, readTrTheme, readFont,
  type ColorTheme, type TrTheme, type FontRole,
} from "../themes";

export function SettingsPage({ theme, onToggleTheme }: { theme: "light" | "dark"; onToggleTheme: () => void }) {
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
      .then(setCfg)
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
      setLocal(j);
      setMsg({ ok: true, text: "Saved." });
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    }
  };

  if (!local) return <div className="container"><div className="loading">Loading…</div></div>;
  const upd = (patch: Partial<AppConfig>) => setLocal({ ...local, ...patch });
  const updAi = (patch: Partial<AppConfig["ai"]>) => setLocal({ ...local, ai: { ...local.ai, ...patch } });

  const secretBtn = (shown: boolean, toggle: () => void) => (
    <button
      type="button"
      onClick={toggle}
      title={shown ? "隐藏" : "显示"}
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
        <h2>Codeforces 账号</h2>
        <div className="field">
          <label>Handle</label>
          <input value={local.handle} onChange={e => upd({ handle: e.target.value })} placeholder="your_handle" />
          <span className="hint">用户名，做提交和查个人榜需要</span>
        </div>
        <div className="field">
          <label>API Key</label>
          <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
            {secretInput(showApiKey, local.apiKey, v => upd({ apiKey: v }), "留空表示保持不变")}
            {secretBtn(showApiKey, () => setShowApiKey(!showApiKey))}
          </div>
          <span className="hint">CF 个人设置里的 API Key（仅用于查询签名 API）</span>
        </div>
        <div className="field">
          <label>API Secret</label>
          <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
            {secretInput(showApiSecret, local.apiSecret, v => upd({ apiSecret: v }), "留空表示保持不变")}
            {secretBtn(showApiSecret, () => setShowApiSecret(!showApiSecret))}
          </div>
        </div>
        <div className="field">
          <label>Password（用于网页登录提交代码）</label>
          <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
            {secretInput(showPassword, local.password, v => upd({ password: v }), "留空表示保持不变")}
            {secretBtn(showPassword, () => setShowPassword(!showPassword))}
          </div>
          <span className="hint">仅本机存储于 ~/.config/cfapp/config.json，明文。不想存就只用 API Key（但提交代码需要密码登录）</span>
        </div>

        <h2 style={{ marginTop: "1.6rem" }}>AI 翻译（OpenAI 兼容）</h2>
        <div className="field">
          <label>Base URL</label>
          <input value={local.ai.baseUrl} onChange={e => updAi({ baseUrl: e.target.value })} placeholder="https://api.example.com/v1" />
          <span className="hint">不要带 /chat/completions，只填到 /v1</span>
        </div>
        <div className="field">
          <label>API Key</label>
          <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
            {secretInput(showAiKey, local.ai.apiKey, v => updAi({ apiKey: v }), "sk-...")}
            {secretBtn(showAiKey, () => setShowAiKey(!showAiKey))}
          </div>
        </div>
        <div className="field">
          <label>Model</label>
          <input value={local.ai.model} onChange={e => updAi({ model: e.target.value })} placeholder="" />
        </div>

        <h2 style={{ marginTop: "1.6rem" }}>界面主题</h2>
        <div className="field">
          <label>明暗模式</label>
          <div className="mode-toggle">
            <button
              className="mode-btn"
              aria-pressed={theme === "light"}
              onClick={() => { if (theme === "dark") onToggleTheme(); }}
            >
              <span className="mode-ico">☀</span> 浅色
            </button>
            <button
              className="mode-btn"
              aria-pressed={theme === "dark"}
              onClick={() => { if (theme === "light") onToggleTheme(); }}
            >
              <span className="mode-ico">☾</span> 深色
            </button>
          </div>
        </div>
        <div className="field">
          <label>配色方案</label>
          <div className="theme-picker">
            {COLOR_THEMES.map(t => (
              <button
                key={t.id}
                aria-pressed={colorTheme === t.id}
                onClick={() => { setColorTheme(t.id); applyColorTheme(t.id); }}
                title={t.hint}
              >
                <span className="tp-name">{t.name}</span>
                <div className="tp-swatch">
                  <span style={{ background: t.headerBg }} />
                  <span style={{ background: t.accent }} />
                  <span style={{ background: t.surface, border: "1px solid var(--border)" }} />
                </div>
                <span className="tp-hint">{t.hint}</span>
              </button>
            ))}
          </div>
        </div>

        <h2 style={{ marginTop: "1.6rem" }}>译注样式</h2>
        <div className="tr-picker">
          {TR_THEMES.map(t => (
            <button
              key={t.id}
              aria-pressed={trTheme === t.id}
              onClick={() => { setTrTheme(t.id); applyTrTheme(t.id); }}
              title={t.hint}
            >
              <span className="tr-pick-name">{t.name}</span>
              <span
                className="tr-pick-preview"
                style={{ borderColor: t.line, color: t.text, background: `color-mix(in srgb, ${t.line} 12%, transparent)` }}
              >
                <span className="seal" style={{ background: t.labelBg, color: t.labelFg }}>译</span>
                <span>题面译注预览</span>
              </span>
              <span className="tr-pick-hint">{t.hint}</span>
            </button>
          ))}
        </div>

        <h2 style={{ marginTop: "1.6rem" }}>字体</h2>
        {FONT_ROLES.map(role => <FontRolePicker key={role.key} role={role} />)}

        <h2 style={{ marginTop: "1.6rem" }}>字体信息</h2>
        <FontInfoTable />

        <div className="row">
          <button className="primary" onClick={onSave}>Save</button>
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
  { label: "译注", cssVar: "--font-cjk", sample: "给你一个数组 a…", sampleStyle: {} },
  { label: "译注标签", cssVar: "--font-cjk-label", sample: "译", sampleStyle: { fontWeight: 700, fontSize: "0.8rem" } },
  { label: "代码", cssVar: "--font-code", sample: "int main() {}", sampleStyle: {} },
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

const LOAD_LABEL: Record<LoadState, string> = { loading: "加载中", loaded: "已加载", fallback: "回退" };

// One compact picker per font role: a native dropdown to choose the face plus a
// single live-preview bar rendering the *selected* choice, so the section stays
// short no matter how many fonts a role offers. Owns its own selection state
// (seeded from localStorage) so adding a role is zero-wiring: SettingsPage just
// maps over FONT_ROLES. Applying a pick flips the data attribute — no re-render.
function FontRolePicker({ role }: { role: FontRole }) {
  const [value, setValue] = useState<string>(() => readFont(role));
  const load = useFontLoadStatus(role.choices.map(c => c.family));
  const current = role.choices.find(c => c.id === value) ?? role.choices[0]!;
  // System fonts (Georgia) aren't shipped by fonts.ts, so a load probe is
  // meaningless — always show them as "系统" available.
  const st: LoadState | "system" = current.system ? "system" : (load[current.family] ?? "loading");
  return (
    <div className="field">
      <label>{role.label}</label>
      <div className="font-row">
        <select
          className="font-select"
          value={value}
          onChange={e => { setValue(e.target.value); applyFont(role, e.target.value); }}
        >
          {role.choices.map(c => (
            <option key={c.id || "default"} value={c.id}>
              {c.name}{c.id === "" ? "（默认）" : ""}
            </option>
          ))}
        </select>
        <span className={`fp-status fp-${st}`}>{st === "system" ? "系统" : LOAD_LABEL[st]}</span>
      </div>
      {/* Latin falls to Georgia (matching the real stacks) then CJK to LXGW, so
          the preview is honest whether or not the face loaded. Sample text
          mirrors what this role actually renders (role.preview). */}
      <div className="font-preview" style={{ fontFamily: `"${current.family}", Georgia, var(--font-cjk)` }}>
        {role.preview}
      </div>
      <span className="fp-hint">{current.hint}</span>
    </div>
  );
}

function FontInfoTable() {
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
            <th>{r.label}</th>
            <td>
              <span className={info[i]?.loaded ? "fi-loaded" : "fi-fallback"}>
                {info[i]?.primary} {info[i]?.loaded ? "✓" : "(未加载)"}
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
