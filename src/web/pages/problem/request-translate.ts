import { escapePlain } from "../../highlight";

// One translation call that transparently handles both server modes:
//   • streaming  → text/event-stream, onUpdate fires per frame (incremental HTML)
//   • buffered   → application/json, onUpdate fires once with the final HTML
// Resolves to the final { translation, html }, or throws on error. `onUpdate`
// lets the caller paint partial output live; the resolved value is what gets
// persisted.
export type TrResult = { translation: string; html: string };

// Hard cap so a hung upstream never leaves the card on "翻译中…" forever.
// Server-side idle salvage is 60s; allow a bit more headroom for slow models.
const TRANSLATE_TIMEOUT_MS = 90_000;

export async function requestTranslate(
  text: string,
  onUpdate: (partial: TrResult) => void,
): Promise<TrResult> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TRANSLATE_TIMEOUT_MS);
  try {
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
      signal: ac.signal,
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
    // Abort mid-stream if the overall deadline fires.
    const onAbort = () => { reader.cancel().catch(() => {}); };
    ac.signal.addEventListener("abort", onAbort, { once: true });
    try {
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
    } finally {
      ac.signal.removeEventListener("abort", onAbort);
    }
    if (ac.signal.aborted) {
      throw new Error(`Translation timed out after ${Math.round(TRANSLATE_TIMEOUT_MS / 1000)}s`);
    }
    // Empty stream: surface as error so the card leaves "busy" and offers retry.
    if (!last.translation && !last.html) {
      throw new Error("Model returned no content (timeout, empty stream, or upstream error)");
    }
    return last;
  } catch (e: any) {
    if (e?.name === "AbortError" || ac.signal.aborted) {
      throw new Error(`Translation timed out after ${Math.round(TRANSLATE_TIMEOUT_MS / 1000)}s`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
