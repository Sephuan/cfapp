import type React from "react";
import type { Contest, Problem } from "../../api";
import { useFetchJSON, type LocalStorageCache } from "../hooks";

// Persist per-contest problem lists + my-status so a revisited contest shows
// instantly and survives restarts/offline (URL-keyed, so each contest is its
// own entry). Refreshes in the background.
const PROBLEMS_CACHE: LocalStorageCache = { keyPrefix: "cfapp_problems_" };
const MYSTATUS_CACHE: LocalStorageCache = { keyPrefix: "cfapp_mystatus_" };

export function ProblemsPage({ contest, onPick, refreshTick }: { contest: Contest; onPick: (p: Problem) => void; refreshTick: number }) {
  const { data, err, loading } = useFetchJSON<Problem[]>(`/api/contests/${contest.id}/problems`, refreshTick, PROBLEMS_CACHE);
  // Per-handle solve status. Failure here is non-fatal — we just don't draw markers.
  const { data: mine } = useFetchJSON<{ byIndex: Record<string, "AC" | "WA"> }>(`/api/contests/${contest.id}/my-status`, refreshTick, MYSTATUS_CACHE);
  const byIndex = mine?.byIndex ?? {};
  return (
    <div className="container">
      {loading && <div className="loading">Loading problems…</div>}
      {err && <div className="loading">Failed: {err}</div>}
      {data && (
        <table className="list">
          <thead><tr><th style={{ width: 60 }}>☆</th><th style={{ width: 36 }} /><th>Name</th><th style={{ width: 90 }}>Rating</th><th>Tags</th></tr></thead>
          <tbody>
            {data.map(p => {
              const verdict = byIndex[p.index];
              const rowStyle: React.CSSProperties = verdict === "AC"
                ? { background: "color-mix(in srgb, var(--ok) 12%, transparent)" }
                : verdict === "WA"
                ? { background: "color-mix(in srgb, var(--err) 7%, transparent)" }
                : {};
              return (
                <tr key={p.index} onClick={() => onPick(p)} style={rowStyle}>
                  <td>{p.index}</td>
                  <td style={{ textAlign: "center", fontWeight: 700,
                               color: verdict === "AC" ? "var(--ok)" : verdict === "WA" ? "var(--err)" : "transparent" }}>
                    {verdict === "AC" ? "✓" : verdict === "WA" ? "✗" : ""}
                  </td>
                  <td>{p.name}</td>
                  <td>{p.rating ? <span className="rating">★ {p.rating}</span> : ""}</td>
                  <td style={{ color: "#6b7280", fontSize: "0.85rem" }}>{p.tags.join(", ")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
