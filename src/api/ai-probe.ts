// Probe helpers for OpenAI-compatible endpoints: list models + smoke-test
// chat/completions (stream and non-stream). Used by Settings so the user can
// pick a model and verify the key/base URL without leaving the page.

export type AiCreds = {
  baseUrl: string;
  apiKey: string;
  model?: string;
};

function normalizeBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function authHeaders(apiKey: string): HeadersInit {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${apiKey}`,
  };
}

/** OpenAI-style GET /v1/models → sorted id list. */
export async function listAiModels(
  creds: AiCreds,
  opts?: { signal?: AbortSignal },
): Promise<{ models: string[] } | { error: string }> {
  const base = normalizeBase(creds.baseUrl || "");
  if (!base) return { error: "Base URL is empty" };
  if (!creds.apiKey) return { error: "API key is empty" };
  try {
    const r = await fetch(`${base}/models`, {
      method: "GET",
      headers: authHeaders(creds.apiKey),
      signal: opts?.signal ?? AbortSignal.timeout(20_000),
    });
    const text = await r.text();
    if (!r.ok) {
      return { error: `Upstream ${r.status}: ${text.slice(0, 200)}` };
    }
    let j: any;
    try {
      j = JSON.parse(text);
    } catch {
      return { error: "Response is not JSON" };
    }
    // OpenAI: { data: [{ id }, ...] }; some gateways return a bare string[].
    const raw: unknown[] = Array.isArray(j?.data)
      ? j.data
      : Array.isArray(j) ? j
      : Array.isArray(j?.models) ? j.models
      : [];
    const ids = raw
      .map((m) => (typeof m === "string" ? m : (m as any)?.id))
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    // De-dupe + stable sort so the dropdown doesn't jump between reloads.
    const models = [...new Set(ids)].sort((a, b) => a.localeCompare(b));
    if (models.length === 0) return { error: "No models returned by provider" };
    return { models };
  } catch (e: any) {
    return { error: e?.name === "TimeoutError" ? "Timed out fetching models" : (e?.message || String(e)) };
  }
}

const PING_PROMPT =
  "Reply with exactly the single word pong and nothing else.";

/** Minimal chat/completions smoke test (stream or non-stream). */
export async function testAiChat(
  creds: AiCreds & { model: string; stream: boolean },
  opts?: { signal?: AbortSignal },
): Promise<{ ok: true; latencyMs: number; preview: string } | { ok: false; error: string; latencyMs: number }> {
  const base = normalizeBase(creds.baseUrl || "");
  const t0 = Date.now();
  if (!base) return { ok: false, error: "Base URL is empty", latencyMs: 0 };
  if (!creds.apiKey) return { ok: false, error: "API key is empty", latencyMs: 0 };
  if (!creds.model?.trim()) return { ok: false, error: "Model is empty", latencyMs: 0 };

  try {
    const r = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: authHeaders(creds.apiKey),
      body: JSON.stringify({
        model: creds.model,
        messages: [{ role: "user", content: PING_PROMPT }],
        temperature: 0,
        max_tokens: 16,
        stream: creds.stream,
      }),
      signal: opts?.signal ?? AbortSignal.timeout(30_000),
    });
    if (!r.ok) {
      const t = await r.text();
      return { ok: false, error: `Upstream ${r.status}: ${t.slice(0, 200)}`, latencyMs: Date.now() - t0 };
    }

    if (creds.stream) {
      if (!r.body) {
        return { ok: false, error: "Stream response has no body", latencyMs: Date.now() - t0 };
      }
      const preview = await readSsePreview(r.body);
      const latencyMs = Date.now() - t0;
      if (!preview.trim()) {
        return { ok: false, error: "Stream produced no content", latencyMs };
      }
      return { ok: true, latencyMs, preview: preview.trim().slice(0, 120) };
    }

    const j = await r.json();
    const content = String(j?.choices?.[0]?.message?.content ?? "").trim();
    const latencyMs = Date.now() - t0;
    if (!content) {
      // Some gateways put text under delta-like shapes even for non-stream.
      const alt = String(j?.choices?.[0]?.text ?? j?.error?.message ?? "").trim();
      if (!alt) return { ok: false, error: "Empty completion", latencyMs };
      // error.message path
      if (j?.error) return { ok: false, error: alt.slice(0, 200), latencyMs };
      return { ok: true, latencyMs, preview: alt.slice(0, 120) };
    }
    return { ok: true, latencyMs, preview: content.slice(0, 120) };
  } catch (e: any) {
    return {
      ok: false,
      error: e?.name === "TimeoutError" ? "Timed out" : (e?.message || String(e)),
      latencyMs: Date.now() - t0,
    };
  }
}

// ── Rate-limit probe (manual "test current concurrency / interval") ─────────
//
// Fires several tiny non-stream chat/completions under the same dual limiter
// the auto-translate path uses (concurrency + start interval + optional RPM).
// A 429 means the chosen knobs are too aggressive for this provider/key.

export type RateProbeShot = {
  index: number;
  ok: boolean;
  status: number;
  latencyMs: number;
  error?: string;
};

export type RateProbeResult = {
  /** True only when every shot succeeded (no 429, no other error). */
  ok: boolean;
  /** True if any response was HTTP 429. */
  rateLimited: boolean;
  total: number;
  succeeded: number;
  rateLimitedCount: number;
  failedCount: number;
  elapsedMs: number;
  concurrency: number;
  requestIntervalMs: number;
  rpm: number;
  shots: RateProbeShot[];
  error?: string;
};

/** Single non-stream ping that preserves HTTP status (for 429 detection). */
async function pingChatOnce(
  creds: AiCreds & { model: string },
  opts?: { signal?: AbortSignal },
): Promise<RateProbeShot & { index: number }> {
  const base = normalizeBase(creds.baseUrl || "");
  const t0 = Date.now();
  const baseShot = { index: 0, ok: false, status: 0, latencyMs: 0 };
  if (!base) return { ...baseShot, error: "Base URL is empty" };
  if (!creds.apiKey) return { ...baseShot, error: "API key is empty" };
  if (!creds.model?.trim()) return { ...baseShot, error: "Model is empty" };

  try {
    const r = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: authHeaders(creds.apiKey),
      body: JSON.stringify({
        model: creds.model,
        messages: [{ role: "user", content: PING_PROMPT }],
        temperature: 0,
        max_tokens: 8,
        stream: false,
      }),
      signal: opts?.signal ?? AbortSignal.timeout(30_000),
    });
    const latencyMs = Date.now() - t0;
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      return {
        index: 0,
        ok: false,
        status: r.status,
        latencyMs,
        error: `Upstream ${r.status}: ${t.slice(0, 160)}`,
      };
    }
    // Drain body so the connection can close; content is irrelevant.
    try { await r.text(); } catch {}
    return { index: 0, ok: true, status: r.status, latencyMs };
  } catch (e: any) {
    return {
      index: 0,
      ok: false,
      status: 0,
      latencyMs: Date.now() - t0,
      error: e?.name === "TimeoutError" ? "Timed out" : (e?.message || String(e)),
    };
  }
}

/**
 * Exercise the current concurrency + requestIntervalMs (+ rpm) against the
 * provider. Mirrors auto-translate scheduling via createRateLimiter.
 *
 * Shot count: enough to fill concurrent slots and refill once after finishes
 * (`concurrency * 2`, clamped 3…12).
 */
export async function probeAiRateLimit(
  opts: AiCreds & {
    model: string;
    concurrency: number;
    requestIntervalMs: number;
    rpm?: number;
    /** Override shot count (tests). */
    count?: number;
    signal?: AbortSignal;
  },
): Promise<RateProbeResult> {
  const concurrency = Math.max(1, Math.floor(Number(opts.concurrency) || 1));
  const requestIntervalMs = Math.max(0, Math.floor(Number(opts.requestIntervalMs) || 0));
  const rpm = Number.isFinite(opts.rpm) && (opts.rpm as number) > 0
    ? Math.floor(opts.rpm as number)
    : 0;
  const total = opts.count != null
    ? Math.max(1, Math.min(20, Math.floor(opts.count)))
    : Math.min(12, Math.max(3, concurrency * 2));

  const empty = (error: string): RateProbeResult => ({
    ok: false,
    rateLimited: false,
    total: 0,
    succeeded: 0,
    rateLimitedCount: 0,
    failedCount: 0,
    elapsedMs: 0,
    concurrency,
    requestIntervalMs,
    rpm,
    shots: [],
    error,
  });

  if (!normalizeBase(opts.baseUrl || "")) return empty("Base URL is empty");
  if (!opts.apiKey) return empty("API key is empty");
  if (!opts.model?.trim()) return empty("Model is empty");

  // Lazy import keeps ai-probe free of a hard cycle if web ever imports it.
  const { createRateLimiter } = await import("../web/rate-limiter");
  const limiter = createRateLimiter(requestIntervalMs, concurrency, rpm);
  const t0 = Date.now();
  const shots: RateProbeShot[] = new Array(total);

  try {
    const jobs = Array.from({ length: total }, (_, i) =>
      limiter.run(async () => {
        if (opts.signal?.aborted) {
          shots[i] = { index: i, ok: false, status: 0, latencyMs: 0, error: "aborted" };
          return;
        }
        const one = await pingChatOnce(
          { baseUrl: opts.baseUrl, apiKey: opts.apiKey, model: opts.model },
          { signal: opts.signal ?? AbortSignal.timeout(30_000) },
        );
        shots[i] = { ...one, index: i };
      }),
    );
    await Promise.all(jobs);
  } catch (e: any) {
    // Limiter cancel / unexpected — fill holes so the UI still has a report.
    for (let i = 0; i < total; i++) {
      if (!shots[i]) {
        shots[i] = {
          index: i,
          ok: false,
          status: 0,
          latencyMs: 0,
          error: e?.message || String(e),
        };
      }
    }
  } finally {
    limiter.cancel();
  }

  const list = shots.map((s, i) => s ?? {
    index: i, ok: false, status: 0, latencyMs: 0, error: "missing",
  });
  const succeeded = list.filter((s) => s.ok).length;
  const rateLimitedCount = list.filter((s) => s.status === 429).length;
  const failedCount = list.filter((s) => !s.ok && s.status !== 429).length;

  return {
    ok: succeeded === total,
    rateLimited: rateLimitedCount > 0,
    total,
    succeeded,
    rateLimitedCount,
    failedCount,
    elapsedMs: Date.now() - t0,
    concurrency,
    requestIntervalMs,
    rpm,
    shots: list,
  };
}

/** Accumulate assistant text from an OpenAI-style SSE body, stop at [DONE]/ max bytes. */
async function readSsePreview(body: ReadableStream<Uint8Array>): Promise<string> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let out = "";
  const deadline = Date.now() + 25_000;
  try {
    while (Date.now() < deadline) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      // Process complete SSE frames (blank-line separated).
      for (;;) {
        const sep = buf.indexOf("\n\n");
        if (sep < 0) break;
        const frame = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        for (const line of frame.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (!payload || payload === "[DONE]") {
            if (payload === "[DONE]") return out;
            continue;
          }
          try {
            const j = JSON.parse(payload);
            if (j?.error?.message) throw new Error(String(j.error.message));
            const delta = j?.choices?.[0]?.delta?.content
              ?? j?.choices?.[0]?.message?.content
              ?? "";
            if (typeof delta === "string" && delta) out += delta;
          } catch (e: any) {
            if (e instanceof SyntaxError) continue;
            throw e;
          }
        }
        // Enough to prove the stream works.
        if (out.length >= 8) {
          try { await reader.cancel(); } catch {}
          return out;
        }
      }
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }
  return out;
}
