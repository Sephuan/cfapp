import { useEffect } from "react";
import { useLang, t } from "../../i18n";

export function TrPopover(props: {
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
