// Highlight engine (offset-range model).
//
// Highlights are stored as plain-text offsets into the article container.
// Render = (1) reset to base HTML, (2) walk text nodes and wrap segments
// covered by an active range. This way "recolor a slice" or "clear part of"
// never destroys neighbouring color, because the source of truth is the
// `ranges` array, not the DOM.

export const HL_CLASSES = ["cf-hl-red", "cf-hl-green", "cf-hl-blue", "cf-hl-yellow", "cf-hl-purple"] as const;
export type HLColor = "red" | "green" | "blue" | "yellow" | "purple";
export type HLRange = { start: number; end: number; color: HLColor };

// Skip text nodes inside KaTeX (mathml is hidden duplicate text) and inside
// existing <mark> elements during *offset* counting — we count against the
// pristine base HTML, so marks would double-count their own contents.
// When `stopAt` is given (e.g. a .cf-tr body span), the walk stops there so
// translation-local offset counting works correctly.
export function isCountable(node: Node, stopAt?: HTMLElement): boolean {
  let p: Node | null = node.parentNode;
  while (p && p.nodeType === 1) {
    const el = p as HTMLElement;
    if (el.classList.contains("katex-mathml")) return false;
    if (stopAt) {
      if (p === stopAt || stopAt.contains(p)) return true;
      p = p.parentNode;
      continue;
    }
    if (el.classList.contains("cf-tr")) return false;
    p = p.parentNode;
  }
  return true;
}

// Find the nearest .cf-tr ancestor of `node`, stopping at `container`.
export function findTrAncestor(node: Node, container: HTMLElement): HTMLElement | null {
  let p: Node | null = node;
  while (p && p !== container) {
    if (p.nodeType === 1 && (p as HTMLElement).classList.contains("cf-tr")) return p as HTMLElement;
    p = p.parentNode;
  }
  return null;
}

// Convert a live DOM Range (from window.getSelection) into article-space offsets.
export function rangeToOffsets(container: HTMLElement, range: Range, stopAt?: HTMLElement): { start: number; end: number } | null {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let pos = 0;
  let start = -1, end = -1;
  let n = walker.nextNode();
  while (n) {
    const t = n as Text;
    if (!isCountable(t, stopAt)) { n = walker.nextNode(); continue; }
    const len = t.length;
    if (t === range.startContainer) start = pos + Math.min(range.startOffset, len);
    if (t === range.endContainer)   end   = pos + Math.min(range.endOffset, len);
    pos += len;
    n = walker.nextNode();
  }
  if (start < 0 || end < 0 || end <= start) return null;
  return { start, end };
}

// Convert a selection range back into the original LaTeX-bearing source text:
// walks the range and, whenever it dips into a KaTeX-rendered `.cf-math` span,
// emits the stashed `$tex$` / `$$$tex$$$` source instead of the glyph-by-glyph
// visual text. Without this, selecting "consider a_i" hands the AI a string
// like "considera1" (KaTeX layout text), and the translation loses every
// formula. With it, the AI gets `consider $a_i$` and the response can be
// re-rendered by renderTranslationHtml on the server.
export function rangeToTexSource(container: HTMLElement, range: Range): string {
  // Walk both text nodes AND .cf-math element nodes; for math nodes emit the
  // source and skip their subtree.
  const out: string[] = [];
  const seenMath = new Set<HTMLElement>();
  const walker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        if (node.nodeType === 1) {
          const el = node as HTMLElement;
          if (el.classList?.contains("cf-math")) return NodeFilter.FILTER_ACCEPT;
          if (el.classList?.contains("katex-mathml")) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_SKIP;
        }
        // text nodes: reject if inside katex-mathml or inside a cf-math we
        // already emitted (descendant glyph text).
        let p: Node | null = node.parentNode;
        while (p && p !== container) {
          if (p.nodeType === 1) {
            const el = p as HTMLElement;
            if (el.classList?.contains("katex-mathml")) return NodeFilter.FILTER_REJECT;
            if (el.classList?.contains("cf-math") && seenMath.has(el)) return NodeFilter.FILTER_REJECT;
          }
          p = p.parentNode;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    } as NodeFilter,
  );
  // Use intersectsNode-style trimming: include nodes that overlap [start,end].
  let n: Node | null = walker.nextNode();
  while (n) {
    // Range membership: only emit if some part of n is inside the range.
    if (n.nodeType === 1) {
      const el = n as HTMLElement;
      if (el.classList.contains("cf-math")) {
        // Treat as a single atom; include if any point of it is in the range.
        if (range.intersectsNode(el)) {
          const tex = el.getAttribute("data-tex") ?? "";
          const display = el.getAttribute("data-display") === "1";
          out.push(display ? `$$$${tex}$$$` : `$${tex}$`);
          seenMath.add(el);
        }
      }
    } else {
      const t = n as Text;
      // Check whether this text node has overlap with the range.
      if (range.intersectsNode(t)) {
        const startOffset = (t === range.startContainer) ? range.startOffset : 0;
        const endOffset = (t === range.endContainer) ? range.endOffset : t.length;
        if (endOffset > startOffset) {
          out.push(t.data.slice(startOffset, endOffset));
        }
      }
    }
    n = walker.nextNode();
  }
  // Tidy: collapse 3+ whitespace runs (KaTeX leaves nothing here, but CF's
  // markup occasionally does), preserve single spaces and newlines.
  return out.join("").replace(/[ \t]+/g, " ").trim();
}

// Apply [{start,end,color}] to the (already restored) base DOM by walking its
// text nodes and wrapping the slices that fall inside any range.
export function applyRangesToDOM(container: HTMLElement, ranges: HLRange[]) {
  if (ranges.length === 0) return;
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const targets: Text[] = [];
  let n = walker.nextNode();
  while (n) {
    if (isCountable(n)) targets.push(n as Text);
    n = walker.nextNode();
  }
  let pos = 0;
  for (const node of targets) {
    const nodeStart = pos;
    const nodeEnd = pos + node.length;
    pos = nodeEnd;
    // Collect ranges that overlap this node, clipped to its bounds.
    const cuts: { from: number; to: number; color: HLColor }[] = [];
    for (const r of sorted) {
      if (r.end <= nodeStart) continue;
      if (r.start >= nodeEnd) break;
      cuts.push({
        from: Math.max(r.start, nodeStart) - nodeStart,
        to:   Math.min(r.end, nodeEnd) - nodeStart,
        color: r.color,
      });
    }
    if (!cuts.length) continue;
    // Walk the cuts left-to-right, splitting `node` and wrapping the slices.
    cuts.sort((a, b) => a.from - b.from);
    let consumed = 0;
    let current: Text = node;
    for (const c of cuts) {
      const localFrom = c.from - consumed;
      const localTo = c.to - consumed;
      if (localFrom > 0) current = current.splitText(localFrom);
      consumed += localFrom;
      const tail = current.splitText(localTo - localFrom);
      const mark = document.createElement("mark");
      mark.className = `cf-hl-${c.color}`;
      current.parentNode!.replaceChild(mark, current);
      mark.appendChild(current);
      consumed += localTo - localFrom;
      current = tail;
    }
  }
}

// Merge a new colored range into existing ranges. Existing portions overlapping
// the new range are *replaced* (so recoloring works); non-overlapping portions
// are kept verbatim. This is what the user wants: only the selected slice changes.
export function mergeAddRange(ranges: HLRange[], add: HLRange): HLRange[] {
  const out: HLRange[] = [];
  for (const r of ranges) {
    if (r.end <= add.start || r.start >= add.end) { out.push(r); continue; }
    if (r.start < add.start) out.push({ start: r.start, end: add.start, color: r.color });
    if (r.end > add.end)     out.push({ start: add.end, end: r.end, color: r.color });
  }
  out.push(add);
  // Coalesce neighbouring same-color slices that touch.
  out.sort((a, b) => a.start - b.start);
  const merged: HLRange[] = [];
  for (const r of out) {
    const last = merged[merged.length - 1];
    if (last && last.color === r.color && last.end >= r.start) {
      last.end = Math.max(last.end, r.end);
    } else {
      merged.push({ ...r });
    }
  }
  return merged;
}

// Subtract a range (clearing) from existing ranges.
export function mergeClearRange(ranges: HLRange[], cut: { start: number; end: number }): HLRange[] {
  const out: HLRange[] = [];
  for (const r of ranges) {
    if (r.end <= cut.start || r.start >= cut.end) { out.push(r); continue; }
    if (r.start < cut.start) out.push({ start: r.start, end: cut.start, color: r.color });
    if (r.end > cut.end)     out.push({ start: cut.end, end: r.end, color: r.color });
  }
  return out;
}

// ----- problem-scoped persistence -----
export function lsKey(contestId: number, idx: string, kind: "hl" | "tr" | "theme") {
  return `cfapp:${kind}:${contestId}:${idx}`;
}

// ----- inline translations (offset-anchored, persisted) -----
// One translation block per saved entry. `end` is the offset of the end of
// the source selection; the block is rendered after the nearest enclosing
// block-level element that contains that offset. Storing the source text
// and rendered HTML means we can replay without re-hitting the API.
export type TrHLRange = { start: number; end: number; color: HLColor };
export type TrEntry = { start: number; end: number; src: string; html: string; hlRanges?: TrHLRange[] };

// Construct the DOM element for an inline translation block. The close
// button (×) calls onRemove which evicts it from state + localStorage.
// A leading 「译」 seal announces the block as a translation rather than
// letting it read as another paragraph of the statement.
export function buildTrBlock(entry: TrEntry, onRemove: () => void): HTMLDivElement {
  const block = document.createElement("div");
  block.className = "cf-tr";
  const close = document.createElement("button");
  close.className = "cf-tr-close";
  close.type = "button";
  close.textContent = "×";
  close.addEventListener("click", (e) => { e.stopPropagation(); onRemove(); });
  const body = document.createElement("div");
  body.className = "cf-tr-body";
  const seal = document.createElement("span");
  seal.className = "cf-tr-label";
  seal.textContent = "译";
  body.appendChild(seal);
  const bodyContent = document.createElement("div");
  bodyContent.className = "cf-tr-content";
  bodyContent.innerHTML = entry.html;
  body.appendChild(bodyContent);
  block.appendChild(close);
  block.appendChild(body);
  // Apply stored highlights to the translation body text.
  if (entry.hlRanges && entry.hlRanges.length > 0) {
    applyRangesToDOM(bodyContent, entry.hlRanges);
  }
  return block;
}

// Plain-text → HTML fallback for the rare case the server returns no html field.
export function escapePlain(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
}

// Walk text nodes and find the block-level ancestor that contains the
// given offset. Returns null if the offset falls outside the article.
export function blockAtOffset(container: HTMLElement, offset: number): HTMLElement | null {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let pos = 0;
  let n = walker.nextNode();
  while (n) {
    if (!isCountable(n)) { n = walker.nextNode(); continue; }
    const t = n as Text;
    const next = pos + t.length;
    if (offset <= next) {
      let p: Node | null = t;
      while (p && p !== container) {
        if (p.nodeType === 1) {
          const tag = (p as HTMLElement).tagName;
          if (tag === "P" || tag === "DIV" || tag === "LI") return p as HTMLElement;
        }
        p = p.parentNode;
      }
      return null;
    }
    pos = next;
    n = walker.nextNode();
  }
  return null;
}
