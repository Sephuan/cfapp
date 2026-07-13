import { useMemo } from "react";
import type { UserSubmission } from "../../../api";

const VERDICT_COLORS: Record<string, string> = {
  OK: "#10b981", WRONG_ANSWER: "#ef4444", TIME_LIMIT_EXCEEDED: "#f59e0b",
  RUNTIME_ERROR: "#e879f9", COMPILATION_ERROR: "#a78bfa",
  MEMORY_LIMIT_EXCEEDED: "#06b6d4", IDLENESS_LIMIT_EXCEEDED: "#f472b6",
  CHALLENGED: "#78716c",
};

export function VerdistDonut({ submissions }: { submissions: UserSubmission[] }) {
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of submissions) {
      const v = s.verdict || "OTHER";
      map.set(v, (map.get(v) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [submissions]);

  if (counts.length === 0) return <div className="stats-empty">No submissions yet.</div>;

  const total = counts.reduce((s, [, c]) => s + c, 0);
  const top = counts.slice(0, 6);
  const other = total - top.reduce((s, [, c]) => s + c, 0);
  const slices = other > 0 ? [...top, ["OTHER", other] as [string, number]] : top;

  let accum = 0;
  const gradient = slices.map(([v, c]) => {
    const start = (accum / total) * 360;
    accum += c;
    const end = (accum / total) * 360;
    const color = VERDICT_COLORS[v] ?? "#6b7280";
    return `${color} ${start}deg ${end}deg`;
  }).join(", ");

  const acCount = counts.find(([v]) => v === "OK")?.[1] ?? 0;

  return (
    <div className="stats-donut-row">
      <div className="stats-donut" style={{ background: `conic-gradient(${gradient})` }}>
        <div className="stats-donut-hole">
          <div className="stats-donut-center-num">{acCount}</div>
          <div className="stats-donut-center-label">AC</div>
        </div>
      </div>
      <div className="stats-donut-legend">
        {slices.map(([v, c]) => (
          <div key={v} className="stats-legend-item">
            <span className="stats-legend-dot" style={{ background: VERDICT_COLORS[v] ?? "#6b7280" }} />
            <span className="stats-legend-name">{v.replace(/_/g, " ").toLowerCase().replace(/^\w/, ch => ch.toUpperCase())}</span>
            <span className="stats-legend-bar-wrap">
              <span className="stats-legend-bar" style={{ width: `${(c / total) * 100}%`, background: VERDICT_COLORS[v] ?? "#6b7280" }} />
            </span>
            <span className="stats-legend-count">{c}</span>
            <span className="stats-legend-pct">{(c / total * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
