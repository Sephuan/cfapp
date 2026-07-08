import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Contest, Problem } from "../../api";
import { useFetchJSON } from "../hooks";
import { CodeEditor, PRISM_LANG_BY_CF_ID } from "../CodeEditor";
import {
  type HLColor, type HLRange, type TrEntry,
  applyRangesToDOM, blockAtOffset, buildTrBlock, escapePlain,
  findTrAncestor, lsKey, mergeAddRange, mergeClearRange,
  rangeToOffsets, rangeToTexSource,
} from "../highlight";

type Statement = {
  title: string; timeLimit: string; memoryLimit: string;
  statementHtml: string; inputHtml: string; outputHtml: string;
  samples: { input: string; output: string }[]; noteHtml: string;
};
type Lang = { name: string; id: number };

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button className="copy" onClick={async () => {
      try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1200); }
      catch {}
    }}>{done ? "copied" : "copy"}</button>
  );
}

// ----- selection toolbar (highlight + translate) -----
type SelInfo = {
  x: number; y: number;
  // Snapshot of the selection range so we can act on it after the user clicks a button.
  saved: Range | null;
};

function SelectionToolbar(props: {
  scopeRef: React.RefObject<HTMLDivElement | null>;
  onHighlight: (color: HLColor) => void;
  onClear: () => void;
  onTranslatePop: () => void;
  onTranslateInline: () => void;
}) {
  const [sel, setSel] = useState<SelInfo | null>(null);
  useEffect(() => {
    const update = () => {
      const s = window.getSelection();
      if (!s || s.isCollapsed || s.rangeCount === 0) { setSel(null); return; }
      const range = s.getRangeAt(0);
      const scope = props.scopeRef.current;
      if (!scope) { setSel(null); return; }
      if (!scope.contains(range.commonAncestorContainer)) { setSel(null); return; }
      const rect = range.getBoundingClientRect();
      if (!rect.width && !rect.height) { setSel(null); return; }
      setSel({
        x: Math.max(8, rect.left + rect.width / 2 - 130),
        y: Math.max(8, rect.top - 44),
        saved: range.cloneRange(),
      });
    };
    document.addEventListener("selectionchange", update);
    return () => document.removeEventListener("selectionchange", update);
  }, [props.scopeRef]);

  if (!sel) return null;
  const swatch = (color: HLColor) => (
    <button className={`swatch ${color}`} title={color} onMouseDown={(e) => {
      e.preventDefault();
      props.onHighlight(color);
      window.getSelection()?.removeAllRanges();
      setSel(null);
    }} />
  );
  return (
    <div className="sel-toolbar" style={{ left: sel.x, top: sel.y }} onMouseDown={(e) => e.preventDefault()}>
      {swatch("red")}{swatch("green")}{swatch("blue")}{swatch("yellow")}{swatch("purple")}
      <div className="divider" />
      <button className="tbtn" onMouseDown={(e) => { e.preventDefault(); props.onClear(); window.getSelection()?.removeAllRanges(); setSel(null); }}>clear</button>
      <div className="divider" />
      <button className="tbtn" onMouseDown={(e) => { e.preventDefault(); props.onTranslatePop(); }} title="Pop translate">译</button>
      <button className="tbtn" onMouseDown={(e) => { e.preventDefault(); props.onTranslateInline(); window.getSelection()?.removeAllRanges(); setSel(null); }} title="Translate inline">译↓</button>
    </div>
  );
}

// ----- translation popover (transient, closes on outside click / Esc) -----
function TrPopover(props: {
  x: number; y: number; text: string; translation: string | null; html: string | null; error: string | null;
  onClose: () => void;
}) {
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".tr-popover")) props.onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") props.onClose(); };
    setTimeout(() => document.addEventListener("mousedown", onDown), 0);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [props.onClose]);
  const left = Math.min(props.x, window.innerWidth - 480);
  const top = Math.min(props.y, window.innerHeight - 200);
  return (
    <div className="tr-popover" style={{ left, top }}>
      <div className="tr-src">
        <span className="tr-label">译</span>
        <span>{props.text.length > 80 ? props.text.slice(0, 80) + "…" : props.text}</span>
      </div>
      {props.error
        ? <div style={{ color: "var(--err)" }}>{props.error}</div>
        : props.translation == null
          ? <div className="tr-busy">翻译中…</div>
          : props.html
            ? <div className="tr-body" dangerouslySetInnerHTML={{ __html: props.html }} />
            : <div className="tr-body" style={{ whiteSpace: "pre-wrap" }}>{props.translation}</div>}
    </div>
  );
}

// ----- problem page -----
export function ProblemPage({ contest, problem, onOpenSubmitTab, refreshTick }: { contest: Contest; problem: Problem; onOpenSubmitTab: (url: string, code: string, problemIndex: string, langId?: number) => void; refreshTick: number }) {
  const { data, err, loading } = useFetchJSON<Statement>(`/api/contests/${contest.id}/problem/${problem.index}`, refreshTick);
  const { data: langs } = useFetchJSON<Lang[]>("/api/languages");
  const [code, setCode] = useState("");
  const [langId, setLangId] = useState<number>(() => {
    try { const v = localStorage.getItem("cfapp:langId"); return v ? Number(v) : 89; } catch { return 89; }
  });
  const [saveLabel, setSaveLabel] = useState("draft");
  const [result, setResult] = useState<{ kind: "ok" | "err" | "busy"; text: string } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftUrl = `/api/draft/${contest.id}/${problem.index}`;

  const articleRef = useRef<HTMLDivElement | null>(null);
  const baseHtmlRef = useRef<string>("");          // pristine concatenated HTML for re-render
  const [ranges, setRanges] = useState<HLRange[]>([]);
  const [trEntries, setTrEntries] = useState<TrEntry[]>([]);
  const trEntriesRef = useRef<TrEntry[]>([]);
  trEntriesRef.current = trEntries;
  const [pop, setPop] = useState<{ x: number; y: number; text: string; tr: string | null; html: string | null; err: string | null } | null>(null);

  // load draft
  useEffect(() => {
    fetch(draftUrl).then(r => r.json()).then(j => setCode(j.code ?? "")).catch(() => {});
  }, [draftUrl]);

  // autosave draft
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetch(draftUrl, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) })
        .then(() => setSaveLabel(`saved ${new Date().toLocaleTimeString()}`))
        .catch(() => setSaveLabel("save failed"));
    }, 500);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [code, draftUrl]);

  // load saved ranges + translations when statement arrives
  useEffect(() => {
    if (!data) return;
    const baseHash = String(data.statementHtml.length + data.inputHtml.length + data.outputHtml.length);
    try {
      const saved = localStorage.getItem(lsKey(contest.id, problem.index, "hl"));
      if (saved) {
        const parsed = JSON.parse(saved) as { hash: string; ranges: HLRange[] };
        if (parsed.hash === baseHash) {
          setRanges(parsed.ranges);
        } else setRanges([]);
      } else setRanges([]);
    } catch { setRanges([]); }
    try {
      const savedTr = localStorage.getItem(lsKey(contest.id, problem.index, "tr"));
      if (savedTr) {
        const parsed = JSON.parse(savedTr) as { hash: string; entries: TrEntry[] };
        if (parsed.hash === baseHash) {
          setTrEntries(parsed.entries);
          return;
        }
      }
    } catch {}
    setTrEntries([]);
  }, [data, contest.id, problem.index]);

  // re-paint highlights + translations whenever state or article HTML change
  useEffect(() => {
    if (!articleRef.current || !data) return;
    const html =
      data.statementHtml +
      (data.inputHtml  ? `<div class="section">Input</div>${data.inputHtml}` : "") +
      (data.outputHtml ? `<div class="section">Output</div>${data.outputHtml}` : "") +
      (data.noteHtml   ? `<div class="section">Note</div>${data.noteHtml}` : "");
    baseHtmlRef.current = html;
    articleRef.current.innerHTML = html;
    applyRangesToDOM(articleRef.current, ranges);
    // Replay saved translations: insert each block after the block-level
    // ancestor that contains the source selection's end offset.
    for (const entry of trEntries) {
      const anchor = blockAtOffset(articleRef.current, entry.end);
      const block = buildTrBlock(entry, () => removeTrEntry(entry));
      if (anchor && anchor.parentNode) {
        anchor.parentNode.insertBefore(block, anchor.nextSibling);
      } else {
        articleRef.current.appendChild(block);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, ranges, trEntries]);

  const persistRanges = useCallback((next: HLRange[]) => {
    if (!data) return;
    const baseHash = String(data.statementHtml.length + data.inputHtml.length + data.outputHtml.length);
    try {
      localStorage.setItem(lsKey(contest.id, problem.index, "hl"),
        JSON.stringify({ hash: baseHash, ranges: next }));
    } catch {}
  }, [data, contest.id, problem.index]);

  const persistTrEntries = useCallback((next: TrEntry[]) => {
    if (!data) return;
    const baseHash = String(data.statementHtml.length + data.inputHtml.length + data.outputHtml.length);
    try {
      localStorage.setItem(lsKey(contest.id, problem.index, "tr"),
        JSON.stringify({ hash: baseHash, entries: next }));
    } catch {}
  }, [data, contest.id, problem.index]);

  const removeTrEntry = useCallback((entry: TrEntry) => {
    const next = trEntriesRef.current.filter(
      (e) => !(e.start === entry.start && e.end === entry.end && e.src === entry.src),
    );
    setTrEntries(next);
    persistTrEntries(next);
  }, [persistTrEntries]);

  const captureSelectionOffsets = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !articleRef.current) return null;
    const range = sel.getRangeAt(0);
    if (!articleRef.current.contains(range.commonAncestorContainer)) return null;
    // Check if the selection is inside a .cf-tr translation block.
    const trBlock = findTrAncestor(range.commonAncestorContainer, articleRef.current);
    if (trBlock) {
      const bodySpan = trBlock.querySelector(".cf-tr-body > .cf-tr-content") as HTMLElement | null;
      if (bodySpan) {
        const off = rangeToOffsets(bodySpan as HTMLElement, range, bodySpan as HTMLElement);
        if (off) return { kind: "tr" as const, ...off, trBlock, bodySpan: bodySpan as HTMLElement };
      }
      return null;
    }
    const off = rangeToOffsets(articleRef.current, range);
    if (!off) return null;
    return { kind: "article" as const, ...off };
  };

  const onHighlight = (color: HLColor) => {
    const off = captureSelectionOffsets();
    if (!off) return;
    if (off.kind === "tr") {
      // Find the index of the selected .cf-tr block among all .cf-tr blocks.
      const allTrBlocks = articleRef.current!.querySelectorAll(".cf-tr");
      const matchIdx = Array.from(allTrBlocks).indexOf(off.trBlock);
      if (matchIdx < 0 || matchIdx >= trEntriesRef.current.length) return;
      const entry = trEntriesRef.current[matchIdx]!;
      const prev = entry.hlRanges ?? [];
      const nextRanges = mergeAddRange(prev, { start: off.start, end: off.end, color });
      const next = [...trEntriesRef.current];
      next[matchIdx] = { start: entry.start, end: entry.end, src: entry.src, html: entry.html, hlRanges: nextRanges };
      setTrEntries(next);
      persistTrEntries(next);
    } else {
      const next = mergeAddRange(ranges, { start: off.start, end: off.end, color });
      setRanges(next);
      persistRanges(next);
    }
  };
  const onClear = () => {
    const off = captureSelectionOffsets();
    if (!off) return;
    if (off.kind === "tr") {
      const allTrBlocks = articleRef.current!.querySelectorAll(".cf-tr");
      const matchIdx = Array.from(allTrBlocks).indexOf(off.trBlock);
      if (matchIdx < 0 || matchIdx >= trEntriesRef.current.length) return;
      const entry = trEntriesRef.current[matchIdx]!;
      const prev = entry.hlRanges ?? [];
      const nextRanges = mergeClearRange(prev, { start: off.start, end: off.end });
      const next = [...trEntriesRef.current];
      next[matchIdx] = { start: entry.start, end: entry.end, src: entry.src, html: entry.html, hlRanges: nextRanges };
      setTrEntries(next);
      persistTrEntries(next);
    } else {
      const next = mergeClearRange(ranges, { start: off.start, end: off.end });
      setRanges(next);
      persistRanges(next);
    }
  };

  const onTranslatePop = async () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !articleRef.current) return;
    const range = sel.getRangeAt(0);
    if (!articleRef.current.contains(range.commonAncestorContainer)) return;
    // Use TeX-aware extraction so $...$ markers survive into the AI prompt.
    // Falls back to plain text if there's no math in the selection.
    const text = rangeToTexSource(articleRef.current, range) || range.toString().trim();
    if (!text) return;
    const rect = range.getBoundingClientRect();
    setPop({ x: rect.left, y: rect.bottom + 6, text, tr: null, html: null, err: null });
    try {
      const r = await fetch("/api/translate", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const j = await r.json();
      if (j.error) setPop(p => p && { ...p, err: j.error });
      else setPop(p => p && { ...p, tr: j.translation, html: j.html ?? null });
    } catch (e: any) {
      setPop(p => p && { ...p, err: e.message });
    }
  };

  const onTranslateInline = async () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !articleRef.current) return;
    const range = sel.getRangeAt(0);
    if (!articleRef.current.contains(range.commonAncestorContainer)) return;
    const text = rangeToTexSource(articleRef.current, range) || range.toString().trim();
    if (!text) return;
    // Capture article-space offsets up front so we can persist + replay.
    const offsets = rangeToOffsets(articleRef.current, range);
    if (!offsets) return;
    // Show a transient loading block immediately. Once the translation
    // returns, save it as a TrEntry and let the replay effect re-render
    // (this also dedupes against the loading block which we remove first).
    let anchor: Node | null = range.endContainer;
    while (anchor && anchor !== articleRef.current && (anchor.nodeType !== 1 ||
      !["P", "DIV", "LI"].includes((anchor as HTMLElement).tagName))) {
      anchor = anchor.parentNode;
    }
    const loading = document.createElement("div");
    loading.className = "cf-tr cf-tr-loading";
    loading.innerHTML = `<span class="cf-tr-label">译</span><span class="cf-tr-body">翻译中…</span>`;
    if (anchor && anchor !== articleRef.current && anchor.parentNode) {
      anchor.parentNode.insertBefore(loading, (anchor as ChildNode).nextSibling);
    } else {
      range.collapse(false);
      range.insertNode(loading);
    }
    try {
      const r = await fetch("/api/translate", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const j = await r.json();
      loading.remove();
      if (j.error) {
        const errBlock = document.createElement("div");
        errBlock.className = "cf-tr cf-tr-loading";
        errBlock.innerHTML = `<span class="cf-tr-label">译</span><span class="cf-tr-body">翻译失败: ${j.error}</span>`;
        if (anchor && anchor !== articleRef.current && anchor.parentNode) {
          anchor.parentNode.insertBefore(errBlock, (anchor as ChildNode).nextSibling);
        }
        setTimeout(() => errBlock.remove(), 4000);
        return;
      }
      const entry: TrEntry = {
        start: offsets.start,
        end: offsets.end,
        src: text,
        html: j.html ?? escapePlain(j.translation ?? ""),
      };
      const next = [...trEntriesRef.current, entry];
      setTrEntries(next);
      persistTrEntries(next);
    } catch {
      loading.remove();
    }
  };

  const onSubmit = () => {
    if (!code.trim()) { setResult({ kind: "err", text: "Code is empty." }); return; }
    // Also keep the code on the clipboard as a manual fallback in case the
    // injected paste doesn't take (e.g. CF's editor swapped to ACE/CM mid-flight).
    try { navigator.clipboard?.writeText(code); } catch {}
    try {
      const ta = document.createElement("textarea");
      ta.value = code;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    } catch {}
    setResult({
      kind: "ok",
      text: "Switched to Submit tab — code auto-pasted into CF's editor (also on clipboard as a fallback).",
    });
    onOpenSubmitTab(
      `https://codeforces.com/contest/${contest.id}/submit?submittedProblemIndex=${problem.index}`,
      code,
      problem.index,
      langId,
    );
  };

  if (loading) return <div className="container"><div className="loading">Loading statement…</div></div>;
  if (err) return <div className="container"><div className="loading">Failed: {err}</div></div>;
  if (!data) return null;

  const langKey = PRISM_LANG_BY_CF_ID[langId] ?? "cpp";

  return (
    <div className="container">
      <div className="card">
        <h1 className="problem-title">{data.title || `${problem.index}. ${problem.name}`}</h1>
        <div className="problem-limits">
          <span><b>Time limit:</b>{data.timeLimit || "—"}</span>
          <span><b>Memory limit:</b>{data.memoryLimit || "—"}</span>
          {problem.rating ? <span><b>Rating:</b>{problem.rating}</span> : null}
        </div>

        <div ref={articleRef} className="problem-article statement" />

        {data.samples.length > 0 && <>
          <div className="section">Sample</div>
          <div className="samples">
            {data.samples.map((s, i) => (
              <div className="sample" key={i}>
                <div className="sample-block">
                  <div className="label"><span>Sample Input {i + 1}</span><CopyButton text={s.input} /></div>
                  <pre>{s.input}</pre>
                </div>
                <div className="sample-block">
                  <div className="label"><span>Sample Output {i + 1}</span><CopyButton text={s.output} /></div>
                  <pre>{s.output}</pre>
                </div>
              </div>
            ))}
          </div>
        </>}

        <div className="section">Submit</div>
        <div className="editor-bar">
          <select value={langId} onChange={e => { const v = Number(e.target.value); setLangId(v); try { localStorage.setItem("cfapp:langId", String(v)); } catch {} }}>
            {(langs ?? []).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <button className="primary" onClick={onSubmit}>Submit</button>
          <span className="save-status">{saveLabel}</span>
        </div>
        <CodeEditor value={code} onChange={setCode} langKey={langKey} />
        {result && <div className={`submit-result ${result.kind}`}>{result.text}</div>}
      </div>

      <SelectionToolbar
        scopeRef={articleRef}
        onHighlight={onHighlight}
        onClear={onClear}
        onTranslatePop={onTranslatePop}
        onTranslateInline={onTranslateInline}
      />
      {pop && <TrPopover x={pop.x} y={pop.y} text={pop.text} translation={pop.tr} html={pop.html} error={pop.err} onClose={() => setPop(null)} />}
    </div>
  );
}
