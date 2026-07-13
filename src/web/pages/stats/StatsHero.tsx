import { useMemo } from "react";
import type { RatingChange, UserSubmission } from "../../../api";
import type { UserMe } from "../../shared";
import { tierColor } from "./utils";
import { Avatar } from "./Avatar";

// Full-width banner with avatar + handle (tier-colored) + rating + meta.
export function StatsHero({ userInfo, ratingHistory, submissions }: {
  userInfo: UserMe | null;
  ratingHistory: RatingChange[];
  submissions: UserSubmission[];
}) {
  if (!userInfo) return null;
  const rating = userInfo.rating;
  const maxRating = userInfo.maxRating ?? ratingHistory.reduce((m, c) => Math.max(m, c.newRating), 0);
  const color = tierColor(rating);
  const maxColor = tierColor(maxRating);
  const solved = useMemo(
    () => new Set(submissions.filter(s => s.verdict === "OK").map(s => `${s.problem.contestId}-${s.problem.index}`)).size,
    [submissions],
  );

  const initials = userInfo.handle.slice(0, 2).toUpperCase();
  return (
    <div className="stats-hero">
      <div className="stats-hero-glow" style={{ background: `radial-gradient(circle at 25% 30%, ${color}26, transparent 70%)` }} />
      <div className="stats-hero-inner">
        <div className="stats-avatar" style={{ borderColor: color, boxShadow: `0 0 0 3px ${color}33` }}>
          <Avatar url={userInfo.avatar} initials={initials} color={color} />
        </div>
        <div className="stats-hero-main">
          <div className="stats-hero-handle-row">
            <span className="stats-hero-handle" style={{ color }}>{userInfo.handle}</span>
            {userInfo.rank && <span className="stats-hero-rank">{userInfo.rank}</span>}
          </div>
          <div className="stats-hero-numbers">
            {rating != null && (
              <div className="stats-hero-num">
                <span className="num-value" style={{ color }}>{rating}</span>
                <span className="num-label">rating</span>
              </div>
            )}
            {maxRating != null && maxRating > 0 && maxRating !== rating && (
              <div className="stats-hero-num">
                <span className="num-value" style={{ color: maxColor }}>{maxRating}</span>
                <span className="num-label">max</span>
              </div>
            )}
            <div className="stats-hero-num">
              <span className="num-value">{ratingHistory.length}</span>
              <span className="num-label">rated contests</span>
            </div>
            <div className="stats-hero-num">
              <span className="num-value">{solved}</span>
              <span className="num-label">solved</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
