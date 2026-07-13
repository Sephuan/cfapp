import { useMemo } from "react";
import type { UserSubmission } from "../../../api";
import { tierColor } from "./utils";

// Each bar's height is proportional; color follows the official CF rating tier.
export function RatingDistChart({ submissions }: { submissions: UserSubmission[] }) {
  const buckets = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of submissions) {
      if (s.verdict !== "OK" || !s.problem.rating) continue;
      const key = `${s.problem.rating}`;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => Number(a[0]) - Number(b[0]));
  }, [submissions]);

  if (buckets.length === 0) return (
    <div className="stats-empty">No rated problems solved yet — solve some rated problems to see your distribution.</div>
  );
  const max = Math.max(...buckets.map(b => b[1]));

  return (
    <div className="stats-bar-chart">
      {buckets.map(([rating, count]) => (
        <div key={rating} className="stats-bar-col">
          <div className="stats-bar-count">{count}</div>
          <div className="stats-bar-track">
            <div className="stats-bar" style={{
              height: `${(count / max) * 100}%`,
              background: tierColor(Number(rating)),
            }} />
          </div>
          <div className="stats-bar-label">{rating}</div>
        </div>
      ))}
    </div>
  );
}
