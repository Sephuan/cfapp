// CF rating tier classification. Pure function with zero imports (no fs, no
// network) so it is safe to pull into the BROWSER bundle — unlike the main
// api barrel (src/api/index.ts), which re-exports fs-using modules
// (cache.ts, cookie.ts) and must never be runtime-imported by client code.
//
// Mirrors the official Codeforces rating scheme. Kept here as the single
// source of truth: the server (cf-api.ts) and the client (StatsPage.tsx)
// both import from this module.
export type RatingTier =
  | "unrated" | "newbie" | "pupil" | "specialist" | "expert"
  | "candidate" | "master" | "international-master" | "grandmaster"
  | "international-grandmaster" | "legendary-grandmaster";

export function ratingTier(rating: number | null | undefined): RatingTier {
  if (rating == null || rating < 0) return "unrated";
  if (rating < 1200) return "newbie";
  if (rating < 1400) return "pupil";
  if (rating < 1600) return "specialist";
  if (rating < 1900) return "expert";
  if (rating < 2100) return "candidate";
  if (rating < 2300) return "master";
  if (rating < 2400) return "international-master";
  if (rating < 2600) return "grandmaster";
  if (rating < 3000) return "international-grandmaster";
  return "legendary-grandmaster";
}
