// Shared streaming helper for the /api/translate route. Both servers call
// buildTranslateStreamResponse with their own renderTranslationHtml (server.ts
// carries binary NUL sentinels in that function, so it can't be shared — but the
// SSE plumbing here can).
//
// Wire format (Server-Sent Events, one JSON object per `data:` frame):
//   { html, translation }   — a progress frame: full rendered HTML + raw text so far
//   { done: true, html, translation } — final frame
//   { error }               — upstream/parse failure
//
// Rendering is incremental by construction: renderTranslationHtml runs on the
// full accumulated text each frame, so a `$…$` formula renders the instant its
// closing delimiter arrives (an unclosed one stays literal until it closes).
//
// KaTeX rendering is synchronous and re-runs over the WHOLE accumulated text, so
// rendering on every single token is O(n²) and, for a long translation, blocks
// the event loop long enough to trip the server idle timeout — the connection
// dies and the client sees an empty result ("long text → no translation"). We
// therefore throttle: render at most once per RENDER_INTERVAL_MS while tokens
// stream in, and always emit one final full render at the end.
const RENDER_INTERVAL_MS = 120;

export type RenderFn = (text: string) => string;

const enc = new TextEncoder();
const sse = (obj: unknown) => enc.encode(`data: ${JSON.stringify(obj)}\n\n`);

// Pull the incremental text out of one OpenAI-like chat.completions chunk.
function deltaOf(chunk: any): string {
  return chunk?.choices?.[0]?.delta?.content ?? chunk?.choices?.[0]?.message?.content ?? "";
}

// Some providers answer an over-long / malformed request with HTTP 200 and an
// error object inside the SSE body ({ "error": {...} } or { "error": "..." }).
// Surface it instead of silently accumulating nothing ("long text → no result").
function errorOf(chunk: any): string {
  const e = chunk?.error;
  if (!e) return "";
  return typeof e === "string" ? e : (e.message || JSON.stringify(e));
}

// If a single read() waits longer than this with no bytes at all, the provider
// has accepted the request but hung — the common failure for over-long input.
// Without a cap the client stays on "translating…" forever (no output, no
// error). We instead treat the silence as a soft end-of-stream and finalize:
// salvage whatever already arrived, or error if nothing did.
const DEFAULT_IDLE_TIMEOUT_MS = 60_000;

// Distinguished from a real network error so the loop can salvage partial
// content instead of discarding it.
class Stalled extends Error {
  constructor(ms: number) {
    super(`upstream stalled — no data for ${Math.round(ms / 1000)}s (input too long?)`);
    this.name = "Stalled";
  }
}

// Read one chunk, but reject with Stalled if nothing arrives within `ms`. The
// timer is cleared in `finally` so a timely read doesn't leak a pending timer.
async function readWithTimeout(reader: ReadableStreamDefaultReader<Uint8Array>, ms: number) {
  let timer!: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Stalled(ms)), ms);
  });
  try {
    return await Promise.race([reader.read(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// Finalize: render whatever we have. If we got real text, emit a done frame so
// the caller persists it (the translation isn't lost just because the tail of
// the stream hung). If we got nothing, emit an error so the user sees a message
// instead of an empty popover.
function finalize(controller: ReadableStreamDefaultController<Uint8Array>,
                  render: RenderFn, acc: string, error?: string) {
  const text = acc.trim();
  if (text) {
    controller.enqueue(sse({ done: true, translation: text, html: render(acc) }));
  } else {
    controller.enqueue(sse({ error: error ?? "Model returned no content (input too long or upstream error)" }));
  }
  controller.close();
}

// Consume an upstream fetch Response whose body is an OpenAI SSE stream and
// re-emit our own SSE frames (rendered HTML + raw text) to the client.
//
// `idleTimeoutMs` caps how long a single read may wait with no bytes — once it
// fires we finalize instead of waiting forever. Tests pass a small value; the
// default (60s) is generous since healthy providers return a first token within
// a few seconds.
export function buildTranslateStreamResponse(
  upstream: Response,
  render: RenderFn,
  idleTimeoutMs: number = DEFAULT_IDLE_TIMEOUT_MS,
): Response {
  const reader = upstream.body!.getReader();
  const decoder = new TextDecoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Open the pipe immediately: the client flips to its live "translating"
      // state and the socket carries a byte right away, so a slow first token
      // can't trip the server idle timeout before anything is sent.
      controller.enqueue(sse({ translation: "", html: "" }));
      let buf = "";
      let acc = "";
      let lastHtml = "";
      let lastRenderAt = 0;
      const flush = () => {
        const html = render(acc);
        lastRenderAt = Date.now();
        if (html !== lastHtml) {
          lastHtml = html;
          controller.enqueue(sse({ translation: acc, html }));
        }
      };
      try {
        for (;;) {
          const { done, value } = await readWithTimeout(reader, idleTimeoutMs);
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          let changed = false;
          for (const raw of lines) {
            const line = raw.trim();
            if (!line || !line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (payload === "[DONE]") continue;
            let parsed: any;
            try { parsed = JSON.parse(payload); } catch { continue; /* keep-alive / non-JSON */ }
            const err = errorOf(parsed);
            if (err) throw new Error(err);
            const piece = deltaOf(parsed);
            if (piece) { acc += piece; changed = true; }
          }
          // Throttle: only re-render (a full-text KaTeX pass) every ~120ms.
          if (changed && Date.now() - lastRenderAt >= RENDER_INTERVAL_MS) flush();
        }
        finalize(controller, render, acc);
      } catch (e: any) {
        // Salvage: a stall mid-stream still leaves us with partial content.
        // The user prefers "incomplete translation" over "nothing forever".
        reader.cancel().catch(() => {});
        if (e instanceof Stalled) {
          finalize(controller, render, acc, e.message);
        } else {
          controller.enqueue(sse({ error: e?.message || "stream error" }));
          controller.close();
        }
      }
    },
    cancel() { reader.cancel().catch(() => {}); },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      // no-store (not no-cache): the Electron host's Chromium may otherwise
      // heuristically cache a POST + text/event-stream response, and a stale
      // entry then makes the renderer's fetch hang with no output. no-cache
      // still allows storage; no-store forbids it outright.
      "cache-control": "no-store",
      "connection": "keep-alive",
    },
  });
}
