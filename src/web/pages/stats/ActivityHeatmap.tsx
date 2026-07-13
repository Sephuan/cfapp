import { useState, useRef, useMemo, useLayoutEffect } from "react";
import type { UserSubmission } from "../../../api";

// ~1 year of daily submission counts (GitHub-style heatmap).
export function ActivityHeatmap({ submissions }: { submissions: UserSubmission[] }) {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [tipPos, setTipPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });

  // Clamp the tooltip fully inside the viewport on BOTH axes. This has to be
  // zoom-aware: the stats page zooms via `document.body.style.zoom`, under which
  // mouse coords (tip.x/y) and getBoundingClientRect() are in SCREEN space
  // (scaled), while offsetWidth and the CSS `left`/`top` we set are in LAYOUT
  // space (unscaled). Mixing them made the tooltip overflow at high zoom. So we
  // measure the real on-screen size with getBoundingClientRect(), derive the
  // zoom factor from rect.width/offsetWidth, clamp entirely in screen space
  // against innerWidth/innerHeight, then divide by zoom to get the layout-space
  // left/top the element actually uses. useLayoutEffect runs before paint → no
  // flicker.
  useLayoutEffect(() => {
    if (!tip || !tipRef.current) return;
    const el = tipRef.current;
    const rect = el.getBoundingClientRect();   // screen space (post-zoom)
    const w = rect.width, h = rect.height;
    const zoom = el.offsetWidth ? rect.width / el.offsetWidth : 1;
    const vw = window.innerWidth, vh = window.innerHeight;   // screen space
    const clamp = (v: number, size: number, max: number) => Math.max(8, Math.min(v, max - size - 8));
    // Prefer right/above the cursor; flip to left/below if it wouldn't fit.
    const rawLeft = tip.x + 12 + w > vw - 8 ? tip.x - 12 - w : tip.x + 12;
    const rawTop = tip.y - 34 < 8 ? tip.y + 20 : tip.y - 34;
    const screenLeft = clamp(rawLeft, w, vw);
    const screenTop = clamp(rawTop, h, vh);
    setTipPos({ left: screenLeft / zoom, top: screenTop / zoom });  // → layout space
  }, [tip]);

  const { grid, monthLabels, maxCount, weeks } = useMemo(() => {
    const dayCounts = new Map<string, number>();
    for (const s of submissions) {
      const d = new Date(s.creationTimeSeconds * 1000);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      dayCounts.set(key, (dayCounts.get(key) ?? 0) + 1);
    }

    const cells: { date: string; displayDate: string; count: number; week: number; day: number }[] = [];
    const now = new Date();
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 363);
    startDate.setDate(startDate.getDate() - startDate.getDay());

    const monthLabels: { week: number; label: string }[] = [];
    let lastMonth = -1;
    const current = new Date(startDate);
    let week = 0;
    while (current <= now) {
      const key = `${current.getFullYear()}-${current.getMonth()}-${current.getDate()}`;
      const displayDate = current.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      cells.push({ date: key, displayDate, count: dayCounts.get(key) ?? 0, week, day: current.getDay() });
      // Emit a month label when the month changes at the start of a week (day 0).
      if (current.getDay() === 0 && current.getMonth() !== lastMonth) {
        monthLabels.push({ week, label: current.toLocaleDateString("en-US", { month: "short" }) });
        lastMonth = current.getMonth();
      }
      if (current.getDay() === 6) week++;
      current.setDate(current.getDate() + 1);
    }
    return { grid: cells, monthLabels, maxCount: Math.max(...cells.map(c => c.count), 1), weeks: week + 1 };
  }, [submissions]);

  // 4-step quantized legend colors.
  const stepColor = (count: number): string => {
    if (count === 0) return "var(--stats-heat-0)";
    const ratio = count / maxCount;
    if (ratio <= 0.25) return "var(--stats-heat-1)";
    if (ratio <= 0.5) return "var(--stats-heat-2)";
    if (ratio <= 0.75) return "var(--stats-heat-3)";
    return "var(--stats-heat-4)";
  };

  return (
    <div className="stats-heatmap-wrap">
      <div className="stats-heatmap-scroll">
        {/* Month grid uses the SAME column template as the cell grid below so
            each label sits exactly above the week column it marks. */}
        <div className="stats-heatmap-months" style={{ gridTemplateColumns: `repeat(${weeks}, 14px)` }}>
          {monthLabels.map(m => (
            <span key={m.week} style={{ gridColumn: `${m.week + 1} / span 1` }}>{m.label}</span>
          ))}
        </div>
        <div className="stats-heatmap-body">
          <div className="stats-heatmap-weekdays">
            <span>Mon</span><span>Wed</span><span>Fri</span>
          </div>
          <div className="stats-heatmap" style={{ gridTemplateColumns: `repeat(${weeks}, 14px)` }}>
            {grid.map((cell, i) => (
              <div
                key={i}
                className="stats-heat-cell"
                style={{ background: stepColor(cell.count) }}
                onMouseEnter={e => setTip({ x: e.clientX, y: e.clientY, text: `${cell.displayDate}: ${cell.count} submission${cell.count === 1 ? "" : "s"}` })}
                onMouseLeave={() => setTip(null)}
              />
            ))}
          </div>
        </div>
        <div className="stats-heatmap-legend">
          <span className="legend-text">Less</span>
          <span className="legend-chip" style={{ background: "var(--stats-heat-0)" }} />
          <span className="legend-chip" style={{ background: "var(--stats-heat-1)" }} />
          <span className="legend-chip" style={{ background: "var(--stats-heat-2)" }} />
          <span className="legend-chip" style={{ background: "var(--stats-heat-3)" }} />
          <span className="legend-chip" style={{ background: "var(--stats-heat-4)" }} />
          <span className="legend-text">More</span>
        </div>
      </div>
      {tip && (
        <div ref={tipRef} className="stats-heat-tip" style={{ left: tipPos.left, top: tipPos.top }}>
          {tip.text}
        </div>
      )}
    </div>
  );
}
