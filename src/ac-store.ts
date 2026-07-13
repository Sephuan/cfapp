// Long-term store of per-contest AC info, persisted to disk so the
// contest list can show "x/y solved" badges even before any my-status
// fetch on this session, and so AC markers survive CF rate-limiting.
//
// SCOPED BY HANDLE. Solve data belongs to one account — the old v1 format
// keyed only by contestId, so switching accounts (or a mis-detected login)
// leaked one user's solves into another's contest list. v2 buckets every
// contest under the handle it was observed for.
//
// Format: ~/.config/cfapp/ac-status.json
// {
//   version: 2,
//   handles: {
//     "tourist": { contests: { "2236": { byIndex: {...}, problemCount, updatedAt } } }
//   }
// }
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { configDir } from "./paths";

export type Verdict = "AC" | "WA";
export interface ContestAcEntry {
  byIndex: Record<string, Verdict>;
  problemCount?: number;
  updatedAt: number;
}
interface HandleBucket {
  contests: Record<string, ContestAcEntry>;
}
interface AcStoreFile {
  version: 2;
  handles: Record<string, HandleBucket>;
}

// Path is overridable via CFAPP_AC_STORE_FILE so tests don't clobber the real
// user store. Resolved per-call (not cached) so a test can point it at a temp
// file before exercising the store.
function storeFile(): string {
  return process.env.CFAPP_AC_STORE_FILE
    || join(configDir(), "ac-status.json");
}

function emptyStore(): AcStoreFile {
  return { version: 2, handles: {} };
}

function readFile(): AcStoreFile {
  try {
    if (!existsSync(storeFile())) return emptyStore();
    const parsed = JSON.parse(readFileSync(storeFile(), "utf-8"));
    if (!parsed || typeof parsed !== "object") return emptyStore();
    // v1 (flat, contestId-keyed) data is not handle-scoped and therefore
    // cannot be trusted — it may mix multiple accounts. Drop it and start
    // clean; the badges repopulate as the user browses under the right handle.
    if (parsed.version !== 2 || typeof parsed.handles !== "object") return emptyStore();
    return { version: 2, handles: parsed.handles ?? {} };
  } catch {
    return emptyStore();
  }
}

function writeFile(data: AcStoreFile): void {
  try {
    mkdirSync(dirname(storeFile()), { recursive: true });
    writeFileSync(storeFile(), JSON.stringify(data, null, 2));
  } catch {
    // best effort
  }
}

// Normalize the handle used as a bucket key. CF treats handles
// case-insensitively for lookup; lowercasing keeps "Tourist" and "tourist"
// in the same bucket. Empty/unknown handle falls into the "" bucket, which
// never collides with a real account.
function key(handle: string | null | undefined): string {
  return (handle ?? "").trim().toLowerCase();
}

function bucket(data: AcStoreFile, handle: string): HandleBucket {
  const k = key(handle);
  return (data.handles[k] ??= { contests: {} });
}

export function loadContestAc(handle: string, contestId: number): ContestAcEntry | null {
  const data = readFile();
  return data.handles[key(handle)]?.contests[String(contestId)] ?? null;
}

// Merge fresh verdicts into the on-disk record for this handle. AC sticks —
// once a problem is AC, a later WA observation doesn't downgrade it.
export function mergeContestAc(
  handle: string,
  contestId: number,
  byIndex: Record<string, Verdict>,
  problemCount?: number,
): ContestAcEntry {
  const data = readFile();
  const b = bucket(data, handle);
  const cid = String(contestId);
  const prev = b.contests[cid] ?? { byIndex: {}, updatedAt: 0 };
  const next: Record<string, Verdict> = { ...prev.byIndex };
  for (const [idx, v] of Object.entries(byIndex)) {
    if (v === "AC") next[idx] = "AC";
    else if (next[idx] !== "AC") next[idx] = v;
  }
  const entry: ContestAcEntry = {
    byIndex: next,
    problemCount: problemCount ?? prev.problemCount,
    updatedAt: Date.now(),
  };
  b.contests[cid] = entry;
  writeFile(data);
  return entry;
}

// Record the total problem count for a contest under this handle (called when
// the problems list endpoint runs). Doesn't touch byIndex.
export function recordProblemCount(handle: string, contestId: number, problemCount: number): void {
  const data = readFile();
  const b = bucket(data, handle);
  const cid = String(contestId);
  const prev = b.contests[cid] ?? { byIndex: {}, updatedAt: 0 };
  b.contests[cid] = { ...prev, problemCount, updatedAt: Date.now() };
  writeFile(data);
}

// Bulk-merge many contests' verdicts for one handle in a single read+write.
// Used by the "sync all solves" pull (user.status) so populating hundreds of
// contests from the full submission history doesn't re-read/write the JSON per
// contest. Same AC-sticks rule as mergeContestAc; existing problemCount totals
// are preserved.
export function mergeContestAcBulk(
  handle: string,
  byContest: Record<string, Record<string, Verdict>>,
): void {
  const data = readFile();
  const b = bucket(data, handle);
  const now = Date.now();
  for (const [cid, byIndex] of Object.entries(byContest)) {
    const prev = b.contests[cid] ?? { byIndex: {}, updatedAt: 0 };
    const next: Record<string, Verdict> = { ...prev.byIndex };
    for (const [idx, v] of Object.entries(byIndex)) {
      if (v === "AC") next[idx] = "AC";
      else if (next[idx] !== "AC") next[idx] = v;
    }
    b.contests[cid] = { byIndex: next, problemCount: prev.problemCount, updatedAt: now };
  }
  writeFile(data);
}

// For the contest list: per-contest summary { ac, total } for this handle.
// Only includes contests we have any data for.
export function loadAcSummary(handle: string): Record<string, { ac: number; total: number }> {
  const data = readFile();
  const contests = data.handles[key(handle)]?.contests ?? {};
  const out: Record<string, { ac: number; total: number }> = {};
  for (const [cid, entry] of Object.entries(contests)) {
    let ac = 0;
    for (const v of Object.values(entry.byIndex)) if (v === "AC") ac++;
    const total = entry.problemCount ?? 0;
    if (ac > 0 || total > 0) out[cid] = { ac, total };
  }
  return out;
}
