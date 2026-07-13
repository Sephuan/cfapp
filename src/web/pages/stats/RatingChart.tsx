import React, { useMemo, useState, useRef, useEffect } from "react";
import type { RatingChange } from "../../../api";
import { tierColor, formatDate } from "./utils";

const TIER_STOPS = [0, 1200, 1400, 1600, 1900, 2100, 2300, 2400, 2600, 3000, 4500];
const YEAR = 365 * 86400;
const ZOOM_PRESETS: { label: string; span: number | null }[] = [
  { label: "全部", span: null },
  { label: "5年", span: 5 * YEAR },
  { label: "2年", span: 2 * YEAR },
  { label: "1年", span: 1 * YEAR },
  { label: "6月", span: Math.round(0.5 * YEAR) },
];

export function RatingChart({ ratingHistory }: { ratingHistory: RatingChange[] }) {
  const sorted = useMemo(
    () => [...ratingHistory].sort((a, b) => a.ratingUpdateTimeSeconds - b.ratingUpdateTimeSeconds),
    [ratingHistory],
  );

  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  // Visible time window [t0, t1] in seconds; null = full range.
  const [win, setWin] = useState<[number, number] | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  // Drag-to-zoom selection, in pixel X within the svg.
  const [drag, setDrag] = useState<{ x0: number; x1: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Measure the container so the chart fills its panel and reflows on resize.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (sorted.length === 0) {
    return <div className="stats-empty">No rated contests yet — participate in one to start your rating graph.</div>;
  }

  const H = 340;
  const padL = 52, padR = 16, padT = 16, padB = 40;
  const W = Math.max(width, 320);
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  const tMinData = sorted[0]!.ratingUpdateTimeSeconds;
  const tMaxData = sorted[sorted.length - 1]!.ratingUpdateTimeSeconds;
  const [t0, t1] = win ?? [tMinData, tMaxData];

  const vis = sorted.filter(c => c.ratingUpdateTimeSeconds >= t0 && c.ratingUpdateTimeSeconds <= t1);
  const forY = vis.length > 0 ? vis : sorted;

  // Y range: fit visible points, pad, and enforce a minimum span so a quiet
  // period doesn't get magnified into noise.
  let rLo = Math.min(...forY.map(c => c.newRating));
  let rHi = Math.max(...forY.map(c => c.newRating));
  let yMin = Math.floor((rLo - 60) / 100) * 100;
  let yMax = Math.ceil((rHi + 60) / 100) * 100;
  yMin = Math.max(0, yMin);
  if (yMax - yMin < 400) { const mid = (yMax + yMin) / 2; yMin = Math.max(0, Math.round(mid - 200)); yMax = yMin + 400; }

  const tSpan = Math.max(t1 - t0, 1);
  const rSpan = Math.max(yMax - yMin, 1);
  const sx = (t: number) => padL + ((t - t0) / tSpan) * chartW;
  const sy = (r: number) => padT + chartH - ((r - yMin) / rSpan) * chartH;
  const baselineY = padT + chartH;

  // Tier bands.
  const bands: { y: number; h: number; color: string }[] = [];
  for (let i = 0; i < TIER_STOPS.length - 1; i++) {
    const lo = Math.max(TIER_STOPS[i]!, yMin);
    const hi = Math.min(TIER_STOPS[i + 1]!, yMax);
    if (hi <= lo) continue;
    bands.push({ y: sy(hi), h: sy(lo) - sy(hi), color: tierColor((TIER_STOPS[i]! + TIER_STOPS[i + 1]!) / 2 - 1) });
  }
  const yTicks = TIER_STOPS.filter(r => r > yMin && r < yMax);

  // X ticks: 6 evenly spaced timestamps; format by span (years vs months).
  const spanDays = tSpan / 86400;
  const fmtTick = (t: number) => {
    const d = new Date(t * 1000);
    return spanDays > 1100
      ? String(d.getFullYear())
      : d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
  };
  const xTicks: { x: number; label: string }[] = [];
  let lastLabel = "";
  for (let i = 0; i < 6; i++) {
    const t = t0 + (i / 5) * tSpan;
    const label = fmtTick(t);
    if (label === lastLabel) continue;
    lastLabel = label;
    xTicks.push({ x: sx(t), label });
  }

  const polyline = vis.map(c => `${sx(c.ratingUpdateTimeSeconds)},${sy(c.newRating)}`).join(" ");
  const areaPath = vis.length > 0
    ? `M ${sx(vis[0]!.ratingUpdateTimeSeconds)},${baselineY} `
      + vis.map(c => `L ${sx(c.ratingUpdateTimeSeconds)},${sy(c.newRating)}`).join(" ")
      + ` L ${sx(vis[vis.length - 1]!.ratingUpdateTimeSeconds)},${baselineY} Z`
    : "";

  // Summary stats over the FULL history (not the zoom window).
  const current = sorted[sorted.length - 1]!.newRating;
  const peak = Math.max(...sorted.map(c => c.newRating));
  const low = Math.min(...sorted.map(c => c.newRating));
  const delta = current - sorted[0]!.oldRating;

  // ---- pointer helpers ----
  const pxToTime = (px: number) => t0 + ((px - padL) / chartW) * tSpan;
  const localX = (clientX: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    return clientX - (rect?.left ?? 0);
  };
  const nearestVis = (px: number): number | null => {
    if (vis.length === 0) return null;
    let best = 0, bestD = Infinity;
    for (let i = 0; i < vis.length; i++) {
      const d = Math.abs(sx(vis[i]!.ratingUpdateTimeSeconds) - px);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  };

  const onMove = (e: React.MouseEvent) => {
    const px = localX(e.clientX);
    if (drag) { setDrag({ ...drag, x1: px }); return; }
    setHover(nearestVis(px));
  };
  const onDown = (e: React.MouseEvent) => {
    const px = localX(e.clientX);
    if (px < padL || px > padL + chartW) return;
    setDrag({ x0: px, x1: px });
    setHover(null);
  };
  const onUp = () => {
    if (drag) {
      const dist = Math.abs(drag.x1 - drag.x0);
      if (dist > 6) {
        const ta = pxToTime(Math.min(drag.x0, drag.x1));
        const tb = pxToTime(Math.max(drag.x0, drag.x1));
        setWin([Math.max(tMinData, ta), Math.min(tMaxData, tb)]);
      }
      setDrag(null);
    }
  };
  const onLeave = () => { setHover(null); setDrag(null); };

  const activePreset = (span: number | null): boolean => {
    if (span === null) return win === null;
    if (win === null) return false;
    // Match if the window right edge is the last contest and span ≈ requested.
    return Math.abs((win[1] - win[0]) - span) < 86400 && Math.abs(win[1] - tMaxData) < 86400;
  };
  const applyPreset = (span: number | null) => {
    if (span === null) { setWin(null); return; }
    setWin([Math.max(tMinData, tMaxData - span), tMaxData]);
    setHover(null);
  };

  const hovered = hover != null ? vis[hover] : null;
  const hoveredGain = hovered ? hovered.newRating - hovered.oldRating : 0;

  return (
    <div className="rc-wrap" ref={wrapRef}>
      <div className="rc-toolbar">
        <div className="rc-summary">
          <span>当前 <b style={{ color: tierColor(current) }}>{current}</b></span>
          <span>峰值 <b style={{ color: tierColor(peak) }}>{peak}</b></span>
          <span>最低 <b>{low}</b></span>
          <span>Δ <b className={delta >= 0 ? "rc-up" : "rc-down"}>{delta >= 0 ? "+" : ""}{delta}</b></span>
          <span className="rc-count">{sorted.length} 场</span>
        </div>
        <div className="rc-chips">
          {ZOOM_PRESETS.map(p => (
            <button
              key={p.label}
              className={`rc-chip${activePreset(p.span) ? " active" : ""}`}
              onClick={() => applyPreset(p.span)}
            >{p.label}</button>
          ))}
        </div>
      </div>

      <svg
        ref={svgRef}
        className="rc-svg"
        width={W}
        height={H}
        onMouseMove={onMove}
        onMouseDown={onDown}
        onMouseUp={onUp}
        onMouseLeave={onLeave}
        style={{ cursor: drag ? "ew-resize" : "crosshair" }}
      >
        <defs>
          <linearGradient id="rc-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.30" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* tier bands */}
        {bands.map((b, i) => (
          <rect key={i} x={padL} y={b.y} width={chartW} height={b.h} fill={b.color} opacity={0.1} />
        ))}

        {/* Y gridlines + labels */}
        {yTicks.map(r => (
          <g key={r}>
            <line x1={padL} y1={sy(r)} x2={padL + chartW} y2={sy(r)} stroke="var(--border)" strokeDasharray="3 5" strokeWidth="1" />
            <text x={padL - 8} y={sy(r) + 3} textAnchor="end" className="rc-axis-label">{r}</text>
          </g>
        ))}
        {/* Y bounds labels */}
        <text x={padL - 8} y={sy(yMin) + 3} textAnchor="end" className="rc-axis-label rc-axis-bound">{yMin}</text>
        <text x={padL - 8} y={sy(yMax) + 3} textAnchor="end" className="rc-axis-label rc-axis-bound">{yMax}</text>

        {/* X ticks */}
        {xTicks.map((t, i) => (
          <g key={i}>
            <line x1={t.x} y1={baselineY} x2={t.x} y2={baselineY + 4} stroke="var(--border)" strokeWidth="1" />
            <text x={t.x} y={baselineY + 18} textAnchor="middle" className="rc-axis-label">{t.label}</text>
          </g>
        ))}
        {/* axes */}
        <line x1={padL} y1={padT} x2={padL} y2={baselineY} stroke="var(--border)" strokeWidth="1" />
        <line x1={padL} y1={baselineY} x2={padL + chartW} y2={baselineY} stroke="var(--border)" strokeWidth="1" />

        {/* area + curve */}
        {areaPath && <path d={areaPath} fill="url(#rc-area)" />}
        {vis.length > 1 && (
          <polyline points={polyline} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        )}

        {/* hover crosshair */}
        {hovered && (
          <line
            x1={sx(hovered.ratingUpdateTimeSeconds)} y1={padT}
            x2={sx(hovered.ratingUpdateTimeSeconds)} y2={baselineY}
            stroke="var(--muted)" strokeWidth="1" strokeDasharray="2 3"
          />
        )}

        {/* points — thinned when dense so they don't smear into a blob */}
        {vis.map((c, i) => {
          const dense = vis.length > 80;
          const isHover = i === hover;
          if (dense && !isHover && i % Math.ceil(vis.length / 80) !== 0) return null;
          return (
            <circle
              key={i}
              cx={sx(c.ratingUpdateTimeSeconds)}
              cy={sy(c.newRating)}
              r={isHover ? 5.5 : (dense ? 2 : 3.5)}
              fill={tierColor(c.newRating)}
              stroke="var(--surface)" strokeWidth={isHover ? 2 : 1}
            />
          );
        })}

        {/* drag-to-zoom selection */}
        {drag && Math.abs(drag.x1 - drag.x0) > 2 && (
          <rect
            x={Math.min(drag.x0, drag.x1)} y={padT}
            width={Math.abs(drag.x1 - drag.x0)} height={chartH}
            fill="var(--accent)" opacity={0.14} stroke="var(--accent)" strokeOpacity={0.5} strokeWidth={1}
          />
        )}
      </svg>

      {vis.length === 0 && <div className="rc-note">该区间没有比赛 — 点「全部」重置</div>}
      {!drag && <div className="rc-hint">拖动图表选区缩放 · 点上方时间片切换范围</div>}

      {/* tooltip */}
      {hovered && (
        <div
          className="rc-tip"
          style={{
            left: Math.min(Math.max(sx(hovered.ratingUpdateTimeSeconds), 90), W - 90),
            top: sy(hovered.newRating),
          }}
        >
          <div className="rc-tip-name">{hovered.contestName}</div>
          <div className="rc-tip-row">
            <span className="rc-tip-date">{formatDate(hovered.ratingUpdateTimeSeconds)}</span>
            <span className="rc-tip-rank">rank #{hovered.rank}</span>
          </div>
          <div className="rc-tip-row">
            <span className="rc-tip-rating" style={{ color: tierColor(hovered.newRating) }}>
              {hovered.oldRating} → <b>{hovered.newRating}</b>
            </span>
            <span className={hoveredGain >= 0 ? "rc-up" : "rc-down"}>
              {hoveredGain >= 0 ? "+" : ""}{hoveredGain}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
