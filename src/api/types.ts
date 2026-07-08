// Shared types for the Codeforces API client. Keeping every interface in one
// place makes the cross-module contracts easy to scan.
import type { CFConfig } from "../config";

export interface SavedCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
}

export interface SavedCookieFile {
  version: 1;
  savedAt: number;
  source: string;
  userAgent?: string;
  cookies: SavedCookie[];
}

// Bun's fetch accepts a few non-standard keys on RequestInit (proxy, tls).
export type BunFetchInit = RequestInit & {
  proxy?: string;
  tls?: { rejectUnauthorized?: boolean };
};

export interface Contest {
  id: number;
  name: string;
  phase: string;
  durationSeconds: number;
  startTimeSeconds: number;
  type: string;
}

export interface Problem {
  contestId: number;
  index: string;
  name: string;
  type: string;
  points: number;
  tags: string[];
  rating: number;
}

export interface RanklistRow {
  rank: number;
  handle: string;
  points: number;
  penalty: number;
  problemResults: {
    points: number;
    rejectedAttemptCount: number;
    type: string;
  }[];
}

export interface Standings {
  contest: Contest;
  problems: Problem[];
  rows: RanklistRow[];
  totalRows: number;
}

export interface SubmissionResult {
  id: number;
  contestId: number;
  problemIndex: string;
  verdict: string;
  passedTestCount: number;
  timeConsumedMillis: number;
  memoryConsumedBytes: number;
  programmingLanguage: string;
  creationTimeSeconds: number;
}

// Per-contest verdict map for the configured handle.
export interface MyContestStatus {
  byIndex: Record<string, "AC" | "WA">;
}

export interface UserInfo {
  handle: string;
  rating: number | null;
  maxRating: number | null;
  rank: string | null;
  maxRank: string | null;
  avatar: string | null;
}

export interface StatementJSON {
  title: string;
  timeLimit: string;
  memoryLimit: string;
  statementHtml: string;
  inputHtml: string;
  outputHtml: string;
  samples: { input: string; output: string }[];
  noteHtml: string;
}

// Full submission record from user.status — richer than SubmissionResult
// (carries the problem's rating + tags), used for the stats page.
export interface UserSubmission {
  id: number;
  contestId: number;
  problem: { contestId: number; index: string; name: string; rating?: number; tags: string[] };
  verdict: string;
  passedTestCount: number;
  timeConsumedMillis: number;
  memoryConsumedBytes: number;
  programmingLanguage: string;
  creationTimeSeconds: number;
}

// A single rating-change event from user.rating.
export interface RatingChange {
  contestId: number;
  contestName: string;
  rank: number;
  ratingUpdateTimeSeconds: number;
  oldRating: number;
  newRating: number;
}

// Re-export so callers that imported CFConfig from ./api keep compiling.
export type { CFConfig };
