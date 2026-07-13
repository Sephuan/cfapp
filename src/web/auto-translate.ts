// Auto-translate engine: splits a parsed statement into translation units,
// rate-limits concurrent per-segment requests, and maps segments to article
// offsets so each translation can be placed and persisted EXACTLY like a manual
// selection-translation.
//
// Reuses the same primitives as the manual path:
//   • rangeToTexSource (highlight.ts)   — restore $…$ / $$$…$$$ from KaTeX HTML
//   • buildTrBlock / .cf-tr structure   — so auto and manual blocks look alike
//   • requestTranslate (ProblemPage)    — the actual /api/translate POST
//
// Samples are deliberately never segmented (the 4 source fields exclude them).

import type { StatementJSON } from "../api/types";
import { rangeToTexSource } from "./highlight";

// One slice of the statement that becomes a single translation request.
export type SegKind = "statement" | "input" | "output" | "note";
export type SegUnit = {
  id: string;          // deterministic id — see newId
  kind: SegKind;
  html: string;        // raw segment HTML (injected into a temp <div> for text extraction)
  text: string;        // extracted TeX-bearing source text
  anchorId: string;    // data-autotr-id on the zero-width anchor span (section/paragraph modes)
  // Index among the field's element children (paragraph mode only). Used to
  // inject anchors into a clone of the original HTML so empty nodes / bare text
  // between elements are preserved and offsets stay stable vs saved ranges.
  childIndex?: number;
};

export type SegMode = "full" | "section" | "paragraph";

// The four fields, in document order. Note is the author's commentary and
// belongs last (mirrors how ProblemPage concatenates the article).
const SECTIONS: { kind: SegKind; field: keyof StatementJSON }[] = [
  { kind: "statement", field: "statementHtml" },
  { kind: "input", field: "inputHtml" },
  { kind: "output", field: "outputHtml" },
  { kind: "note", field: "noteHtml" },
];

// Extract plain-but-TeX-faithful source text from a fragment of CF HTML by
// injecting it into a detached <div> and pointing a Range at its contents.
// This is exactly what the selection path does on a live selection; here we
// synthesize the range so we can reuse rangeToTexSource unchanged.
function htmlToSource(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html;
  const range = document.createRange();
  range.selectNodeContents(div);
  return rangeToTexSource(div, range).trim();
}

// Deterministic ID: stable for a given (kind, index) so that re-segmenting the
// SAME statement (e.g. on a page reload or a cache-hydrate run) yields identical
// IDs. This is what lets persisted translations key correctly after a reload.
// A counter or random() here would break hydration + retry targeting.
const newId = (kind: SegKind, i: number) => `autotr-${kind}-${i}`;

// Split a parsed statement into translation units.
//
//   • full      — the four fields concatenated into ONE unit (one request for
//                 the whole statement). anchorId is unused (full mode renders
//                 inline at the end of the article, no anchor).
//   • section   — one unit per non-empty field (statement / input / output / note).
//   • paragraph — one unit per top-level block element (<p>/<ul>/<div>/<pre>)
//                 within each non-empty field.
//
// Empty fields produce no units, so a statement with no Note doesn't send a
// request for empty content.
export function segmentStatement(data: StatementJSON, mode: SegMode): SegUnit[] {
  if (mode === "full") {
    const combined = SECTIONS
      .map((s) => data[s.field] as string)
      .filter((h) => h.trim())
      .join("\n\n");
    if (!combined.trim()) return [];
    return [{
      id: newId("statement", 0),
      kind: "statement",
      html: combined,
      text: htmlToSource(combined),
      anchorId: "",
    }];
  }

  const units: SegUnit[] = [];
  for (const s of SECTIONS) {
    const fieldHtml = (data[s.field] as string) ?? "";
    if (!fieldHtml.trim()) continue;

    if (mode === "section") {
      units.push({
        id: newId(s.kind, units.length),
        kind: s.kind,
        html: fieldHtml,
        text: htmlToSource(fieldHtml),
        anchorId: `autotr-anchor-${s.kind}`,
      });
      continue;
    }

    // paragraph: split the field into its top-level block children.
    const div = document.createElement("div");
    div.innerHTML = fieldHtml;
    const kids = Array.from(div.children);
    // No block children (e.g. bare text node) → treat the whole field as one.
    if (kids.length === 0) {
      units.push({
        id: newId(s.kind, units.length),
        kind: s.kind,
        html: fieldHtml,
        text: htmlToSource(fieldHtml),
        anchorId: `autotr-anchor-${s.kind}-0`,
      });
      continue;
    }
    kids.forEach((kid, i) => {
      const html = kid.outerHTML;
      const text = htmlToSource(html);
      if (!text) return; // skip a block that extracts to nothing (e.g. empty <div>)
      units.push({
        id: newId(s.kind, units.length),
        kind: s.kind,
        html,
        text,
        anchorId: `autotr-anchor-${s.kind}-${i}`,
        childIndex: i,
      });
    });
  }
  return units;
}

// Build the article HTML, threading a zero-width <span class="autotr-anchor"
// data-autotr-id="…"> after each segment's content. The anchors carry NO text,
// so isCountable() skips them and the manual-highlight offset engine is
// byte-stable. Returns the full article HTML (with section titles + anchors).
//
// Paragraph mode injects anchors into a clone of the original field HTML
// (preserving empty blocks and inter-element text) instead of rebuilding from
// unit.html alone — that rebuild shifted countable offsets and broke saved
// highlights / manual translations when switching into paragraph auto mode.
export function buildArticleHtml(data: StatementJSON, units: SegUnit[], segMode: boolean): string {
  const anchorFor = (unit: SegUnit) =>
    `<span class="autotr-anchor" data-autotr-id="${unit.anchorId}"></span>`;
  const buildField = (kind: SegKind, field: keyof StatementJSON, title: string) => {
    const fieldHtml = (data[field] as string) ?? "";
    if (!fieldHtml.trim()) return "";
    const head = title ? `<div class="section">${title}</div>` : "";
    if (!segMode) return head + fieldHtml;
    const fieldUnits = units.filter((u) => u.kind === kind);
    if (fieldUnits.length === 0) return head + fieldHtml;

    // Section mode: one unit per field — append a single anchor after the field.
    const allHaveChildIndex = fieldUnits.every((u) => typeof u.childIndex === "number");
    if (!allHaveChildIndex) {
      // section (or whole-field fallback): keep original HTML, append anchors.
      return head + fieldHtml + fieldUnits.map(anchorFor).join("");
    }

    // Paragraph mode: clone original DOM and insert anchors after matched kids.
    const wrap = document.createElement("div");
    wrap.innerHTML = fieldHtml;
    const kids = Array.from(wrap.children);
    // Insert from the end so earlier child indices stay valid.
    const ordered = [...fieldUnits].sort((a, b) => (b.childIndex ?? 0) - (a.childIndex ?? 0));
    for (const u of ordered) {
      const kid = kids[u.childIndex!];
      if (!kid) continue;
      const span = document.createElement("span");
      span.className = "autotr-anchor";
      span.setAttribute("data-autotr-id", u.anchorId);
      kid.after(span);
    }
    return head + wrap.innerHTML;
  };
  return (
    buildField("statement", "statementHtml", "") +
    buildField("input", "inputHtml", "Input") +
    buildField("output", "outputHtml", "Output") +
    buildField("note", "noteHtml", "Note")
  );
}

// Map each segment to article-space { start, end } offsets by walking a detached
// copy of the article HTML and recording, at each autotr-anchor element, the
// accumulated countable-text length up to that point. The coordinate system
// matches rangeToOffsets (the manual-selection path) because the anchors have no
// text nodes and KaTeX mathml is skipped the same way isCountable does it.
//
// `end` of segment N = offset where its anchor sits; `start` of segment N =
// `end` of segment N-1 (0 for the first). full mode: one segment spanning the
// whole article (start 0, end = total text length).
export type SegOffsets = { id: string; start: number; end: number };
export function segmentOffsets(articleHtml: string, units: SegUnit[], mode: SegMode): SegOffsets[] {
  const div = document.createElement("div");
  div.innerHTML = articleHtml;

  if (mode === "full") {
    // Count all countable text in the article for the single full segment.
    const total = countText(div);
    return units.length > 0 ? [{ id: units[0]!.id, start: 0, end: total }] : [];
  }

  // Walk element + text nodes; accumulate text length; record at each anchor.
  // The anchor sits AFTER its segment's content, so `pos` at an anchor equals
  // the cumulative countable text up to the end of that segment — exactly the
  // coordinate blockAtOffset uses to place the translation block. A segment's
  // START is the previous anchor's END (0 for the first).
  const byId = new Map(units.map((u) => [u.anchorId, u]));
  const ends: { id: string; end: number }[] = [];
  let pos = 0;
  const seen = new Set<string>();
  const walker = document.createTreeWalker(div, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType === 1) {
        const el = node as HTMLElement;
        if (el.classList?.contains("autotr-anchor")) return NodeFilter.FILTER_ACCEPT;
        if (el.classList?.contains("katex-mathml")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_SKIP;
      }
      return isPlainCountable(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  } as NodeFilter);
  let n = walker.nextNode();
  while (n) {
    if (n.nodeType === 1) {
      const el = n as HTMLElement;
      const aid = el.getAttribute("data-autotr-id");
      if (aid && byId.has(aid) && !seen.has(aid)) {
        seen.add(aid);
        ends.push({ id: byId.get(aid)!.id, end: pos });
      }
    } else {
      pos += (n as Text).length;
    }
    n = walker.nextNode();
  }
  // START of segment i = END of segment i-1 (0 for the first).
  return ends.map((e, i) => ({
    id: e.id,
    start: i === 0 ? 0 : ends[i - 1]!.end,
    end: e.end,
  }));
}

// Count text the way isCountable does, minus the .cf-tr check (no tr blocks in
// a freshly built article). Used by segmentOffsets for full mode.
function countText(root: HTMLElement): number {
  let total = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) { return isPlainCountable(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT; },
  } as NodeFilter);
  let n = walker.nextNode();
  while (n) { total += (n as Text).length; n = walker.nextNode(); }
  return total;
}

function isPlainCountable(node: Node): boolean {
  let p: Node | null = node.parentNode;
  while (p && p.nodeType === 1) {
    if ((p as HTMLElement).classList.contains("katex-mathml")) return false;
    p = p.parentNode;
  }
  return true;
}

// Rate limiter lives in its own module; re-export so existing imports from
// ./auto-translate keep working.
export type { RateLimiter } from "./rate-limiter";
export { createRateLimiter } from "./rate-limiter";

