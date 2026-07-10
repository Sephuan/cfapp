import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Contest, Problem } from "../../api";
import { useFetchJSON, type LocalStorageCache } from "../hooks";
import { CodeEditor, PRISM_LANG_BY_CF_ID } from "../CodeEditor";
import {
  type HLColor, type HLRange, type TrEntry,
  applyRangesToDOM, blockAtOffset, buildTrBlock, escapePlain,
  findTrAncestor, lsKey, mergeAddRange, mergeClearRange,
  rangeToOffsets, rangeToTexSource,
} from "../highlight";
import { useLang, getLang, t } from "../i18n";

type Statement = {
  title: string; timeLimit: string; memoryLimit: string;
  statementHtml: string; inputHtml: string; outputHtml: string;
  samples: { input: string; output: string }[]; noteHtml: string;
};
type Lang = { name: string; id: number };

// One translation call that transparently handles both server modes:
//   • streaming  → text/event-stream, onUpdate fires per frame (incremental HTML)
//   • buffered   → application/json, onUpdate fires once with the final HTML
// Resolves to the final { translation, html }, or throws on error. `onUpdate`
// lets the caller paint partial output live; the resolved value is what gets
// persisted.
type TrResult = { translation: string; html: string };
async function requestTranslate(
  text: string,
  onUpdate: (partial: TrResult) => void,
): Promise<TrResult> {
  // cache: "no-store" + a per-request nonce: Electron's Chromium keeps a disk
  // HTTP cache and is known to serve a stale/heuristic-fresh entry for a
  // repeated POST to the same URL, which hands the renderer a dead response
  // it then waits on forever ("translation stuck on busy"). The nonce makes
  // every request a distinct cache key; no-store forbids storing at all.
  const r = await fetch(`/api/translate?_=${Date.now()}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
    cache: "no-store",
  });
  const ctype = r.headers.get("content-type") || "";
  if (!ctype.includes("text/event-stream")) {
    const j = await r.json();
    if (j.error) throw new Error(j.error);
    const res = { translation: j.translation ?? "", html: j.html ?? escapePlain(j.translation ?? "") };
    onUpdate(res);
    return res;
  }
  // SSE: parse `data: {…}\n\n` frames as they arrive.
  const reader = r.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let last: TrResult = { translation: "", html: "" };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const frames = buf.split("\n\n");
    buf = frames.pop() ?? "";
    for (const frame of frames) {
      const line = frame.split("\n").find(l => l.startsWith("data:"));
      if (!line) continue;
      let obj: any;
      try { obj = JSON.parse(line.slice(5).trim()); } catch { continue; }
      if (obj.error) throw new Error(obj.error);
      last = { translation: obj.translation ?? last.translation, html: obj.html ?? last.html };
      onUpdate(last);
    }
  }
  return last;
}


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
  const [lang] = useLang();
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
        : !props.translation
          ? <div className="tr-busy">{t(lang, "tr.busy")}</div>
          : props.html
            ? <div className="tr-body" dangerouslySetInnerHTML={{ __html: props.html }} />
            : <div className="tr-body" style={{ whiteSpace: "pre-wrap" }}>{props.translation}</div>}
    </div>
  );
}

// ----- problem page -----
// Persist each problem's statement (URL-keyed per contest/problem) so a
// revisited problem opens instantly and stays readable offline; refreshes in
// the background.
const STATEMENT_CACHE: LocalStorageCache = { keyPrefix: "cfapp_statement_" };

export function ProblemPage({ contest, problem, onOpenSubmitTab, refreshTick }: { contest: Contest; problem: Problem; onOpenSubmitTab: (url: string, code: string, problemIndex: string, langId?: number) => void; refreshTick: number }) {
  const { data, err, loading } = useFetchJSON<Statement>(`/api/contests/${contest.id}/problem/${problem.index}`, refreshTick, STATEMENT_CACHE);
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
    // Drop in-flight (pending) entries: a half-finished translation has no
    // value after a reload, and persisting one would re-insert a "busy" block
    // that never resolves.
    const stable = next.filter((e) => !e.pending);
    try {
      localStorage.setItem(lsKey(contest.id, problem.index, "tr"),
        JSON.stringify({ hash: baseHash, entries: stable }));
    } catch {}
  }, [data, contest.id, problem.index]);

  const removeTrEntry = useCallback((entry: TrEntry) => {
    // Match by stable id when present (a pending or finalized entry carries
    // one); fall back to the offset+src triple for legacy persisted entries
    // that predate the id field.
    const next = trEntriesRef.current.filter(
      (e) => entry.id ? e.id !== entry.id : !(e.start === entry.start && e.end === entry.end && e.src === entry.src),
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
      const res = await requestTranslate(text, (partial) => {
        // Streaming: flip out of the busy state and paint the growing HTML.
        setPop(p => p && { ...p, tr: partial.translation, html: partial.html });
      });
      setPop(p => p && { ...p, tr: res.translation, html: res.html });
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
    // Render the translation as a *pending* TrEntry that the repaint effect
    // owns — just like every finished translation. This is the fix for
    // "translation vanishes mid-stream then reappears": the old code inserted a
    // free-floating DOM node that the repaint effect's `innerHTML = html` reset
    // wiped whenever ranges/trEntries changed. Now the in-flight block lives in
    // state, survives the repaint, and is updated in place as tokens arrive.
    const id = `tr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const busyHtml = `<span class="cf-tr-busy">${t(getLang(), "tr.busy")}</span>`;
    setTrEntries((prev) => [...prev, { id, start: offsets.start, end: offsets.end, src: text, html: busyHtml, pending: true }]);
    try {
      const res = await requestTranslate(text, (partial) => {
        if (partial.html) {
          setTrEntries((prev) => prev.map((e) => (e.id === id ? { ...e, html: partial.html } : e)));
        }
      });
      // Compute the committed array once so persist sees the same entries the
      // state will hold (reading trEntriesRef here would race — it only updates
      // after the setState-triggered re-render).
      setTrEntries((prev) => {
        const next = prev.map((e) => (e.id === id
          ? { id, start: offsets.start, end: offsets.end, src: text, html: res.html || escapePlain(res.translation ?? "") }
          : e));
        persistTrEntries(next.filter((e) => !e.pending));
        return next;
      });
    } catch (e: any) {
      const msg = (e?.message ?? "").replace(/[&<>"]/g, (c: string) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
      const errHtml = `${t(getLang(), "tr.failed")}: ${msg}`;
      setTrEntries((prev) => prev.map((entry) => (entry.id === id ? { ...entry, html: errHtml, pending: true } : entry)));
      setTimeout(() => {
        setTrEntries((prev) => prev.filter((entry) => entry.id !== id));
      }, 4000);
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
