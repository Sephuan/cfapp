// Pins the SSE plumbing of buildTranslateStreamResponse: it parses OpenAI-style
// delta chunks, accumulates text, renders each frame, and emits a final done
// frame. The render fn is injected (each server passes its own), so here we use
// a trivial one and assert on accumulation + framing, not on KaTeX.
import { test, expect, describe } from "bun:test";
import { buildTranslateStreamResponse } from "./api/translate-stream";

function upstreamOf(chunks: string[]): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

async function framesOf(resp: Response): Promise<any[]> {
  const text = await resp.text();
  return text
    .split("\n\n")
    .map(f => f.split("\n").find(l => l.startsWith("data:")))
    .filter((l): l is string => !!l)
    .map(l => JSON.parse(l.slice(5).trim()));
}

const delta = (s: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: s } }] })}\n\n`;

// A stream that emits `chunks` and then stays open forever (never resolves done):
// simulates a provider that accepted the request but hung mid-stream.
function stalledUpstreamOf(chunks: string[]): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      // intentionally no c.close() — read() will hang forever after the chunks.
    },
  });
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

describe("buildTranslateStreamResponse", () => {
  test("accumulates deltas and emits a final done frame", async () => {
    const upstream = upstreamOf([delta("Hola"), delta(" mundo"), "data: [DONE]\n\n"]);
    const frames = await framesOf(buildTranslateStreamResponse(upstream, t => `<p>${t}</p>`));
    // progress frames accumulate; the last frame is the done frame.
    const done = frames[frames.length - 1];
    expect(done.done).toBe(true);
    expect(done.translation).toBe("Hola mundo");
    expect(done.html).toBe("<p>Hola mundo</p>");
    // at least one progress frame carried the partial text
    expect(frames.some(f => f.translation === "Hola" && !f.done)).toBe(true);
  });

  test("handles a delta split across read boundaries", async () => {
    // The second chunk cuts one SSE frame in half — the parser must buffer it.
    const whole = delta("café");
    const cut = Math.floor(whole.length / 2);
    const upstream = upstreamOf([whole.slice(0, cut), whole.slice(cut), "data: [DONE]\n\n"]);
    const frames = await framesOf(buildTranslateStreamResponse(upstream, t => t));
    expect(frames[frames.length - 1].translation).toBe("café");
  });

  test("surfaces an upstream error frame", async () => {
    // A malformed JSON payload is ignored; but a delta then close still yields done.
    const upstream = upstreamOf(["data: not-json\n\n", delta("ok"), "data: [DONE]\n\n"]);
    const frames = await framesOf(buildTranslateStreamResponse(upstream, t => t));
    expect(frames[frames.length - 1].translation).toBe("ok");
  });

  test("surfaces an error object embedded in the SSE body", async () => {
    // Providers answer over-long input with HTTP 200 + { error: {...} }; must not
    // be swallowed into a silent empty translation ("long text → no result").
    const errFrame = `data: ${JSON.stringify({ error: { message: "input too long" } })}\n\n`;
    const upstream = upstreamOf([delta("partial"), errFrame, "data: [DONE]\n\n"]);
    const frames = await framesOf(buildTranslateStreamResponse(upstream, t => t));
    expect(frames[frames.length - 1].error).toBe("input too long");
  });

  test("emits an error frame (not a silent done) when the stream carries no content", async () => {
    const upstream = upstreamOf(["data: [DONE]\n\n"]);
    const frames = await framesOf(buildTranslateStreamResponse(upstream, t => t));
    const final = frames[frames.length - 1];
    expect(final.done).toBeUndefined();
    expect(typeof final.error).toBe("string");
  });

  test("finalizes instead of hanging when the upstream stalls with no content", async () => {
    // Provider accepted the request but never sends a byte and never closes —
    // the classic "over-long input" hang. The idle timeout must turn it into an
    // error frame rather than leaving the client on "translating…" forever.
    const upstream = stalledUpstreamOf([]);
    const frames = await framesOf(buildTranslateStreamResponse(upstream, t => t, 20));
    const final = frames[frames.length - 1];
    expect(final.done).toBeUndefined();
    expect(typeof final.error).toBe("string");
    expect(final.error).toMatch(/stall|timeout|no content/i);
  });

  test("salvages partial content when the upstream stalls mid-stream", async () => {
    // Some bytes arrived, then silence. We prefer an incomplete translation over
    // discarding everything — the final frame is a done carrying what we have.
    const upstream = stalledUpstreamOf([delta("half "), delta("a translation")]);
    const frames = await framesOf(buildTranslateStreamResponse(upstream, t => t, 20));
    const final = frames[frames.length - 1];
    expect(final.done).toBe(true);
    expect(final.translation).toBe("half a translation");
  });
});
