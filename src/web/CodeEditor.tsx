import { useEffect, useRef, useState } from "react";
import type React from "react";

// ----- prism loader (lazy) -----
declare global { interface Window { Prism?: any; } }

// CF language id → Prism language key. Only the common CP languages are mapped;
// anything else falls back to "cpp" which highlights most C-family syntax
// reasonably well.
export const PRISM_LANG_BY_CF_ID: Record<number, string> = {
  89: "cpp", 91: "cpp", 54: "cpp", 42: "cpp",
  31: "python", 7: "python", 70: "python",
  87: "java", 75: "rust", 98: "rust", 32: "go",
};

export function ensurePrism(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.Prism) return Promise.resolve();
  return new Promise((res) => {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "https://cdn.jsdelivr.net/npm/prismjs@1.29.0/themes/prism.min.css";
    document.head.appendChild(css);
    const core = document.createElement("script");
    core.src = "https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-core.min.js";
    core.onload = () => {
      const auto = document.createElement("script");
      auto.src = "https://cdn.jsdelivr.net/npm/prismjs@1.29.0/plugins/autoloader/prism-autoloader.min.js";
      auto.onload = () => res();
      document.head.appendChild(auto);
    };
    document.head.appendChild(core);
  });
}

// Highlight-overlay editor: a transparent <textarea> on top of a <pre> that
// holds the Prism-highlighted copy. Scroll is synced between the two so the
// highlight layer tracks the caret.
export function CodeEditor({ value, onChange, langKey }: {
  value: string;
  onChange: (v: string) => void;
  langKey: string;
}) {
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const preRef = useRef<HTMLPreElement | null>(null);
  const codeRef = useRef<HTMLElement | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => { ensurePrism().then(() => setReady(true)); }, []);

  useEffect(() => {
    if (!ready || !codeRef.current) return;
    const Prism = window.Prism;
    if (!Prism) return;
    codeRef.current.className = `language-${langKey}`;
    codeRef.current.textContent = value + (value.endsWith("\n") ? " " : "\n");
    Prism.highlightElement(codeRef.current);
  }, [value, langKey, ready]);

  // Sync scroll between textarea and overlay.
  const onScroll = () => {
    if (preRef.current && taRef.current) {
      preRef.current.scrollTop = taRef.current.scrollTop;
      preRef.current.scrollLeft = taRef.current.scrollLeft;
    }
  };

  // Tab inserts 4 spaces instead of moving focus.
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const ta = e.currentTarget;
      const s = ta.selectionStart, en = ta.selectionEnd;
      const next = value.slice(0, s) + "    " + value.slice(en);
      onChange(next);
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = s + 4; });
    }
  };

  return (
    <div className="code-wrap">
      <pre className="code-pre" ref={preRef} aria-hidden="true">
        <code ref={codeRef} className={`language-${langKey}`}>{value}</code>
      </pre>
      <textarea
        ref={taRef}
        className="code-ta"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={onScroll}
        onKeyDown={onKeyDown}
        spellCheck={false}
        placeholder="// your code here"
      />
    </div>
  );
}
