import type { Contest, Problem } from "../api";

export type Route =
  | { kind: "contests" }
  | { kind: "problems"; contest: Contest }
  | { kind: "problem"; contest: Contest; problem: Problem }
  | { kind: "settings" }
  | { kind: "stats" };

export type BottomTab = "submit" | "standings" | "mysubs" | "login";

export type UserMe = {
  handle: string;
  rating: number | null;
  maxRating: number | null;
  rank: string | null;
  avatar?: string | null;
  tier:
    | "unrated" | "newbie" | "pupil" | "specialist" | "expert"
    | "candidate" | "master" | "international-master" | "grandmaster"
    | "international-grandmaster" | "legendary-grandmaster";
};

export type AppConfig = {
  handle: string;
  apiKey: string;
  apiSecret: string;
  password: string;
  proxy: string;
  verifySsl: boolean;
  ai: { baseUrl: string; apiKey: string; model: string };
};

export const TIER_COLOR: Record<UserMe["tier"], string> = {
  "unrated": "#9ca3af",
  "newbie": "#9ca3af",
  "pupil": "#10b981",
  "specialist": "#06b6d4",
  "expert": "#3b82f6",
  "candidate": "#a855f7",
  "master": "#f59e0b",
  "international-master": "#f59e0b",
  "grandmaster": "#ef4444",
  "international-grandmaster": "#ef4444",
  "legendary-grandmaster": "#dc2626",
};

export type CfFrameHandle = {
  back: () => void;
  forward: () => void;
  canGoBack: () => boolean;
  canGoForward: () => boolean;
  reload: () => void;
  loadURL: (u: string) => void;
  injectCode: (code: string, problemIndex: string, langId?: number) => void;
  setZoom: (z: number) => void;
  getZoom: () => number;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomReset: () => void;
  getWebview: () => any;
};
