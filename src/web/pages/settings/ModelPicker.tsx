import { useEffect, useRef, useState } from "react";
import { t, type Lang } from "../../i18n";

// AI model picker + connection test, collapsed into one field because selecting
// a model and then verifying it works is a single workflow. See SettingsPage
// history for the full design notes.
export function ModelPicker({ lang, value, baseUrl, apiKey, onLive, onCommit }: {
  lang: Lang;
  value: string;
  baseUrl: string;
  apiKey: string;
  onLive: (v: string) => void;
  onCommit: (v: string) => void;
}) {
  const [models, setModels] = useState<string[]>([]);
  const [fetching, setFetching] = useState(false);
  const [fetchErr, setFetchErr] = useState<string | null>(null);
  // Remember which (baseUrl, apiKey) pair we last pulled with, so re-opening
  // the dropdown only re-fetches when the creds actually changed (no flicker
  // on every open with the same valid key).
  const lastCreds = useRef<string>("");
  const credsKey = `${baseUrl.trim()}||${apiKey.trim()}`;
  // Custom mode is sticky once entered (mirrors AiTargetPicker). A value that
  // isn't among the pulled models is also shown as custom so a config saved with
  // a hand-typed id still displays its text on reload.
  const inList = models.includes(value);
  const [custom, setCustom] = useState(!inList && value !== "");

  // Connection test state — one probe result each for stream / non-stream.
  type Res = { state: "idle" | "testing" | "ok" | "err"; latencyMs?: number; preview?: string; error?: string };
  const [streamRes, setStreamRes] = useState<Res>({ state: "idle" });
  const [nonStreamRes, setNonStreamRes] = useState<Res>({ state: "idle" });
  const testing = streamRes.state === "testing" || nonStreamRes.state === "testing";
  const emptyCreds = !baseUrl.trim() || !apiKey.trim() || !value.trim();

  // Invalidate stale diagnostics the instant the underlying creds/model change,
  // so a wrong-base-URL error or a leftover test result doesn't linger after
  // the user corrects the field. Without this, a 404 from a bad base URL stays
  // on screen until the next successful pull — confusing, since the field is
  // now correct. credsKey covers baseUrl+apiKey; value covers the model.
  //
  // We also drop the cached model list + reset lastCreds: otherwise a stale
  // list from the PREVIOUS (good) base URL would flash in the dropdown for a
  // frame or two before the new (failing) pull replaces it. lastCreds must be
  // cleared too, or maybePull would think it already pulled and skip.
  useEffect(() => {
    setFetchErr(null);
    setModels([]);
    lastCreds.current = "";
    setStreamRes({ state: "idle" });
    setNonStreamRes({ state: "idle" });
  }, [credsKey, value]);

  // Auto-pull on dropdown open: skip while a pull is in flight, skip if the
  // creds are unchanged since the last successful pull, and skip an empty key
  // (the server route returns an {error} → 502 for empty creds). The select's
  // own loading option makes the in-flight state visible.
  const maybePull = () => {
    if (fetching) return;
    if (credsKey === lastCreds.current) return;
    if (!baseUrl.trim() || !apiKey.trim()) return;
    void pull();
  };

  const pull = async () => {
    if (fetching) return;
    setFetching(true);
    setFetchErr(null);
    try {
      const r = await fetch("/api/ai/models", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ baseUrl, apiKey }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      const list: string[] = Array.isArray(j?.models) ? j.models : [];
      setModels(list);
      // Stamp the creds we pulled with so re-opening the dropdown with the
      // same creds is a no-op (no refetch / flicker).
      lastCreds.current = credsKey;
      // If the current value is now a known model, drop out of custom mode so
      // the dropdown reflects it. Otherwise stay custom (keep the user's id).
      if (list.includes(value)) setCustom(false);
    } catch (e: any) {
      setFetchErr(e?.message || String(e));
      // Fall back to custom entry so the user can still type a model id.
      setCustom(true);
    } finally {
      setFetching(false);
    }
  };

  const runTest = async (stream: boolean, set: (r: Res) => void) => {
    set({ state: "testing" });
    try {
      const r = await fetch("/api/ai/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ baseUrl, apiKey, model: value, stream }),
      });
      const j = await r.json();
      if (!r.ok || j?.ok === false) {
        set({ state: "err", error: String(j?.error || `HTTP ${r.status}`) });
        return;
      }
      set({ state: "ok", latencyMs: j.latencyMs, preview: j.preview });
    } catch (e: any) {
      set({ state: "err", error: e?.message || String(e) });
    }
  };
  const onTest = () => {
    if (testing || emptyCreds) return;
    void runTest(true, setStreamRes);
    void runTest(false, setNonStreamRes);
  };

  const renderRow = (label: string, r: Res) => (
    <div className="test-row">
      <span className="test-label">{label}</span>
      {r.state === "idle" && <span className="test-idle">—</span>}
      {r.state === "testing" && <span className="test-pending">{t(lang, "set.testing")}</span>}
      {r.state === "ok" && (
        <span className="test-ok">✓ {r.latencyMs}ms · {r.preview}</span>
      )}
      {r.state === "err" && (
        <span className="test-err">✗ {r.error}</span>
      )}
    </div>
  );

  return (
    <div className="field">
      <label>{t(lang, "set.model")}</label>
      <div className="font-row">
        <select
          className="font-select"
          // Native <select> fires mousedown before its popup opens, which is the
          // earliest reliable hook to kick off a model pull so the list is ready
          // (or visibly "loading…") by the time the popup is shown. onFocus
          // covers keyboard activation.
          onMouseDown={maybePull}
          onFocus={maybePull}
          value={custom || !inList ? "__custom__" : value}
          onChange={e => {
            if (e.target.value === "__custom__") { setCustom(true); }
            else { setCustom(false); onCommit(e.target.value); }
          }}
        >
          {/* If the current model isn't in the pulled list, show it as the
              selected custom entry so the select isn't blank on first load. */}
          {value && !inList && !custom && (
            <option value={value}>{value}</option>
          )}
          {fetching && <option value="" disabled>{t(lang, "set.model.fetching")}</option>}
          {models.map(m => <option key={m} value={m}>{m}</option>)}
          <option value="__custom__">{t(lang, "set.model.custom")}</option>
        </select>
        <button
          type="button"
          className="ai-btn"
          onClick={onTest}
          disabled={testing || emptyCreds}
        >{testing ? t(lang, "set.testing") : t(lang, "set.test")}</button>
      </div>
      {(custom || !inList) && (
        <input
          style={{ marginTop: "0.4rem" }}
          value={value}
          onChange={e => onLive(e.target.value)}
          onBlur={e => { const v = e.target.value.trim(); if (v) onCommit(v); }}
          placeholder={fetchErr ? t(lang, "set.model.fetchErr") : t(lang, "set.model.customPh")}
        />
      )}
      <span className="hint">{fetchErr ? fetchErr : emptyCreds ? t(lang, "set.test.emptyCreds") : t(lang, "set.model.hint")}</span>
      {(streamRes.state !== "idle" || nonStreamRes.state !== "idle") && (
        <div className="test-results">
          {renderRow(t(lang, "set.test.stream"), streamRes)}
          {renderRow(t(lang, "set.test.nonstream"), nonStreamRes)}
        </div>
      )}
    </div>
  );
}
