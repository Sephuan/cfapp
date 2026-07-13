import { test, expect, describe } from "bun:test";
import { createRateLimiter } from "./auto-translate";

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

describe("createRateLimiter — interval between starts", () => {
  test("starts are spaced by intervalMs while filling concurrency", async () => {
    const lim = createRateLimiter(50, 3, 0);
    const starts: number[] = [];
    const t0 = Date.now();
    // Long tasks so none finish while we fill 3 slots.
    const jobs = [1, 2, 3].map((i) =>
      lim.run(async () => {
        starts.push(Date.now() - t0);
        await sleep(300);
        return i;
      }),
    );
    await sleep(200); // enough for 3 starts at 50ms gaps
    expect(starts.length).toBe(3);
    expect(starts[0]!).toBeLessThan(30);
    expect(starts[1]!).toBeGreaterThanOrEqual(40);
    expect(starts[2]!).toBeGreaterThanOrEqual(90);
    lim.cancel();
    await Promise.all(jobs.map((j) => j.catch(() => {})));
  });

  test("after a finish, waits a full interval before starting the next", async () => {
    // concurrency=3, interval=100: fill #1#2#3, each runs 500ms.
    // Old bug: #4 started at ~500 (same ms as #1 done) because interval since
    // #3's start at 200 already elapsed. Desired: #1 done → wait 100 → #4.
    const lim = createRateLimiter(100, 3, 0);
    const starts: number[] = [];
    const t0 = Date.now();
    const jobs = [1, 2, 3, 4, 5].map((i) =>
      lim.run(async () => {
        starts.push(Date.now() - t0);
        await sleep(500);
        return i;
      }),
    );
    await Promise.all(jobs);
    expect(starts.length).toBe(5);
    // Fill phase
    expect(starts[0]!).toBeLessThan(30);
    expect(starts[1]!).toBeGreaterThanOrEqual(90);
    expect(starts[2]!).toBeGreaterThanOrEqual(190);
    // #1 done ~500 → #4 after another full interval
    expect(starts[3]!).toBeGreaterThanOrEqual(580);
    // #2 done ~600-ish + interval, or after #4 start + interval
    expect(starts[4]!).toBeGreaterThanOrEqual(starts[3]! + 90);
  });
});

describe("createRateLimiter — RPM rolling window", () => {
  test("rpm caps total starts per minute without replacing interval", async () => {
    // rpm=2: only two starts allowed in the window; interval small so RPM is the gate.
    const lim = createRateLimiter(10, 5, 2);
    const starts: number[] = [];
    const jobs = [1, 2, 3].map((i) =>
      lim.run(async () => {
        starts.push(Date.now());
        await sleep(5);
        return i;
      }).catch((e: Error) => e.message),
    );
    await sleep(80);
    expect(starts.length).toBe(2);
    // Third still queued (would need ~60s for window); cancel instead of waiting a minute.
    lim.cancel();
    const settled = await Promise.all(jobs);
    expect(starts.length).toBe(2);
    expect(settled.filter((x) => x === "cancelled").length).toBe(1);
  });

  test("rpm=0 means unlimited", async () => {
    const lim = createRateLimiter(0, 10, 0);
    const n = 8;
    const results = await Promise.all(
      Array.from({ length: n }, (_, i) => lim.run(async () => i)),
    );
    expect(results).toEqual([...Array(n).keys()]);
  });
});

describe("createRateLimiter — cancel", () => {
  test("cancel rejects queued tasks", async () => {
    const lim = createRateLimiter(0, 1, 0);
    let gate!: () => void;
    const opened = new Promise<void>((r) => { gate = r; });
    const first = lim.run(async () => {
      await opened;
      return "ok";
    });
    const second = lim.run(async () => "never").catch((e: Error) => e.message);
    lim.cancel();
    gate();
    await expect(first).resolves.toBe("ok");
    await expect(second).resolves.toBe("cancelled");
  });
});

describe("createRateLimiter — FIFO dispatch order", () => {
  test("starts in enqueue order even when later tasks finish first", async () => {
    const lim = createRateLimiter(20, 2, 0);
    const starts: string[] = [];
    const done: string[] = [];
    const jobs = [
      lim.run(async () => { starts.push("A"); await sleep(80); done.push("A"); return "A"; }),
      lim.run(async () => { starts.push("B"); await sleep(10); done.push("B"); return "B"; }),
      lim.run(async () => { starts.push("C"); await sleep(10); done.push("C"); return "C"; }),
    ];
    await Promise.all(jobs);
    // Dispatch order is document/enqueue order.
    expect(starts).toEqual(["A", "B", "C"]);
    // Completion may differ (B before A).
    expect(done[0]).toBe("B");
  });
});
