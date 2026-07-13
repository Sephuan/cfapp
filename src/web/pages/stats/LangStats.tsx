import { useMemo } from "react";
import type { UserSubmission } from "../../../api";

export function LangStats({ submissions }: { submissions: UserSubmission[] }) {
  const langs = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of submissions) {
      const lang = s.programmingLanguage || "Unknown";
      map.set(lang, (map.get(lang) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [submissions]);

  if (langs.length === 0) return <div className="stats-empty">No submissions yet.</div>;
  const max = langs[0]![1];

  return (
    <div className="stats-lang-list">
      {langs.map(([lang, count], i) => (
        <div key={lang} className="stats-lang-row">
          <span className="stats-lang-rank">{i + 1}</span>
          <span className="stats-lang-name" title={lang}>{lang}</span>
          <div className="stats-lang-bar">
            <div className="stats-lang-fill" style={{ width: `${(count / max) * 100}%` }} />
          </div>
          <span className="stats-lang-count">{count}</span>
        </div>
      ))}
    </div>
  );
}
