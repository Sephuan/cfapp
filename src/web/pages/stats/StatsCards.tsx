import { useMemo } from "react";
import type { UserSubmission } from "../../../api";

export function StatsCards({ submissions }: { submissions: UserSubmission[] }) {
  const acSubs = submissions.filter(s => s.verdict === "OK");
  const uniqueProblems = new Set(acSubs.map(s => `${s.problem.contestId}-${s.problem.index}`));
  const acRate = submissions.length > 0 ? (acSubs.length / submissions.length * 100) : 0;

  const streak = useMemo(() => {
    if (submissions.length === 0) return 0;
    const days = new Set(submissions.map(s => {
      const d = new Date(s.creationTimeSeconds * 1000);
      return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    }));
    const now = new Date();
    let count = 0;
    for (let i = 0; i < 365; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (days.has(key)) count++;
      else break;
    }
    return count;
  }, [submissions]);

  const cards = [
    { value: String(uniqueProblems.size), label: "Problems Solved", sub: `${acSubs.length} AC attempts`, accent: "var(--ok)" },
    { value: String(submissions.length), label: "Submissions", sub: "all time", accent: "var(--accent)" },
    { value: `${acRate.toFixed(1)}%`, label: "Acceptance", sub: acRate > 0 ? `${acSubs.length} of ${submissions.length}` : "—", accent: "var(--warn)" },
    { value: String(streak), label: "Day Streak", sub: streak > 0 ? "current" : "today", accent: "#a855f7" },
  ];

  return (
    <div className="stats-cards">
      {cards.map(c => (
        <div key={c.label} className="stat-card" style={{ ["--card-accent" as string]: c.accent }}>
          <div className="stat-card-label">{c.label}</div>
          <div className="stat-card-value">{c.value}</div>
          <div className="stat-card-sub">{c.sub}</div>
        </div>
      ))}
    </div>
  );
}
