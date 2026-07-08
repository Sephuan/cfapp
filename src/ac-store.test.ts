// Regression tests for the handle-scoped AC store. The bug this pins: the old
// v1 store keyed solve data by contestId only, so one account's "5/6 solved"
// leaked into another account's contest list (seen after a mis-detected login
// resolved to a stranger's handle). v2 buckets by handle; these tests assert
// that two handles never see each other's data and that legacy v1 files are
// discarded rather than shown under the wrong account.
import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let dir: string;
let file: string;
// Import lazily inside tests via a fresh require each time isn't needed —
// the module reads storeFile() per call, so setting the env before each call
// is enough. We import once here.
import { mergeContestAc, mergeContestAcBulk, loadAcSummary, loadContestAc, recordProblemCount } from "./ac-store";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cfapp-acstore-"));
  file = join(dir, "ac-status.json");
  process.env.CFAPP_AC_STORE_FILE = file;
});
afterEach(() => {
  delete process.env.CFAPP_AC_STORE_FILE;
  rmSync(dir, { recursive: true, force: true });
});

describe("ac-store handle scoping", () => {
  test("two handles do not see each other's solves", () => {
    mergeContestAc("alice", 1105, { A: "AC", B: "AC" }, 6);
    mergeContestAc("bob", 1105, { A: "AC" }, 6);

    expect(loadAcSummary("alice")["1105"]).toEqual({ ac: 2, total: 6 });
    expect(loadAcSummary("bob")["1105"]).toEqual({ ac: 1, total: 6 });
    // A third, never-seen handle sees nothing for this contest.
    expect(loadAcSummary("carol")["1105"]).toBeUndefined();
  });

  test("handle lookup is case-insensitive", () => {
    mergeContestAc("Tourist", 2000, { A: "AC" }, 3);
    expect(loadContestAc("tourist", 2000)?.byIndex).toEqual({ A: "AC" });
    expect(loadAcSummary("TOURIST")["2000"]).toEqual({ ac: 1, total: 3 });
  });

  test("AC sticks; a later WA never downgrades it", () => {
    mergeContestAc("alice", 1200, { A: "AC" });
    mergeContestAc("alice", 1200, { A: "WA" });
    expect(loadContestAc("alice", 1200)?.byIndex.A).toBe("AC");
  });

  test("recordProblemCount populates total without touching verdicts", () => {
    mergeContestAc("alice", 1300, { A: "AC" });
    recordProblemCount("alice", 1300, 5);
    expect(loadAcSummary("alice")["1300"]).toEqual({ ac: 1, total: 5 });
  });

  test("legacy v1 (flat, contestId-keyed) data is discarded, not mis-attributed", () => {
    // Simulate the polluted store: maroonrk's solves keyed by contestId with no
    // handle. Under v2 this must NOT surface for any account.
    const v1 = { version: 1, contests: { "1105": { byIndex: { A: "AC", B: "AC", C: "AC", D: "AC", E: "AC" }, problemCount: 6, updatedAt: 1 } } };
    writeFileSync(file, JSON.stringify(v1));
    expect(loadAcSummary("alice")["1105"]).toBeUndefined();
    expect(loadAcSummary("")["1105"]).toBeUndefined();
    expect(loadContestAc("alice", 1105)).toBeNull();
  });

  test("empty/unknown handle uses its own bucket, never a real account's", () => {
    mergeContestAc("", 1400, { A: "AC" }, 2);
    mergeContestAc("alice", 1400, { A: "AC", B: "AC" }, 2);
    expect(loadAcSummary("")["1400"]).toEqual({ ac: 1, total: 2 });
    expect(loadAcSummary("alice")["1400"]).toEqual({ ac: 2, total: 2 });
  });

  test("mergeContestAcBulk folds many contests and preserves totals/AC-stick", () => {
    // Pre-existing total (from a prior problems-page visit) must survive a bulk
    // sync, and a bulk WA must not downgrade an existing AC.
    recordProblemCount("alice", 1105, 6);
    mergeContestAc("alice", 1105, { A: "AC" });
    mergeContestAcBulk("alice", {
      "1105": { A: "WA", B: "AC" },       // A already AC → stays AC; B new AC
      "2000": { A: "AC", B: "AC", C: "WA" },
      "3000": { A: "WA" },
    });
    expect(loadAcSummary("alice")["1105"]).toEqual({ ac: 2, total: 6 }); // total kept
    expect(loadContestAc("alice", 1105)?.byIndex.A).toBe("AC");
    expect(loadAcSummary("alice")["2000"]).toEqual({ ac: 2, total: 0 }); // no total yet → "x/?"
    expect(loadAcSummary("alice")["3000"]).toBeUndefined();             // only WA, no total → hidden
    // Bulk writes go to the named handle only.
    expect(loadAcSummary("bob")["2000"]).toBeUndefined();
  });
});
