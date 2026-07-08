import { useState, useEffect, useRef } from "react";
import { useKeyboard } from "@opentui/react";
import { type CFConfig } from "../config";
import { type SubmissionResult, getContestSubmissions } from "../api";

const VC: Record<string, string> = {
  OK: "#16c79a", WRONG_ANSWER: "#e94560", TIME_LIMIT_EXCEEDED: "#f5a623",
  MEMORY_LIMIT_EXCEEDED: "#f5a623", RUNTIME_ERROR: "#e94560", COMPILATION_ERROR: "#c471ed",
  SKIPPED: "#555", TESTING: "#53a8b6",
};

interface Props { config: CFConfig; contestId: number; onBack: () => void; }

export function SubmissionsScreen({ config, contestId, onBack }: Props) {
  const [subs, setSubs] = useState<SubmissionResult[]>([]);
  const [status, setStatus] = useState("Loading...");
  const [cursor, setCursor] = useState(0);
  const subRef = useRef<SubmissionResult[]>([]);
  useEffect(() => { subRef.current = subs; }, [subs]);

  const load = async () => {
    setStatus("Loading...");
    try {
      const data = await getContestSubmissions(config, contestId, config.handle);
      setSubs(data);
      setStatus(`${data.length} submissions`);
    } catch (e: any) { setStatus(`Error: ${e.message}`); }
  };
  useEffect(() => { load(); }, []);

  useKeyboard((key) => {
    if (key.name === "escape") onBack();
    else if (key.name === "r") load();
    else if (key.name === "up" || key.name === "k") setCursor((c) => Math.max(0, c - 1));
    else if (key.name === "down" || key.name === "j") setCursor((c) => Math.min(subRef.current.length - 1, c + 1));
  });

  const LIST_ROWS = 20;
  const start = Math.max(0, cursor - LIST_ROWS + 3);
  const visible = subs.slice(start, start + LIST_ROWS);

  return (
    <box flexDirection="column" width="100%" height="100%">
      <box height={1} paddingX={1} backgroundColor="#1a1a2e" flexDirection="row">
        <box><text><span bold fg="#e94560">← </span><span bold fg="white">Submissions</span><span fg="#888"> — {contestId}{config.handle ? ` / ${config.handle}` : ""}</span></text></box>
        <box flexGrow={1} />
        <box><text fg="#53a8b6">{status}</text></box>
      </box>
      <box height={1} paddingX={1} flexDirection="row">
        <box width={9}><text fg="#555">  ID</text></box>
        <box width={7}><text fg="#555">Prob</text></box>
        <box width={20}><text fg="#555">Verdict</text></box>
        <box width={5}><text fg="#555">Test</text></box>
        <box width={14}><text fg="#555">Language</text></box>
        <box width={7}><text fg="#555">Time</text></box>
        <box><text fg="#555">Mem</text></box>
      </box>
      <box flexDirection="column" flexGrow={1} paddingX={1}>
        {visible.map((s, i) => {
          const idx = start + i;
          const sel = idx === cursor;
          const v = s.verdict || "PENDING";
          return (
            <box key={s.id} height={1} backgroundColor={sel ? "#0f3460" : undefined} flexDirection="row">
              <box width={9}><text fg={sel ? "#e94560" : "#555"}>{sel ? " ▸" : "  "}{s.id}</text></box>
              <box width={7}><text fg="#ccc">{s.contestId}{s.problemIndex}</text></box>
              <box width={20}><text fg={VC[v] || "#aaa"} bold={v === "OK"}>{v}</text></box>
              <box width={5}><text fg="#888">{s.passedTestCount}</text></box>
              <box width={14}><text fg="#666">{s.programmingLanguage.length > 12 ? s.programmingLanguage.slice(0, 12) + "…" : s.programmingLanguage}</text></box>
              <box width={7}><text fg="#666">{s.timeConsumedMillis}ms</text></box>
              <box><text fg="#666">{s.memoryConsumedBytes ? `${Math.floor(s.memoryConsumedBytes / 1024)}KB` : ""}</text></box>
            </box>
          );
        })}
        {visible.length < LIST_ROWS && Array.from({ length: LIST_ROWS - visible.length }).map((_, i) => (
          <box key={`e-${i}`} height={1}><text> </text></box>
        ))}
      </box>
      <box height={1} paddingX={1} backgroundColor="#1a1a2e">
        <text><span fg="#f5a623" bold>r</span><span fg="#888"> refresh  </span><span fg="#666" bold>j/k</span><span fg="#888"> nav  </span><span fg="#666" bold>Esc</span><span fg="#888"> back  </span><span fg="#444">{cursor + 1}/{subs.length}</span></text>
      </box>
    </box>
  );
}
