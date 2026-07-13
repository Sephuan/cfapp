import { useState } from "react";
import { t, AI_TARGET_PRESETS, type Lang } from "../../i18n";

// AI-translation target language: a preset dropdown plus a "Custom…" entry that
// reveals a free-text field. The stored value is the plain language name that
// gets interpolated into the translate system prompt (api/translate-prompt.ts).
// A value not in the preset list is treated as custom (so a config saved with a
// hand-typed language still shows its text on reload).
//
// This control persists on its own (no Save needed): picking a preset commits
// immediately; the custom field updates the form live (onLive) and commits on
// blur (onCommit), so a half-typed language doesn't fire a PUT per keystroke.
export function AiTargetPicker({ lang, value, onLive, onCommit }: { lang: Lang; value: string; onLive: (v: string) => void; onCommit: (v: string) => void }) {
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
