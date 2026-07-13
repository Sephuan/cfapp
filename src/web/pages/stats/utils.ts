import { ratingTier } from "../../../api/tiers";
import { TIER_COLOR } from "../../shared";

export function tierColor(rating: number | null | undefined): string {
  return TIER_COLOR[ratingTier(rating) as keyof typeof TIER_COLOR] ?? "#9ca3af";
}

export function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
