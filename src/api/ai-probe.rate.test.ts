import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { probeAiRateLimit } from "./ai-probe";

// Mock global fetch for rate-limit probe: controllable status sequence.

const originalFetch = globalThis.fetch;

describe("probeAiRateLimit", () => {
  let statuses: number[] = [];
  let callTimes: number[] = [];

  beforeEach(() => {
    statuses = [];
    callTimes = [];
    globalThis.fetch = mock(async () => {
      callTimes.push(Date.now());
      const status = statuses.shift() ?? 200;
      if (status === 200) {
        return new Response(JSON.stringify({
          choices: [{ message: { content: "pong" } }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(`err ${status}`, { status });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("all ok → ok and not rateLimited", async () => {
    statuses = [200, 200, 200, 200];
    const r = await probeAiRateLimit({
      baseUrl: "https://example.test/v1",
      apiKey: "k",
      model: "m",
      concurrency: 2,
      requestIntervalMs: 20,
      rpm: 0,
      count: 4,
    });
    expect(r.total).toBe(4);
    expect(r.succeeded).toBe(4);
    expect(r.ok).toBe(true);
    expect(r.rateLimited).toBe(false);
    expect(r.rateLimitedCount).toBe(0);
  });

  test("any 429 → rateLimited", async () => {
    statuses = [200, 429, 200, 429];
    const r = await probeAiRateLimit({
      baseUrl: "https://example.test/v1",
      apiKey: "k",
      model: "m",
      concurrency: 2,
      requestIntervalMs: 10,
      rpm: 0,
      count: 4,
    });
    expect(r.ok).toBe(false);
    expect(r.rateLimited).toBe(true);
    expect(r.rateLimitedCount).toBe(2);
    expect(r.succeeded).toBe(2);
  });

  test("empty creds → error, total 0", async () => {
    const r = await probeAiRateLimit({
      baseUrl: "",
      apiKey: "k",
      model: "m",
      concurrency: 1,
      requestIntervalMs: 0,
      count: 2,
    });
    expect(r.total).toBe(0);
    expect(r.error).toMatch(/Base URL/i);
  });

  test("respects start interval while filling concurrency", async () => {
    statuses = [200, 200, 200];
    const r = await probeAiRateLimit({
      baseUrl: "https://example.test/v1",
      apiKey: "k",
      model: "m",
      concurrency: 3,
      requestIntervalMs: 80,
      rpm: 0,
      count: 3,
    });
    expect(r.ok).toBe(true);
    expect(callTimes.length).toBe(3);
    // #2 and #3 should be spaced ~80ms from previous starts.
    expect(callTimes[1]! - callTimes[0]!).toBeGreaterThanOrEqual(60);
    expect(callTimes[2]! - callTimes[1]!).toBeGreaterThanOrEqual(60);
  });
});
