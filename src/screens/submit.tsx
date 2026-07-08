import { useState, useRef } from "react";
import { useKeyboard } from "@opentui/react";
import type { TextareaRenderable } from "@opentui/core";
import { CFConfig } from "../config";
import { Problem, submitCode, LANGUAGES } from "../api";

interface SubmitProps { config: CFConfig; problem: Problem; onBack: () => void; }

export function SubmitScreen({ config, problem, onBack }: SubmitProps) {
  const [langIdx, setLangIdx] = useState(0);
  const [filePath, setFilePath] = useState("");
  const [code, setCode] = useState("");
  const [result, setResult] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [editing, setEditing] = useState(true);
  const textareaRef = useRef<TextareaRenderable | null>(null);

  const loadFile = async () => {
    if (!filePath.trim()) { setResult("✗ File path is empty!"); return; }
    try { setCode(await Bun.file(filePath).text()); setResult(`✓ Loaded ${filePath}`); }
    catch { setResult("✗ Failed to read file"); }
  };

  const doSubmit = async () => {
    if (!code.trim()) { setResult("✗ Code is empty!"); return; }
    setSubmitting(true); setResult("⏳ Submitting...");
    const res = await submitCode(config, problem.contestId, problem.index, code, LANGUAGES[langIdx]?.id || 54);
    setResult(res.startsWith("OK") ? `✓ ${res}` : `✗ ${res}`);
    setSubmitting(false);
  };

  useKeyboard((key) => {
    // Ctrl-combos still work while editing; plain keys are owned by the textarea.
    if (key.ctrl && key.name === "s") { doSubmit(); return; }
    if (key.ctrl && key.name === "f") { if (filePath) loadFile(); return; }
    if (editing) {
      if (key.name === "escape") setEditing(false);
      return;
    }
    if (key.name === "escape") onBack();
    else if (key.name === "i" || key.name === "e") setEditing(true);
  });

  const isOk = result.startsWith("✓"); const isErr = result.startsWith("✗");

  return (
    <box flexDirection="column" width="100%" height="100%">
      <box height={1} paddingX={1} backgroundColor="#1a1a2e" flexDirection="row">
        <box><text><span bold fg="#e94560">← </span><span bold fg="white">Submit</span><span fg="#ccc"> — {problem.contestId}{problem.index} {problem.name}</span></text></box>
      </box>
      <box height={1} paddingX={1} gap={3} flexDirection="row">
        <box><text fg="#888">Lang: <span fg="#53a8b6" bold>{LANGUAGES[langIdx]?.name}</span></text></box>
        <box><text fg="#888">File: <span fg="#f5a623">{filePath || "(none)"}</span></text></box>
        <box flexGrow={1} />
        <box><text fg={editing ? "#16c79a" : "#666"} bold={editing}>{editing ? "● EDIT" : "○ view (i to edit)"}</text></box>
      </box>
      <box flexGrow={1} borderStyle="single" borderColor={editing ? "#16c79a" : "#333"} padding={1}>
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
      {result ? (
        <box height={1} paddingX={1}>
          <text fg={isOk ? "#16c79a" : isErr ? "#e94560" : "#f5a623"} bold>{result}</text>
        </box>
      ) : null}
      <box height={1} paddingX={1} backgroundColor="#1a1a2e">
        <text><span fg="#16c79a" bold>Ctrl+S</span><span fg="#888"> submit  </span><span fg="#53a8b6" bold>Ctrl+F</span><span fg="#888"> load  </span><span fg="#16c79a" bold>i</span><span fg="#888"> edit  </span><span fg="#666" bold>Esc</span><span fg="#888"> back</span>{submitting ? <span fg="#f5a623"> ⏳</span> : null}</text>
      </box>
    </box>
  );
}
