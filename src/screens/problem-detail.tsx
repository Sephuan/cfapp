import { useState, useEffect, useRef, useMemo } from "react";
import { useKeyboard } from "@opentui/react";
import { SyntaxStyle, type TextareaRenderable } from "@opentui/core";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { CFConfig } from "../config";
import { Problem, getProblemStatement, submitCode, LANGUAGES } from "../api";

interface DetailProps { config: CFConfig; problem: Problem; onSubmit: () => void; onBack: () => void; }

const DRAFT_DIR = join(homedir(), ".config", "cfapp", "drafts");

function draftPath(contestId: number, index: string): string {
  return join(DRAFT_DIR, `${contestId}${index}.txt`);
}

function loadDraft(contestId: number, index: string): string {
  try {
    const p = draftPath(contestId, index);
    if (existsSync(p)) return readFileSync(p, "utf-8");
  } catch {}
  return "";
}

function saveDraft(contestId: number, index: string, code: string): void {
  try {
    if (!existsSync(DRAFT_DIR)) mkdirSync(DRAFT_DIR, { recursive: true });
    writeFileSync(draftPath(contestId, index), code);
  } catch {}
}

export function ProblemDetailScreen({ config, problem, onSubmit, onBack }: DetailProps) {
  const [statement, setStatement] = useState("Loading...");
  const [code, setCode] = useState(() => loadDraft(problem.contestId, problem.index));
  const [langIdx, setLangIdx] = useState(0);
  const [submitResult, setSubmitResult] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const codeLines = code ? code.split("\n") : [""];
  // Dynamic height: grow with content, but cap so the page is still scrollable.
  const codeHeight = Math.max(8, Math.min(codeLines.length + 2, 40));

  const textareaRef = useRef<TextareaRenderable | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syntaxStyle = useMemo(() => SyntaxStyle.create(), []);

  useEffect(() => {
    (async () => {
      const text = await getProblemStatement(config, problem.contestId, problem.index);
      setStatement(text);
    })();
  }, []);

  // Debounced autosave whenever code changes.
  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveDraft(problem.contestId, problem.index, code);
      setSavedAt(Date.now());
    }, 400);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [code, problem.contestId, problem.index]);

  // Flush save on unmount.
  useEffect(() => {
    return () => {
      saveDraft(problem.contestId, problem.index, code);
    };
  }, []);

  const doSubmit = async () => {
    if (!code.trim()) { setSubmitResult("✗ Code is empty!"); return; }
    setSubmitting(true); setSubmitResult("⏳ Submitting...");
    const res = await submitCode(config, problem.contestId, problem.index, code, LANGUAGES[langIdx]?.id || 54);
    setSubmitResult(res.startsWith("OK") ? `✓ ${res}` : `✗ ${res}`);
    setSubmitting(false);
  };

  useKeyboard((key) => {
    // While editing, the textarea owns keyboard input. Only Escape exits.
    if (editing) {
      if (key.name === "escape") setEditing(false);
      return;
    }
    if (key.name === "escape") onBack();
    else if (key.name === "i" || key.name === "e") setEditing(true);
    else if (key.name === "s") onSubmit();
    else if (key.name === "tab") setLangIdx((i) => (i + 1) % LANGUAGES.length);
    else if (key.ctrl && key.name === "enter") doSubmit();
  });

  const isOk = submitResult.startsWith("✓");
  const isErr = submitResult.startsWith("✗");

  const saveLabel = savedAt
    ? `saved ${new Date(savedAt).toLocaleTimeString("zh-CN", { hour12: false })}`
    : "draft autosave";

  return (
    <box flexDirection="column" width="100%" height="100%">
      <box height={1} paddingX={1} backgroundColor="#1a1a2e" flexDirection="row">
        <box><text><span bold fg="#e94560">← </span><span bold fg="white">{problem.contestId}{problem.index}</span><span fg="#ccc"> {problem.name}</span></text></box>
        <box flexGrow={1} />
        <box><text fg="#f5a623">{problem.rating ? `★${problem.rating}` : ""}</text></box>
        <box paddingLeft={2}><text fg="#555">{problem.tags.slice(0, 3).join(", ")}</text></box>
      </box>

      <scrollbox style={{ rootOptions: { flexGrow: 1 } }} focused={!editing}>
        <box flexDirection="column" paddingX={2} paddingY={1}>
          <markdown content={statement} syntaxStyle={syntaxStyle} selectable />

          <text />

          <box height={1} paddingX={1} backgroundColor="#16213e" flexDirection="row">
            <box><text fg="#888">Lang: <span fg="#53a8b6" bold>{LANGUAGES[langIdx]?.name}</span><span fg="#555"> (Tab)</span></text></box>
            <box paddingLeft={2}><text fg={editing ? "#16c79a" : "#666"} bold={editing}>{editing ? "● EDIT" : "○ view (i to edit)"}</text></box>
            <box flexGrow={1} />
            <box><text fg="#666">{codeLines.length} lines · {saveLabel}</text></box>
          </box>

          <box height={codeHeight} borderStyle="single" borderColor={editing ? "#16c79a" : "#333"} padding={1}>
            <textarea
              ref={textareaRef as any}
              initialValue={code}
              onContentChange={() => {
                const t = textareaRef.current;
                if (t) setCode(t.plainText);
              }}
              focused={editing}
              wrapMode="char"
            />
          </box>

          {submitResult ? (
            <box height={1} paddingX={1} backgroundColor={isOk ? "#16213e" : "#2a1a2e"}>
              <text fg={isOk ? "#16c79a" : isErr ? "#e94560" : "#f5a623"} bold>{submitResult}</text>
            </box>
          ) : null}

          <box height={1} paddingX={1} backgroundColor="#16213e" flexDirection="row">
            <box flexGrow={1} />
            <box>
              <text fg={submitting ? "#888" : "#16c79a"} bold>{submitting ? "⏳ Submitting..." : "[ Ctrl+Enter to Submit ]"}</text>
            </box>
            <box flexGrow={1} />
          </box>
        </box>
      </scrollbox>

      <box height={1} paddingX={1} backgroundColor="#1a1a2e">
        <text>
          {editing ? (
            <>
              <span fg="#16c79a" bold>● EDIT</span>
              <span fg="#888">  Esc</span><span fg="#555"> exit editing  </span>
              <span fg="#53a8b6" bold>Ctrl+Enter</span><span fg="#888"> submit</span>
            </>
          ) : (
            <>
              <span fg="#16c79a" bold>i</span><span fg="#888"> edit code  </span>
              <span fg="#53a8b6" bold>Ctrl+Enter</span><span fg="#888"> submit  </span>
              <span fg="#53a8b6" bold>↑↓</span><span fg="#888"> scroll  </span>
              <span fg="#f5a623" bold>Tab</span><span fg="#888"> lang  </span>
              <span fg="#e94560" bold>Esc</span><span fg="#888"> back</span>
            </>
          )}
        </text>
      </box>
    </box>
  );
}
