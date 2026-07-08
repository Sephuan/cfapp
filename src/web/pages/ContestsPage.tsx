import { useMemo, useState } from "react";
import type { Contest } from "../../api";
import { useFetchJSON } from "../hooks";

export function ContestsPage({ onPick, refreshTick }: { onPick: (c: Contest) => void; refreshTick: number }) {
  const { data, err, loading } = useFetchJSON<Contest[]>("/api/contests", refreshTick);
  // Persisted x/y solve counts (long-term store). y=0 means we don't know
  // the problem count yet (user hasn't opened that contest's problems list).
  // /api/ac-sync pulls the full submission history so every contest's AC count
  // fills in at once; pressing the main refresh re-pulls (?refresh=1).
  const { data: acSummary } = useFetchJSON<Record<string, { ac: number; total: number }>>(
    "/api/ac-sync", refreshTick,
  );
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    if (!data) return [];
    const lc = q.toLowerCase();
    return data
      .filter(c => !q || c.name.toLowerCase().includes(lc) || String(c.id).includes(q))
      .slice(0, 200);
  }, [data, q]);
  return (
    <div className="container">
      <div className="searchbar">
        <input placeholder="Filter contests by name or id…" value={q} onChange={e => setQ(e.target.value)} />
      </div>
      {loading && <div className="loading">Loading contests…</div>}
      {err && <div className="loading">Failed: {err}</div>}
      {data && (
        <table className="list">
          <thead>
            <tr>
              <th style={{ width: 80 }}>ID</th>
              <th>Name</th>
              <th style={{ width: 80, textAlign: "right" }}>Solved</th>
              <th style={{ width: 110 }}>Phase</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(c => {
              const sum = acSummary?.[String(c.id)];
              const solvedText = sum
                ? sum.total > 0
                  ? `${sum.ac}/${sum.total}`
                  : sum.ac > 0 ? `${sum.ac}/?` : ""
                : "";
              const allSolved = sum && sum.total > 0 && sum.ac >= sum.total;
              const someSolved = sum && sum.ac > 0;
              const solvedColor = allSolved ? "var(--ok)" : someSolved ? "var(--accent, #3b82f6)" : "#9ca3af";
              return (
                <tr key={c.id} onClick={() => onPick(c)}>
                  <td>{c.id}</td>
                  <td>{c.name}</td>
                  <td style={{ textAlign: "right", color: solvedColor, fontVariantNumeric: "tabular-nums", fontWeight: someSolved ? 600 : 400 }}>
                    {solvedText}
                  </td>
                  <td><span className="badge">{c.phase}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
