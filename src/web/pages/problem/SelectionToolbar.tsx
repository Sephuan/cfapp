import type React from "react";
import { useEffect, useState } from "react";
import type { HLColor } from "../../highlight";

type SelInfo = {
  x: number; y: number;
  // Snapshot of the selection range so we can act on it after the user clicks a button.
  saved: Range | null;
};

export function SelectionToolbar(props: {
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
