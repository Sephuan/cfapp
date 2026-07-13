// Dual-constraint request scheduler used by auto-translate.
//
// Two independent knobs (both must pass before a queued task starts):
//   1. min interval between consecutive *starts* (requestIntervalMs)
//   2. rolling 60s budget of starts (rpm) — not a fixed gap of 60000/rpm
//
// Start spacing (example concurrency=3, interval=100ms):
//   t=0   start #1
//   t=100 start #2   (interval after #1's start — does NOT wait for #1 to finish)
//   t=200 start #3
//   t≈500 #1 finishes → free a slot → wait another full interval →
//   t≈600 start #4
// So filling concurrent slots is start-spaced; replacing a finished slot also
// waits one interval after that finish (not "as soon as the previous start
// interval already elapsed").
//
// Example rpm=5: at most 5 starts in any sliding 60s window. After 5 fire in a
// burst, the next waits until the oldest of those 5 ages out of the window.
//
// Queue is FIFO: callers must enqueue in document order (offsets.end asc) so
// dispatch order is top-to-bottom (statement → input → output → note).
// Completion order is still network-bound; placement uses fixed offsets.
//
// cancel() rejects every not-yet-started task and marks the limiter dead so
// in-flight completions stop dispatching — used when the user navigates away
// mid-translation (the old problem's callbacks must not mutate the new one).

export type RateLimiter = {
  run: <T>(task: () => Promise<T>) => Promise<T>;
  cancel: () => void;
};

const RPM_WINDOW_MS = 60_000;

export function createRateLimiter(
  intervalMs: number,
  concurrency: number,
  rpm: number = 0,
): RateLimiter {
  const minInterval = Math.max(0, intervalMs);
  const maxConc = Math.max(1, concurrency);
  // 0 / negative / NaN → unlimited. Positive → hard cap on starts / 60s.
  const maxPerMinute = Number.isFinite(rpm) && rpm > 0 ? Math.floor(rpm) : 0;
  let inFlight = 0;
  // Last time we either *started* a request or a request *finished*. Next start
  // must be ≥ minInterval after this — covers both "gap between starts while
  // filling slots" and "after #1 ends, wait interval before #4".
  let lastGateAt = 0;
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let timerScheduled = false;
  // Timestamps of recent starts for the RPM sliding window.
  const startTimes: number[] = [];
  type Queued = { task: () => Promise<unknown>; resolve: (v: unknown) => void; reject: (e: unknown) => void };
  const queue: Queued[] = [];

  // Absolute timestamp when the pending retry should fire. Used so a later
  // tryDispatch that discovers an *earlier* ready time can replace the timer.
  let retryAt = 0;

  const clearTimer = () => {
    if (timer !== null) { clearTimeout(timer); timer = null; }
    timerScheduled = false;
    retryAt = 0;
  };

  const scheduleRetry = (waitMs: number) => {
    const wait = Math.max(1, waitMs);
    const at = Date.now() + wait;
    // Keep the soonest wake-up; ignore a later request that would only delay.
    if (timerScheduled && retryAt > 0 && at >= retryAt) return;
    if (timer !== null) clearTimeout(timer);
    timerScheduled = true;
    retryAt = at;
    timer = setTimeout(() => {
      timerScheduled = false;
      timer = null;
      retryAt = 0;
      tryDispatch();
    }, wait);
  };

  // Drop starts older than the 60s window; return ms until one slot frees, or 0
  // if under the RPM cap (or RPM disabled).
  const rpmWaitMs = (now: number): number => {
    if (maxPerMinute <= 0) return 0;
    while (startTimes.length > 0 && now - startTimes[0]! >= RPM_WINDOW_MS) {
      startTimes.shift();
    }
    if (startTimes.length < maxPerMinute) return 0;
    // At cap: free when the oldest start ages out of the window.
    return RPM_WINDOW_MS - (now - startTimes[0]!) + 1;
  };

  // Try to start as many queued tasks as slots + interval + RPM allow.
  // If blocked, schedule ONE precise timer for the soonest constraint.
  // Note: the while loop never starts more than one job per turn when
  // minInterval > 0, because starting sets lastGateAt = now and the next
  // iteration immediately sees wait > 0.
  const tryDispatch = () => {
    if (cancelled) return;
    while (queue.length > 0 && inFlight < maxConc) {
      const now = Date.now();
      let wait = 0;
      if (minInterval > 0 && lastGateAt > 0) {
        const elapsed = now - lastGateAt;
        if (elapsed < minInterval) wait = Math.max(wait, minInterval - elapsed);
      }
      wait = Math.max(wait, rpmWaitMs(now));
      if (wait > 0) {
        scheduleRetry(wait);
        return;
      }
      const job = queue.shift()!;
      inFlight++;
      lastGateAt = now;
      if (maxPerMinute > 0) startTimes.push(now);
      job.task()
        .then(job.resolve, job.reject)
        .finally(() => {
          inFlight--;
          // Slot freed: also re-arm the interval gate from *this completion*,
          // so #4 is not started immediately just because enough time already
          // passed since #3's start. User rule: free slot → wait interval → start.
          if (minInterval > 0) lastGateAt = Date.now();
          tryDispatch();
        });
    }
  };

  const run = <T>(task: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      if (cancelled) { reject(new Error("cancelled")); return; }
      queue.push({ task, resolve: resolve as (v: unknown) => void, reject });
      tryDispatch();
    });

  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    clearTimer();
    while (queue.length > 0) {
      const job = queue.shift()!;
      job.reject(new Error("cancelled"));
    }
  };

  return { run, cancel };
}
