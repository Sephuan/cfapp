import { useState, useEffect, useRef } from "react";
import { useKeyboard } from "@opentui/react";
import { type CFConfig } from "../config";
import { type Contest, getContests } from "../api";

interface ContestsProps {
  config: CFConfig;
  onSelect: (contest: Contest) => void;
  onStandings: (contestId: number) => void;
  onLogin: () => void;
}

export function ContestsScreen({ config, onSelect, onStandings, onLogin }: ContestsProps) {
  const [contests, setContests] = useState<Contest[]>([]);
  const [filtered, setFiltered] = useState<Contest[]>([]);
  const [cursor, setCursor] = useState(0);
  const [filter, setFilter] = useState("");
  const [filtering, setFiltering] = useState(false);
  const [status, setStatus] = useState("Loading...");

  const cursorRef = useRef(0);
  const filteredRef = useRef<Contest[]>([]);
  const filteringRef = useRef(false);
  const onSelectRef = useRef(onSelect);
  const onStandingsRef = useRef(onStandings);
  useEffect(() => { cursorRef.current = cursor; }, [cursor]);
  useEffect(() => { filteredRef.current = filtered; }, [filtered]);
  useEffect(() => { filteringRef.current = filtering; }, [filtering]);
  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);
  useEffect(() => { onStandingsRef.current = onStandings; }, [onStandings]);

  const load = async () => {
    setStatus("Loading...");
    try {
      const data = await getContests(config);
      setContests(data);
      setStatus(`${data.length} contests`);
    } catch (e: any) { setStatus(`Error: ${e.message}`); }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const f = filter.toLowerCase();
    const result = f
      ? contests.filter((c) => c.name.toLowerCase().includes(f) || c.id.toString().includes(f))
      : contests;
    setFiltered(result.slice(0, 200));
    setCursor(0);
  }, [contests, filter]);

  useKeyboard((key) => {
    if (filteringRef.current) {
      if (key.name === "escape") { setFiltering(false); filteringRef.current = false; }
      return;
    }
    const c = cursorRef.current;
    const f = filteredRef.current;
    if (key.name === "r") load();
    else if (key.name === "f") { setFiltering(true); filteringRef.current = true; }
    else if (key.name === "up" || key.name === "k") setCursor((p) => Math.max(0, p - 1));
    else if (key.name === "down" || key.name === "j") setCursor((p) => Math.min(f.length - 1, p + 1));
    else if (key.name === "return" || key.name === "enter") { if (f[c]) onSelectRef.current(f[c]); }
    else if (key.name === "s") { if (f[c]) onStandingsRef.current(f[c].id); }
  });

  const statusLabel = (c: Contest) => c.phase === "BEFORE" ? "SOON" : c.phase === "CODING" ? "LIVE" : "";
  const statusColor = (c: Contest) => c.phase === "BEFORE" ? "#f5a623" : c.phase === "CODING" ? "#16c79a" : undefined;
  const fmtDur = (s: number) => { const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); return h > 0 ? `${h}h${m}m` : `${m}m`; };
  const fmtTime = (ts: number) => ts ? new Date(ts * 1000).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";

  const LIST_ROWS = 20;
  const start = Math.max(0, cursor - LIST_ROWS + 3);
  const visible = filtered.slice(start, start + LIST_ROWS);

  // Fixed column widths: ID(8) + Name(40) + Status(7) + Time(7) + Start(13) = 75
  const W_ID = 8, W_NAME = 40, W_STATUS = 7, W_TIME = 7, W_START = 13;

  return (
    <box flexDirection="column" width="100%" height="100%">
      {/* Header */}
      <box height={1} width="100%" flexDirection="row" backgroundColor="#1a1a2e">
        <box width={W_ID + W_NAME + 1}><text><span bold fg="#e94560"> CF TUI</span></text></box>
        <box width={W_STATUS + W_TIME + W_START}><text fg="#16c79a">{config.handle || "guest"}</text></box>
      </box>

      {/* Filter */}
      <box height={1} width="100%" flexDirection="row" backgroundColor="#16213e">
        <box width={W_ID}><text fg="#53a8b6"> ⌕</text></box>
        {filtering ? (
          <box width={W_NAME}>
            <input value={filter} onChange={setFilter} onSubmit={() => { setFiltering(false); filteringRef.current = false; }} placeholder="search..." focused />
          </box>
        ) : (
          <box width={W_NAME}><text fg="#777">{filter || "f: search"}</text></box>
        )}
        <box width={W_STATUS + W_TIME + W_START}><text fg="#53a8b6">{status}</text></box>
      </box>

      {/* Column headers */}
      <box height={1} width="100%" flexDirection="row">
        <box width={W_ID}><text fg="#555">    ID</text></box>
        <box width={W_NAME}><text fg="#555"> Contest</text></box>
        <box width={W_STATUS}><text fg="#555">Status</text></box>
        <box width={W_TIME}><text fg="#555"> Time</text></box>
        <box width={W_START}><text fg="#555"> Start</text></box>
      </box>

      {/* Contest rows */}
      <box flexDirection="column" flexGrow={1} width="100%">
        {visible.map((c, i) => {
          const idx = start + i;
          const sel = idx === cursor;
          const sc = statusColor(c);
          const bg = sel ? "#0f3460" : undefined;
          return (
            <box key={c.id} height={1} width="100%" flexDirection="row" backgroundColor={bg}>
              <box width={W_ID}>
                <text fg={sel ? "#e94560" : "#666"} bold={sel}>{sel ? " ▸" : "  "}{c.id}</text>
              </box>
              <box width={W_NAME}>
                <text fg={sel ? "white" : "#bbb"} bold={sel}>
                  {c.name.length > W_NAME - 2 ? c.name.slice(0, W_NAME - 3) + "…" : c.name}
                </text>
              </box>
              <box width={W_STATUS}>
                <text fg={sc || "#444"} bold={!!sc}>{statusLabel(c)}</text>
              </box>
              <box width={W_TIME}>
                <text fg="#666">{fmtDur(c.durationSeconds)}</text>
              </box>
              <box width={W_START}>
                <text fg="#555">{fmtTime(c.startTimeSeconds)}</text>
              </box>
            </box>
          );
        })}
      </box>

      {/* Footer */}
      <box height={1} width="100%" flexDirection="row" backgroundColor="#1a1a2e">
        <box width={W_ID + W_NAME + 1}>
          <text>
            <span fg="#e94560" bold>↵</span><span fg="#888"> open  </span>
            <span fg="#16c79a" bold>s</span><span fg="#888"> standings  </span>
            <span fg="#53a8b6" bold>f</span><span fg="#888"> filter  </span>
            <span fg="#f5a623" bold>r</span><span fg="#888"> refresh  </span>
            <span fg="#666" bold>q</span><span fg="#888"> quit</span>
          </text>
        </box>
        <box width={W_STATUS + W_TIME + W_START}>
          <text fg="#444">{cursor + 1}/{filtered.length}</text>
        </box>
      </box>
    </box>
  );
}
