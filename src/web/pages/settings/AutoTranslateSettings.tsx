import { useEffect, useState } from "react";
import type { AppConfig } from "../../shared";
import { t, type Lang } from "../../i18n";

// Auto-translate configuration: granularity, trigger, rate limit, concurrency,
// and the full-mode collapse default. Each control commits immediately via the
// parent's persistAi helper.
//
// "Test rate" reuses the live concurrency / interval / rpm knobs and fires a
// short burst of tiny chat pings; HTTP 429 means the current values are too
// aggressive for this provider/key (does not auto-tune — report only).

type RateShotUi = {
  index: number;
  ok: boolean;
  status: number;
  latencyMs: number;
  error?: string;
};

type RateProbeUi =
  | { state: "idle" }
  | { state: "testing" }
  | {
      state: "done";
      ok: boolean;
      rateLimited: boolean;
      total: number;
      succeeded: number;
      rateLimitedCount: number;
      failedCount: number;
      elapsedMs: number;
      concurrency: number;
      requestIntervalMs: number;
      rpm: number;
      shots: RateShotUi[];
      error?: string;
    };

function shotKind(s: RateShotUi): "ok" | "429" | "fail" {
  if (s.ok) return "ok";
  if (s.status === 429) return "429";
  return "fail";
}

function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function AutoTranslateSettings({ lang, ai, persist }: {
  lang: Lang;
  ai: AppConfig["ai"];
  persist: (patch: Partial<AppConfig["ai"]>) => void;
}) {
  const RPM_OPTIONS = [3, 5, 10, 20, 60, 0];
  const CONCURRENCY_OPTIONS = [1, 2, 3, 5, 10];
  const [probe, setProbe] = useState<RateProbeUi>({ state: "idle" });

  // Drop a previous verdict as soon as the knobs (or credentials) change, so
  // an old "429 / ok" doesn't sit under a different configuration.
  useEffect(() => {
    setProbe({ state: "idle" });
  }, [ai.concurrency, ai.requestIntervalMs, ai.rpm, ai.baseUrl, ai.apiKey, ai.model]);

  const emptyCreds = !ai.baseUrl?.trim() || !ai.apiKey?.trim() || !ai.model?.trim();
  const probing = probe.state === "testing";

  const runRateTest = async () => {
    if (probing || emptyCreds) return;
    setProbe({ state: "testing" });
    try {
      const r = await fetch("/api/ai/rate-test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          baseUrl: ai.baseUrl,
          apiKey: ai.apiKey,
          model: ai.model,
          concurrency: ai.concurrency,
          requestIntervalMs: ai.requestIntervalMs,
          rpm: ai.rpm,
        }),
      });
      const j = await r.json().catch(() => ({}));
      const shots: RateShotUi[] = Array.isArray(j?.shots)
        ? j.shots.map((s: any, i: number) => ({
            index: Number(s?.index ?? i),
            ok: !!s?.ok,
            status: Number(s?.status) || 0,
            latencyMs: Number(s?.latencyMs) || 0,
            error: s?.error ? String(s.error) : undefined,
          }))
        : [];
      const base = {
        state: "done" as const,
        ok: !!j?.ok,
        rateLimited: !!j?.rateLimited,
        total: Number(j?.total) || 0,
        succeeded: Number(j?.succeeded) || 0,
        rateLimitedCount: Number(j?.rateLimitedCount) || 0,
        failedCount: Number(j?.failedCount) || 0,
        elapsedMs: Number(j?.elapsedMs) || 0,
        concurrency: Number(j?.concurrency) || ai.concurrency,
        requestIntervalMs: Number(j?.requestIntervalMs) || ai.requestIntervalMs,
        rpm: Number(j?.rpm ?? ai.rpm) || 0,
        shots,
        error: j?.error ? String(j.error) : undefined,
      };
      if (!r.ok && base.total === 0) {
        setProbe({
          ...base,
          error: String(j?.error || `HTTP ${r.status}`),
        });
        return;
      }
      setProbe(base);
    } catch (e: any) {
      setProbe({
        state: "done",
        ok: false,
        rateLimited: false,
        total: 0,
        succeeded: 0,
        rateLimitedCount: 0,
        failedCount: 0,
        elapsedMs: 0,
        concurrency: ai.concurrency,
        requestIntervalMs: ai.requestIntervalMs,
        rpm: ai.rpm,
        shots: [],
        error: e?.message || String(e),
      });
    }
  };

  const modeBtn = (active: boolean, label: string, onClick: () => void) => (
    <button className="mode-btn" aria-pressed={active} onClick={onClick}>{label}</button>
  );

  const renderProbeCard = () => {
    if (probe.state === "idle") return null;

    if (probe.state === "testing") {
      // Placeholder shot count matches server default (concurrency * 2, 3…12).
      const n = Math.min(12, Math.max(3, ai.concurrency * 2));
      return (
        <div className="rate-card" data-tone="pending">
          <div className="rate-card-head">
            <div className="rate-card-title">
              <span className="rate-mark">…</span>
              <span className="rate-verdict">{t(lang, "set.rateTest.card.testing")}</span>
            </div>
            <span className="rate-card-sub">{t(lang, "set.rateTest.card.testingSub")}</span>
          </div>
          <div className="rate-card-body">
            <div className="rate-cfg">
              <span className="rate-chip">{t(lang, "set.rateTest.chip.conc").replace("{n}", String(ai.concurrency))}</span>
              <span className="rate-chip">{t(lang, "set.rateTest.chip.interval").replace("{n}", String(ai.requestIntervalMs))}</span>
              <span className="rate-chip">
                {t(lang, "set.rateTest.chip.rpm").replace("{n}", ai.rpm === 0 ? "∞" : String(ai.rpm))}
              </span>
            </div>
            <div className="rate-shots" aria-hidden>
              {Array.from({ length: n }, (_, i) => (
                <span key={i} className="rate-shot" data-s="pending">{i + 1}</span>
              ))}
            </div>
            <p className="rate-card-note">{t(lang, "set.rateTest.card.testingNote")}</p>
          </div>
        </div>
      );
    }

    // done
    const tone = probe.rateLimited ? "err"
      : (probe.error && probe.total === 0) ? "err"
      : probe.ok ? "ok"
      : "warn";

    const mark = tone === "ok" ? "✓" : tone === "err" && probe.rateLimited ? "!" : "✗";
    const verdict = (probe.error && probe.total === 0)
      ? t(lang, "set.rateTest.card.errTitle")
      : probe.rateLimited
        ? t(lang, "set.rateTest.card.rateLimitedTitle")
        : probe.ok
          ? t(lang, "set.rateTest.card.okTitle")
          : t(lang, "set.rateTest.card.failTitle");

    const note = (probe.error && probe.total === 0)
      ? probe.error
      : probe.rateLimited
        ? t(lang, "set.rateTest.card.rateLimitedNote")
        : probe.ok
          ? t(lang, "set.rateTest.card.okNote")
          : t(lang, "set.rateTest.card.failNote");

    return (
      <div className="rate-card" data-tone={tone}>
        <div className="rate-card-head">
          <div className="rate-card-title">
            <span className="rate-mark">{mark}</span>
            <span className="rate-verdict">{verdict}</span>
          </div>
          <span className="rate-card-sub">
            {probe.total > 0
              ? t(lang, "set.rateTest.card.elapsed").replace("{ms}", formatMs(probe.elapsedMs))
              : "—"}
          </span>
        </div>
        <div className="rate-card-body">
          {probe.total > 0 && (
            <div className="rate-stats">
              <div className="rate-stat" data-k="ok">
                <span className="rs-label">{t(lang, "set.rateTest.stat.ok")}</span>
                <span className="rs-value">{probe.succeeded}/{probe.total}</span>
              </div>
              <div className="rate-stat" data-k="429">
                <span className="rs-label">{t(lang, "set.rateTest.stat.429")}</span>
                <span className="rs-value">{probe.rateLimitedCount}</span>
              </div>
              <div className="rate-stat" data-k="fail">
                <span className="rs-label">{t(lang, "set.rateTest.stat.fail")}</span>
                <span className="rs-value">{probe.failedCount}</span>
              </div>
              <div className="rate-stat">
                <span className="rs-label">{t(lang, "set.rateTest.stat.time")}</span>
                <span className="rs-value">{formatMs(probe.elapsedMs)}</span>
              </div>
            </div>
          )}

          <div className="rate-cfg">
            <span className="rate-chip">{t(lang, "set.rateTest.chip.conc").replace("{n}", String(probe.concurrency))}</span>
            <span className="rate-chip">{t(lang, "set.rateTest.chip.interval").replace("{n}", String(probe.requestIntervalMs))}</span>
            <span className="rate-chip">
              {t(lang, "set.rateTest.chip.rpm").replace("{n}", probe.rpm === 0 ? "∞" : String(probe.rpm))}
            </span>
          </div>

          {probe.shots.length > 0 && (
            <div className="rate-shots" title={t(lang, "set.rateTest.shotsHint")}>
              {probe.shots.map((s) => (
                <span
                  key={s.index}
                  className="rate-shot"
                  data-s={shotKind(s)}
                  title={
                    s.ok
                      ? `#${s.index + 1} · ${formatMs(s.latencyMs)}`
                      : `#${s.index + 1} · ${s.status || "—"} · ${s.error || ""}`
                  }
                >
                  {s.index + 1}
                </span>
              ))}
            </div>
          )}

          <p className={`rate-card-note${tone === "err" || tone === "warn" ? " err" : ""}`}>
            {note}
            {probe.error && probe.total > 0 ? ` · ${probe.error}` : ""}
          </p>
        </div>
      </div>
    );
  };

  return (
    <>
      <h2 style={{ marginTop: "1.6rem" }}>{t(lang, "set.h.autoTr")}</h2>

      <div className="field">
        <label>{t(lang, "set.autoMode")}</label>
        <div className="mode-toggle">
          {modeBtn(ai.autoMode === "off", t(lang, "set.autoMode.off"), () => persist({ autoMode: "off" }))}
          {modeBtn(ai.autoMode === "full", t(lang, "set.autoMode.full"), () => persist({ autoMode: "full" }))}
          {modeBtn(ai.autoMode === "section", t(lang, "set.autoMode.section"), () => persist({ autoMode: "section" }))}
          {modeBtn(ai.autoMode === "paragraph", t(lang, "set.autoMode.paragraph"), () => persist({ autoMode: "paragraph" }))}
        </div>
        <span className="hint">{t(lang, "set.autoMode.hint")}</span>
      </div>

      <div className="field">
        <label>{t(lang, "set.autoTrigger")}</label>
        <div className="mode-toggle">
          {modeBtn(ai.autoTrigger === "manual", t(lang, "set.autoTrigger.manual"), () => persist({ autoTrigger: "manual" }))}
          {modeBtn(ai.autoTrigger === "onopen", t(lang, "set.autoTrigger.onopen"), () => persist({ autoTrigger: "onopen" }))}
        </div>
        <span className="hint">{t(lang, "set.autoTrigger.hint")}</span>
      </div>

      <div className="field">
        <label>{t(lang, "set.rpm")}</label>
        <div className="font-row">
          <select
            className="font-select"
            value={String(ai.rpm)}
            onChange={e => persist({ rpm: Number(e.target.value) })}
          >
            {RPM_OPTIONS.map(n => (
              <option key={n} value={String(n)}>{n === 0 ? "∞" : String(n)}</option>
            ))}
          </select>
        </div>
        <span className="hint">{t(lang, "set.rpm.hint")}</span>
      </div>

      <div className="field">
        <label>{t(lang, "set.concurrency")}</label>
        <div className="font-row">
          <select
            className="font-select"
            value={String(ai.concurrency)}
            onChange={e => persist({ concurrency: Number(e.target.value) })}
          >
            {CONCURRENCY_OPTIONS.map(n => (
              <option key={n} value={String(n)}>{String(n)}</option>
            ))}
          </select>
        </div>
        <span className="hint">{t(lang, "set.concurrency.hint")}</span>
      </div>

      <div className="field">
        <label>{t(lang, "set.requestInterval")}</label>
        <div className="font-row">
          <select
            className="font-select"
            value={String(ai.requestIntervalMs)}
            onChange={e => persist({ requestIntervalMs: Number(e.target.value) })}
          >
            {[100, 200, 300, 500, 1000, 2000].map(n => (
              <option key={n} value={String(n)}>{n} ms</option>
            ))}
          </select>
        </div>
        <span className="hint">{t(lang, "set.requestInterval.hint")}</span>
      </div>

      <div className="field">
        <label>{t(lang, "set.rateTest")}</label>
        <button
          type="button"
          className={`rate-test-run${probing ? " is-running" : ""}`}
          onClick={() => void runRateTest()}
          disabled={probing || emptyCreds}
        >
          {probing ? t(lang, "set.rateTest.testing") : t(lang, "set.rateTest.run")}
        </button>
        <span className="hint">
          {emptyCreds ? t(lang, "set.test.emptyCreds") : t(lang, "set.rateTest.hint")}
        </span>
        {renderProbeCard()}
      </div>

      <div className="field">
        <label>{t(lang, "set.autoCollapse")}</label>
        <div className="mode-toggle">
          {modeBtn(!ai.autoCollapse, t(lang, "set.autoCollapse.off"), () => persist({ autoCollapse: false }))}
          {modeBtn(!!ai.autoCollapse, t(lang, "set.autoCollapse.on"), () => persist({ autoCollapse: true }))}
        </div>
        <span className="hint">{t(lang, "set.autoCollapse.hint")}</span>
      </div>
    </>
  );
}
