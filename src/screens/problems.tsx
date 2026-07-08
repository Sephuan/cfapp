import { useState, useEffect, useRef } from "react";
import { useKeyboard } from "@opentui/react";
import { type CFConfig } from "../config";
import { type Contest, type Problem, getContestProblems } from "../api";

interface ProblemsProps {
  config: CFConfig;
  contest: Contest;
  onView: (problem: Problem) => void;
  onSubmit: (problem: Problem) => void;
  onStandings: () => void;
  onSubmissions: () => void;
  onBack: () => void;
}

export function ProblemsScreen({ config, contest, onView, onSubmit, onStandings, onSubmissions, onBack }: ProblemsProps) {
  const [problems, setProblems] = useState<Problem[]>([]);
  const [cursor, setCursor] = useState(0);
  const [status, setStatus] = useState("Loading...");
  const cursorRef = useRef(0);
  const problemsRef = useRef<Problem[]>([]);
  const onViewRef = useRef(onView);
  const onSubmitRef = useRef(onSubmit);
  const onSubmissionsRef = useRef(onSubmissions);
  useEffect(() => { cursorRef.current = cursor; }, [cursor]);
  useEffect(() => { problemsRef.current = problems; }, [problems]);
  useEffect(() => { onViewRef.current = onView; }, [onView]);
  useEffect(() => { onSubmitRef.current = onSubmit; }, [onSubmit]);
  useEffect(() => { onSubmissionsRef.current = onSubmissions; }, [onSubmissions]);

  useEffect(() => {
    (async () => {
      try {
        const data = await getContestProblems(config, contest.id);
        setProblems(data);
        setStatus(`${data.length} problems`);
      } catch (e: any) { setStatus(`Error: ${e.message}`); }
    })();
  }, []);

  useKeyboard((key) => {
    const c = cursorRef.current;
    const p = problemsRef.current;
    if (key.name === "escape") onBack();
    else if (key.name === "up" || key.name === "k") setCursor((v) => Math.max(0, v - 1));
    else if (key.name === "down" || key.name === "j") setCursor((v) => Math.min(p.length - 1, v + 1));
    else if (key.name === "return" || key.name === "enter") { if (p[c]) onViewRef.current(p[c]); }
    else if (key.name === "s") { if (p[c]) onSubmitRef.current(p[c]); }
    else if (key.name === "l") onStandings();
    else if (key.name === "v") onSubmissionsRef.current();
  });

  const LIST_ROWS = 20;
  const start = Math.max(0, cursor - LIST_ROWS + 3);
  const visible = problems.slice(start, start + LIST_ROWS);

  return (
    <box flexDirection="column" width="100%" height="100%">
      <box height={1} paddingX={1} backgroundColor="#1a1a2e" flexDirection="row">
        <box><text><span bold fg="#e94560">← </span><span bold fg="white">{contest.name}</span></text></box>
        <box flexGrow={1} />
        <box><text fg="#53a8b6">{status}</text></box>
      </box>

      <box height={1} paddingX={1} flexDirection="row">
        <box width={5}><text fg="#555">  #</text></box>
        <box flexGrow={1}><text fg="#555"> Problem</text></box>
        <box width={7}><text fg="#555"> Rating</text></box>
        <box width={30}><text fg="#555"> Tags</text></box>
      </box>

      <box flexDirection="column" flexGrow={1} paddingX={1}>
        {visible.map((p, i) => {
          const idx = start + i;
          const sel = idx === cursor;
          const tags = p.tags.slice(0, 3).join(", ");
          return (
            <box key={p.index} height={1} backgroundColor={sel ? "#0f3460" : undefined} flexDirection="row">
              <box width={5}>
                <text fg={sel ? "#e94560" : "#666"} bold={sel}>
                  {sel ? "▸" : " "}{p.index}
                </text>
              </box>
              <box flexGrow={1} backgroundColor={sel ? "#0f3460" : undefined}>
                <text fg={sel ? "white" : "#bbb"} bold={sel}>
                  {p.name}
                </text>
              </box>
              <box width={7}>
                <text fg={p.rating ? "#f5a623" : "#444"}>
                  {p.rating || "—"}
                </text>
              </box>
              <box width={30}><text fg="#555">{tags.length > 28 ? tags.slice(0, 28) + "…" : tags}</text></box>
            </box>
          );
        })}
        {visible.length < LIST_ROWS && Array.from({ length: LIST_ROWS - visible.length }).map((_, i) => (
          <box key={`e-${i}`} height={1}><text> </text></box>
        ))}
      </box>

      <box height={1} paddingX={1} backgroundColor="#1a1a2e">
        <text><span fg="#e94560" bold>↵</span><span fg="#888"> read  </span><span fg="#16c79a" bold>s</span><span fg="#888"> submit  </span><span fg="#53a8b6" bold>l</span><span fg="#888"> standings  </span><span fg="#f5a623" bold>v</span><span fg="#888"> submissions  </span><span fg="#666" bold>Esc</span><span fg="#888"> back  </span><span fg="#444">{cursor + 1}/{problems.length}</span></text>
      </box>
    </box>
  );
}
