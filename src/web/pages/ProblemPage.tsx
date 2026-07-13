import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Contest, Problem } from "../../api";
import { useFetchJSON, type LocalStorageCache } from "../hooks";
import type { AppConfig } from "../shared";
import { CodeEditor, PRISM_LANG_BY_CF_ID } from "../CodeEditor";
import {
  type HLColor, type HLRange, type TrEntry,
  applyRangesToDOM, blockAtOffset, buildTrBlock, escapePlain,
  findTrAncestor, lsKey, mergeAddRange, mergeClearRange,
  rangeToOffsets, rangeToTexSource,
} from "../highlight";
import { useLang, getLang, t } from "../i18n";
import {
  type SegUnit, type SegMode, type RateLimiter,
  segmentStatement, buildArticleHtml, segmentOffsets, createRateLimiter,
} from "../auto-translate";
import { requestTranslate } from "./problem/request-translate";
import { CopyButton } from "./problem/CopyButton";
import { SelectionToolbar } from "./problem/SelectionToolbar";
import { TrPopover } from "./problem/TrPopover";

type Statement = {
  title: string; timeLimit: string; memoryLimit: string;
  statementHtml: string; inputHtml: string; outputHtml: string;
  samples: { input: string; output: string }[]; noteHtml: string;
};
type Lang = { name: string; id: number };

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
  const [lang] = useLang();

  const articleRef = useRef<HTMLDivElement | null>(null);
  const baseHtmlRef = useRef<string>("");          // pristine concatenated HTML for re-render
  const [ranges, setRanges] = useState<HLRange[]>([]);
  const [trEntries, setTrEntries] = useState<TrEntry[]>([]);
  const trEntriesRef = useRef<TrEntry[]>([]);
  trEntriesRef.current = trEntries;
  const [pop, setPop] = useState<{ x: number; y: number; text: string; tr: string | null; html: string | null; err: string | null } | null>(null);

  // ----- auto-translate config (read-only) -----
  // Auto-translate reuses the manual trEntries mechanism: each segment becomes
  // a normal TrEntry (× to dismiss, highlightable, persisted in cfapp:tr).
  // There is NO separate autoTr state — the only auto-specific bookkeeping is
  // the rate limiter (requestIntervalMs + concurrency + rpm budget) and the
  // epoch guard (stale-run protection on problem switch). autoMode is the
  // single switch: "off" leaves the page exactly as before (manual only).
  const { data: aiCfgData } = useFetchJSON<AppConfig>("/api/config");
  const aiCfg = aiCfgData?.ai;
  const autoMode = aiCfg?.autoMode ?? "off";
  const rateLimiterRef = useRef<RateLimiter | null>(null);
  // Forward-reference holder for fillAutoGaps so removeTrEntry (defined earlier)
  // can trigger a soft refill after deleting an auto entry without a TDZ
  // violation. Soft refill must NOT cancel in-flight work.
  const fillAutoGapsRef = useRef<((units: SegUnit[]) => void) | null>(null);
  // Epoch guards against a stale run writing state after the user switched
  // problems: every hard cancel bumps it, and callbacks capture the epoch they
  // were spawned under and bail if it no longer matches.
  const epochRef = useRef(0);
  // True only after localStorage tr/hl for the current problem has been applied.
  // onopen must wait for this — otherwise it races a stale trEntriesRef and
  // either re-translates a cache hit or skips a cold problem.
  const [trHydrated, setTrHydrated] = useState(false);
  // Problem key we already hydrated. Background statement re-fetch (show-then-
  // refresh) must NOT re-run hydrate: that wiped in-flight pending auto entries
  // and re-queued the same segments → duplicate requests + wasted time.
  const hydratedProblemKeyRef = useRef<string>("");

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

  // On problem switch: drop hydrate flag immediately so onopen cannot fire
  // against the previous problem's entries while the new statement loads.
  useEffect(() => {
    setTrHydrated(false);
    hydratedProblemKeyRef.current = "";
  }, [contest.id, problem.index]);

  // Load saved ranges + translations once per problem when statement first
  // arrives. Do NOT re-hydrate on every `data` identity change — useFetchJSON
  // background refresh replaces `data` with a new object for the same problem,
  // and re-running this used to clobber live pending auto-translate cards.
  useEffect(() => {
    if (!data) return;
    const problemKey = `${contest.id}:${problem.index}`;
    if (hydratedProblemKeyRef.current === problemKey) return;
    hydratedProblemKeyRef.current = problemKey;

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
    let loaded: TrEntry[] = [];
    try {
      const savedTr = localStorage.getItem(lsKey(contest.id, problem.index, "tr"));
      if (savedTr) {
        const parsed = JSON.parse(savedTr) as { hash: string; entries: TrEntry[] };
        if (parsed.hash === baseHash) {
          loaded = parsed.entries;
        }
      }
    } catch {}
    setTrEntries(loaded);
    // Sync ref in the same tick so a subsequent onopen effect in this commit
    // (or the next) sees the hydrated entries, not the previous problem's.
    trEntriesRef.current = loaded;
    setTrHydrated(true);
  }, [data, contest.id, problem.index]);

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
    // Drop in-flight (pending) AND failed (error) entries: a half-finished or
    // failed translation has no value after a reload. Persisting one would
    // re-insert a "busy"/error block that never resolves.
    const stable = next.filter((e) => !e.pending && !e.error);
    try {
      localStorage.setItem(lsKey(contest.id, problem.index, "tr"),
        JSON.stringify({ hash: baseHash, entries: stable }));
    } catch {}
  }, [data, contest.id, problem.index]);

  const removeTrEntry = useCallback((entry: TrEntry) => {
    const isAuto = !!entry.auto;
    // Match by stable id when present (a pending or finalized entry carries
    // one); fall back to the offset+src triple for legacy persisted entries
    // that predate the id field.
    const next = trEntriesRef.current.filter(
      (e) => entry.id ? e.id !== entry.id : !(e.start === entry.start && e.end === entry.end && e.src === entry.src),
    );
    trEntriesRef.current = next;
    setTrEntries(next);
    persistTrEntries(next);
    // Soft refill: schedule only the uncovered gap. Must NOT cancel in-flight
    // work for other segments (hard cancel would leave them pending forever).
    if (isAuto && aiCfg?.autoTrigger === "onopen") {
      setTimeout(() => {
        if (autoMode === "off" || !data) return;
        fillAutoGapsRef.current?.(segmentStatement(data, autoMode as SegMode));
      }, 50);
    }
  }, [persistTrEntries, aiCfg?.autoTrigger, autoMode, data]);

  // ----- auto-translate: produces ordinary TrEntries, no parallel system -----
  //
  // Each translated segment becomes a normal TrEntry (auto:true) — same × to
  // dismiss, highlightable, persisted in cfapp:tr, replayed by the repaint
  // effect below. The only auto-specific machinery is the rate limiter and an
  // epoch guard so a problem-switch mid-run can't write stale state.

  // Hard cancel: stop the limiter, advance the epoch so in-flight callbacks
  // no-op, and drop pending auto entries that can no longer complete.
  // Pending entries are never written to localStorage, so no persist here
  // (avoids writing the wrong problem key on unmount / problem switch).
  const cancelAutoTr = useCallback(() => {
    rateLimiterRef.current?.cancel();
    rateLimiterRef.current = null;
    epochRef.current++;
    const cleaned = trEntriesRef.current.filter((e) => !(e.auto && e.pending));
    if (cleaned.length !== trEntriesRef.current.length) {
      trEntriesRef.current = cleaned;
      setTrEntries(cleaned);
    }
  }, []);

  // Ensure a live limiter at the current epoch. Reuses an existing limiter so
  // soft-fill / single-retry paths can piggyback without cancelling siblings.
  //
  // Two separate knobs (both applied by createRateLimiter):
  //   • requestIntervalMs — gap between successive *starts* (smooth stream)
  //   • rpm — max total starts in a rolling 60s window (budget / anti-429)
  // Never convert rpm into the only interval (60000/rpm alone → 12s dead pauses).
  const ensureLimiter = useCallback((myEpoch: number): RateLimiter | null => {
    if (epochRef.current !== myEpoch) return null;
    if (rateLimiterRef.current) return rateLimiterRef.current;
    const intervalMs = Math.max(0, aiCfg?.requestIntervalMs ?? 200);
    const lim = createRateLimiter(
      intervalMs,
      aiCfg?.concurrency ?? 2,
      aiCfg?.rpm ?? 0,
    );
    rateLimiterRef.current = lim;
    return lim;
  }, [aiCfg]);

  // Schedule requestTranslate for one auto entry id; updates state on partial /
  // success / error as soon as that segment responds (not blocked by others).
  // Start order is still FIFO via the rate limiter; DOM placement sorts by end
  // offset. Ignores "cancelled" rejections from the queue.
  const scheduleAutoRequest = useCallback((
    myEpoch: number,
    lim: RateLimiter,
    entry: { id: string; src: string; start: number; end: number },
  ) => {
    void lim.run(() => requestTranslate(entry.src, (partial) => {
      if (epochRef.current !== myEpoch) return;
      if (partial.html) {
        setTrEntries((prev) => prev.map((e) => (e.id === entry.id ? { ...e, html: partial.html } : e)));
      }
    })).then(
      (res) => {
        if (epochRef.current !== myEpoch) return;
        setTrEntries((prev) => {
          const next = prev.map((e) => (e.id === entry.id
            ? {
                id: entry.id,
                start: entry.start,
                end: entry.end,
                src: entry.src,
                html: res.html || escapePlain(res.translation ?? ""),
                auto: true,
                pending: false,
                hlRanges: e.hlRanges,
              }
            : e));
          trEntriesRef.current = next;
          persistTrEntries(next);
          return next;
        });
      },
      (e: any) => {
        if (epochRef.current !== myEpoch) return;
        const msg = String(e?.message ?? e);
        if (msg === "cancelled") return;
        setTrEntries((prev) => {
          const next = prev.map((en) => (en.id === entry.id
            ? {
                id: entry.id,
                start: entry.start,
                end: entry.end,
                src: entry.src,
                html: "",
                auto: true,
                pending: false,
                error: msg,
                hlRanges: en.hlRanges,
              }
            : en));
          trEntriesRef.current = next;
          return next;
        });
      },
    );
  }, [persistTrEntries]);

  // Soft fill: queue uncovered segments without cancelling in-flight work.
  // Used by onopen (after hydrate), delete-refill, and the manual button when
  // a run is already live. Hard path (no live limiter / first start) creates
  // a fresh limiter under a new or existing epoch.
  const fillAutoGaps = useCallback((units: SegUnit[]) => {
    if (!data || units.length === 0 || autoMode === "off") return;
    const segMode = autoMode === "section" || autoMode === "paragraph";
    const articleHtml = buildArticleHtml(data, units, segMode);
    const offsets = segmentOffsets(articleHtml, units, autoMode as SegMode);

    // Match offsets by segment id (walker order ≠ units index if an anchor is missing).
    const offsetById = new Map(offsets.map((o) => [o.id, o]));
    // Dedup: skip units whose [start,end) overlaps any non-error entry
    // (finalized or still pending). Error entries leave a gap to fill.
    const existing = trEntriesRef.current.filter((e) => !e.error);
    const todo = units.filter((u) => {
      const o = offsetById.get(u.id);
      if (!o) return false;
      return !existing.some((e) => e.end > o.start && e.start < o.end);
    });
    if (todo.length === 0) return;

    // Document order: sort by article offset end ascending so the queue is
    // statement → input → output → note (top to bottom) even after dedup skips
    // some segments. Limiter is FIFO, so *dispatch* order matches this order.
    // Completion order is still network-bound; block *placement* uses offsets.
    const todoOrdered = [...todo].sort((a, b) =>
      (offsetById.get(a.id)?.end ?? 0) - (offsetById.get(b.id)?.end ?? 0),
    );
    const busyHtml = `<span class="cf-tr-busy">${t(getLang(), "tr.busy")}</span>`;
    const pendingEntries: TrEntry[] = todoOrdered.map((u) => {
      const o = offsetById.get(u.id)!;
      return { id: u.id, start: o.start, end: o.end, src: u.text, html: busyHtml, pending: true, auto: true };
    });

    // Sync ref before setState so a second fill in the same tick dedups correctly.
    const next = [...trEntriesRef.current, ...pendingEntries];
    trEntriesRef.current = next;
    setTrEntries(next);

    const myEpoch = epochRef.current;
    const lim = ensureLimiter(myEpoch);
    if (!lim) return;
    // Enqueue in todoOrdered order (FIFO → top-to-bottom starts).
    for (const pe of pendingEntries) {
      scheduleAutoRequest(myEpoch, lim, { id: pe.id!, src: pe.src, start: pe.start, end: pe.end });
    }
  }, [autoMode, data, ensureLimiter, scheduleAutoRequest]);
  fillAutoGapsRef.current = fillAutoGaps;

  // Hard start / restart: cancel any prior run (and strip its pending entries),
  // then soft-fill uncovered segments under a fresh epoch + limiter.
  const runAutoTranslate = useCallback((units: SegUnit[]) => {
    if (!data || units.length === 0) return;
    cancelAutoTr();
    // cancelAutoTr already bumped epoch; keep that epoch for the new run.
    fillAutoGaps(units);
  }, [cancelAutoTr, data, fillAutoGaps]);

  // Retry one or more failed auto entries under a single limiter/epoch.
  // Does not cancel unrelated in-flight successes — only flips the failed
  // targets back to pending and schedules them (document order by end offset).
  const retryEntries = useCallback((entries: TrEntry[]) => {
    const targets = entries
      .filter((e) => e.auto && e.error && e.id)
      .sort((a, b) => a.end - b.end);
    if (targets.length === 0) return;
    const busyHtml = `<span class="cf-tr-busy">${t(getLang(), "tr.busy")}</span>`;
    const ids = new Set(targets.map((e) => e.id!));
    setTrEntries((prev) => {
      const next = prev.map((e) => (e.id && ids.has(e.id)
        ? { ...e, pending: true, error: undefined, html: busyHtml }
        : e));
      trEntriesRef.current = next;
      return next;
    });
    const myEpoch = epochRef.current;
    const lim = ensureLimiter(myEpoch);
    if (!lim) return;
    for (const entry of targets) {
      scheduleAutoRequest(myEpoch, lim, {
        id: entry.id!,
        src: entry.src,
        start: entry.start,
        end: entry.end,
      });
    }
  }, [ensureLimiter, scheduleAutoRequest]);

  const retryEntry = useCallback((entry: TrEntry) => {
    retryEntries([entry]);
  }, [retryEntries]);

  const retryAllFailed = useCallback(() => {
    retryEntries(trEntriesRef.current.filter((e) => e.auto && e.error));
  }, [retryEntries]);

  // Clear (remove) all auto-generated entries and cancel any in-flight auto run.
  const clearAutoTranslations = useCallback(() => {
    cancelAutoTr();
    setTrEntries((prev) => {
      const next = prev.filter((e) => !e.auto);
      trEntriesRef.current = next;
      persistTrEntries(next);
      return next;
    });
  }, [cancelAutoTr, persistTrEntries]);

  // Manual trigger from the header button.
  const onAutoTrButton = useCallback(() => {
    if (!data || autoMode === "off") return;
    const units = segmentStatement(data, autoMode as SegMode);
    if (units.length === 0) return;
    // Prefer soft-fill when a run is already live (button is usually disabled
    // while running, but keep the safe path).
    if (rateLimiterRef.current) fillAutoGaps(units);
    else runAutoTranslate(units);
  }, [data, autoMode, fillAutoGaps, runAutoTranslate]);

  // Cancel on unmount / problem switch.
  useEffect(() => () => { cancelAutoTr(); }, [cancelAutoTr, contest.id, problem.index]);

  // Repaint: rebuild the article DOM whenever the statement, highlights, or
  // translation entries change. In a segmented auto-mode we thread zero-width
  // <span class="autotr-anchor"> markers after each segment so the segment
  // offsets computed by runAutoTranslate align with the live DOM. Manual and
  // auto entries alike are replayed as .cf-tr blocks via buildTrBlock (error
  // entries get a retry button). The markers carry no text, so isCountable
  // skips them and the offset engine is unaffected.
  const segMode = autoMode === "section" || autoMode === "paragraph";
  useEffect(() => {
    if (!articleRef.current || !data) return;
    // Always segment in seg modes so the anchor markers land in the DOM even
    // before any auto-run (markers are inert until an entry is created).
    const units = segMode ? segmentStatement(data, autoMode as SegMode) : [];
    const html = buildArticleHtml(data, units, segMode);
    baseHtmlRef.current = html;
    articleRef.current.innerHTML = html;
    applyRangesToDOM(articleRef.current, ranges);
    // Insert in ascending `end` offset order so multiple blocks sharing one
    // paragraph (or falling back to article append) land top-to-bottom rather
    // than in completion/creation order, which would read as "random".
    const ordered = [...trEntries].sort((a, b) => a.end - b.end);
    const retryLabel = t(getLang(), "prob.autoRetryOne");
    const collapseFull = !!(aiCfg?.autoCollapse && autoMode === "full");
    for (const entry of ordered) {
      const anchor = blockAtOffset(articleRef.current, entry.end);
      const blockOpts = {
        retryLabel,
        collapsed: collapseFull && !!entry.auto && !entry.pending && !entry.error,
        expandLabel: t(getLang(), "prob.autoCollapse.expand"),
        collapseLabel: t(getLang(), "prob.autoCollapse"),
      };
      const block = entry.error
        ? buildTrBlock(entry, () => removeTrEntry(entry), () => retryEntry(entry), blockOpts)
        : buildTrBlock(entry, () => removeTrEntry(entry), undefined, blockOpts);
      if (anchor && anchor.parentNode) {
        anchor.parentNode.insertBefore(block, anchor.nextSibling);
      } else {
        articleRef.current.appendChild(block);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, ranges, trEntries, autoMode, aiCfg?.autoCollapse]);

  // onopen trigger: wait until tr entries for this problem are hydrated from
  // localStorage, then soft-fill any uncovered segments. Soft-fill is
  // idempotent (dedups against existing/pending). Depend on problem identity
  // + mode/trigger, not on `data` object identity — background statement
  // refresh must not re-kick the whole queue.
  useEffect(() => {
    if (!trHydrated || !data || autoMode === "off") return;
    if (aiCfg?.autoTrigger !== "onopen") return;
    const units = segmentStatement(data, autoMode as SegMode);
    if (units.length === 0) return;
    fillAutoGaps(units);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trHydrated, contest.id, problem.index, autoMode, aiCfg?.autoTrigger]);

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

  // Resolve a .cf-tr DOM node to its TrEntry index. Prefer data-tr-id; fall
  // back to start/end offsets. Never use querySelectorAll index — DOM order
  // is sorted by `end`, state order is creation order.
  const findTrEntryIndex = (trBlock: HTMLElement): number => {
    const id = trBlock.dataset.trId;
    if (id) {
      const byId = trEntriesRef.current.findIndex((e) => e.id === id);
      if (byId >= 0) return byId;
    }
    const start = Number(trBlock.dataset.trStart);
    const end = Number(trBlock.dataset.trEnd);
    if (Number.isFinite(start) && Number.isFinite(end)) {
      return trEntriesRef.current.findIndex((e) => e.start === start && e.end === end);
    }
    return -1;
  };

  const onHighlight = (color: HLColor) => {
    const off = captureSelectionOffsets();
    if (!off) return;
    if (off.kind === "tr") {
      const matchIdx = findTrEntryIndex(off.trBlock);
      if (matchIdx < 0) return;
      const entry = trEntriesRef.current[matchIdx]!;
      const prev = entry.hlRanges ?? [];
      const nextRanges = mergeAddRange(prev, { start: off.start, end: off.end, color });
      const next = [...trEntriesRef.current];
      next[matchIdx] = { ...entry, hlRanges: nextRanges };
      trEntriesRef.current = next;
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
      const matchIdx = findTrEntryIndex(off.trBlock);
      if (matchIdx < 0) return;
      const entry = trEntriesRef.current[matchIdx]!;
      const prev = entry.hlRanges ?? [];
      const nextRanges = mergeClearRange(prev, { start: off.start, end: off.end });
      const next = [...trEntriesRef.current];
      next[matchIdx] = { ...entry, hlRanges: nextRanges };
      trEntriesRef.current = next;
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

  // Auto-translate trigger state derived from trEntries (auto:true entries).
  // The button shows whenever there are UNTRANSLATED segments — so deleting a
  // block (or a cache miss) brings the button back, and a fully-translated
  // statement hides it (no dead "Done" button to click).
  const autoEntries = trEntries.filter((e) => e.auto);
  const autoRunning = autoEntries.some((e) => e.pending);
  const autoFailed = autoEntries.filter((e) => e.error);
  const hasAuto = autoEntries.length > 0;
  // Count untranslated segments: re-segment + offset-map, then exclude any
  // segment already covered by a non-error entry (pending or finalized).
  const segUnits = autoMode === "off" ? [] : segmentStatement(data, autoMode as SegMode);
  let untranslatedCount = 0;
  if (segUnits.length > 0) {
    const isSeg = autoMode === "section" || autoMode === "paragraph";
    const off = segmentOffsets(buildArticleHtml(data, segUnits, isSeg), segUnits, autoMode as SegMode);
    const covered = trEntries.filter((e) => !e.error);
    untranslatedCount = off.filter((o) => !covered.some((e) => e.end > o.start && e.start < o.end)).length;
  }
  const autoDone = untranslatedCount === 0;

  return (
    <div className="container">
      <div className="card">
        <h1 className="problem-title">{data.title || `${problem.index}. ${problem.name}`}</h1>
        <div className="problem-limits">
          <span><b>Time limit:</b>{data.timeLimit || "—"}</span>
          <span><b>Memory limit:</b>{data.memoryLimit || "—"}</span>
          {problem.rating ? <span><b>Rating:</b>{problem.rating}</span> : null}
          {autoMode !== "off" && (
            <span className="auto-trigger">
              {!autoDone && (
                <button
                  type="button"
                  className="auto-trigger-btn"
                  disabled={autoRunning}
                  onClick={onAutoTrButton}
                >{autoRunning ? t(lang, "prob.autoTring") : t(lang, "prob.autoTr")}</button>
              )}
              {autoFailed.length > 0 && !autoRunning && (
                <button type="button" className="auto-trigger-btn" onClick={retryAllFailed}>
                  {t(lang, "prob.autoRetry")} ({autoFailed.length})
                </button>
              )}
              {autoRunning && autoFailed.length > 0 && (
                <span className="auto-trigger-err">{t(lang, "prob.autoErr").replace("{n}", String(autoFailed.length))}</span>
              )}
              {hasAuto && !autoRunning && (
                <button type="button" className="auto-trigger-btn" onClick={clearAutoTranslations}>
                  {t(lang, "prob.autoClear")}
                </button>
              )}
            </span>
          )}
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
