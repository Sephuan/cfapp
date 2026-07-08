import { useState, useEffect, useRef } from "react";
import { useKeyboard } from "@opentui/react";
import { type CFConfig } from "../config";
import { type Standings, getStandings } from "../api";

interface StandingsProps { config: CFConfig; contestId: number; onBack: () => void; }

export function StandingsScreen({ config, contestId, onBack }: StandingsProps) {
  const [data, setData] = useState<Standings | null>(null);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("Loading...");
  const [filterHandle, setFilterHandle] = useState("");
  const [filtering, setFiltering] = useState(false);
  const filteringRef = useRef(false);
  useEffect(() => { filteringRef.current = filtering; }, [filtering]);
  const pageSize = 50;

  const load = async (p: number) => {
    setStatus("Loading...");
    try {
      const r = await getStandings(config, contestId, (p - 1) * pageSize + 1, pageSize);
      setData(r);
      setStatus(r.contest.name);
    } catch (e: any) { setStatus(`Error: ${e.message}`); }
  };

  useEffect(() => { load(page); }, [page]);

  useKeyboard((key) => {
    if (filteringRef.current) {
      if (key.name === "escape") { setFiltering(false); filteringRef.current = false; }
      return;
    }
    if (key.name === "escape") onBack();
    else if (key.name === "n") setPage((p) => p + 1);
    else if (key.name === "p") setPage((p) => Math.max(1, p - 1));
    else if (key.name === "g") setPage(1);
    else if (key.name === "h") { setFiltering(true); filteringRef.current = true; }
    else if (key.name === "c") { setFilterHandle(""); setPage(1); }
  });

  const cols = data?.problems.map((p) => p.index) || [];
  const LIST_ROWS = 20;
  const rows = filterHandle
    ? (data?.rows || []).filter((r) => r.handle.toLowerCase().includes(filterHandle.toLowerCase()))
    : data?.rows || [];

  return (
    <box flexDirection="column" width="100%" height="100%">
      <box height={1} paddingX={1} backgroundColor="#1a1a2e" flexDirection="row">
        <box><text><span bold fg="#e94560">← </span><span bold fg="white">Standings</span><span fg="#888"> — {contestId}</span></text></box>
        <box flexGrow={1} />
        <box><text fg="#53a8b6">{status}</text></box>
      </box>

      {filtering ? (
        <box height={1} paddingX={1} backgroundColor="#16213e" flexDirection="row">
          <box><text fg="#f5a623" bold>⌕ Handle: </text></box>
          <input value={filterHandle} onChange={setFilterHandle} onSubmit={() => { setFiltering(false); filteringRef.current = false; }} placeholder="enter handle..." focused />
        </box>
      ) : null}

      <box height={1} paddingX={1} flexDirection="row">
        <box width={5}><text fg="#555">Rank</text></box>
        <box width={18}><text fg="#555">Handle</text></box>
        <box width={5}><text fg="#555">Score</text></box>
        <box width={4}><text fg="#555">Pen</text></box>
        {cols.map((c) => <box key={c} width={3}><text fg="#555">{c}</text></box>)}
      </box>

      <box flexDirection="column" flexGrow={1} paddingX={1}>
        {rows.slice(0, LIST_ROWS).map((row) => {
          const isMe = row.handle === config.handle;
          return (
            <box key={row.rank} height={1} backgroundColor={isMe ? "#1a3a5c" : undefined} flexDirection="row">
              <box width={5}><text fg={isMe ? "#e94560" : "#888"} bold={isMe}>{row.rank}</text></box>
              <box width={18}>
                <text fg={isMe ? "#e94560" : "#ccc"} bold={isMe}>
                  {row.handle.length > 16 ? row.handle.slice(0, 16) + "…" : row.handle}
                </text>
              </box>
              <box width={5}><text fg="white" bold>{Math.floor(row.points)}</text></box>
              <box width={4}><text fg="#666">{row.penalty}</text></box>
              {row.problemResults.map((pr, i) => {
                if (pr.points > 0) return <box key={i} width={3}><text fg="#16c79a" bold>+{Math.floor(pr.points)}</text></box>;
                if (pr.rejectedAttemptCount > 0) return <box key={i} width={3}><text fg="#e94560">-{pr.rejectedAttemptCount}</text></box>;
                return <box key={i} width={3}><text fg="#333">·</text></box>;
              })}
            </box>
          );
        })}
        {rows.length < LIST_ROWS && Array.from({ length: LIST_ROWS - rows.length }).map((_, i) => (
          <box key={`e-${i}`} height={1}><text> </text></box>
        ))}
      </box>

      <box height={1} paddingX={1} backgroundColor="#1a1a2e">
        <text><span fg="#53a8b6" bold>n/p</span><span fg="#888"> page  </span><span fg="#f5a623" bold>h</span><span fg="#888"> filter  </span><span fg="#16c79a" bold>c</span><span fg="#888"> clear  </span><span fg="#666" bold>Esc</span><span fg="#888"> back  </span><span fg="#444">P{page} | {data?.totalRows || "?"} rows{filterHandle ? ` | ${filterHandle}` : ""}</span></text>
      </box>
    </box>
  );
}
