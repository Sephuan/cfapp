import type { RatingChange, UserSubmission } from "../../api";
import type { UserMe } from "../shared";
import { useFetchJSON } from "../hooks";
import { StatsHero } from "./stats/StatsHero";
import { StatsCards } from "./stats/StatsCards";
import { RatingDistChart } from "./stats/RatingDistChart";
import { ActivityHeatmap } from "./stats/ActivityHeatmap";
import { VerdistDonut } from "./stats/VerdistDonut";
import { LangStats } from "./stats/LangStats";
import { RatingChart } from "./stats/RatingChart";
import { Panel } from "./stats/Panel";

// Stats data is large (up to 10k submissions) and rarely changes, so it gets a
// localStorage-backed 24h cache via the unified useFetchJSON hook.
const STATS_CACHE = { keyPrefix: "cfapp_stats_" };

export function StatsPage({ refreshTick }: { refreshTick: number }) {
  const { data: submissions, err: errS, loading: loadS } = useFetchJSON<UserSubmission[]>("/api/user/status", refreshTick, STATS_CACHE);
  const { data: ratingHistory, err: errR, loading: loadR } = useFetchJSON<RatingChange[]>("/api/user/rating-history", refreshTick, STATS_CACHE);
  const { data: userInfo } = useFetchJSON<UserMe>("/api/user/me", refreshTick, STATS_CACHE);

  // Only show loading screen when we have NO data at all.
  // If we have cached data, show it immediately (loading is just background refresh).
  if (!submissions && !ratingHistory && (loadS || loadR)) {
    return <div className="stats-page"><div className="stats-loading">Loading statistics…</div></div>;
  }

  // Only show auth error when we have no data to display
  const isAuthError = (errS || errR || "").includes("API key required");
  if (isAuthError && !submissions && !ratingHistory) {
    return (
      <div className="stats-page">
        <div className="stats-auth-card">
          <div className="stats-auth-icon">🔑</div>
          <h2>API Key Required</h2>
          <p>To view statistics, configure your Codeforces API credentials:</p>
          <ol>
            <li>Go to <a href="https://codeforces.com/settings/api" target="_blank" rel="noopener">codeforces.com/settings/api</a></li>
            <li>Generate an API Key and Secret</li>
            <li>Open <b>Settings</b> here and paste them</li>
          </ol>
        </div>
      </div>
    );
  }

  // Only show error when we have no data to display.
  // If we have cached data from a previous fetch, show it silently
  // (refresh errors from ?refresh=1 timeout are non-fatal).
  if ((errS || errR) && !submissions && !ratingHistory) return <div className="stats-page"><div className="stats-error">Error: {errS || errR}</div></div>;
  if (!submissions || !ratingHistory) return <div className="stats-page"><div className="stats-empty">No data available.</div></div>;

  return (
    <div className="stats-page">
      <StatsHero userInfo={userInfo} ratingHistory={ratingHistory} submissions={submissions} />
      <StatsCards submissions={submissions} />
      {/* Rating Distribution spans the full row: it can have ~30 bars and would
          otherwise blow out a half-width grid track and push its neighbour
          off-screen. The two compact charts (Verdicts + Languages) pair up. */}
      <Panel title="Rating Distribution" subtitle="solved problems by difficulty">
        <RatingDistChart submissions={submissions} />
      </Panel>
      <div className="stats-grid-2">
        <Panel title="Verdicts" subtitle="submission outcomes">
          <VerdistDonut submissions={submissions} />
        </Panel>
        <Panel title="Languages" subtitle="most-used tools">
          <LangStats submissions={submissions} />
        </Panel>
      </div>
      <Panel title="Activity" subtitle="daily submissions · last 12 months">
        <ActivityHeatmap submissions={submissions} />
      </Panel>
      <Panel title="Rating History" subtitle="rated contest progression">
        <RatingChart ratingHistory={ratingHistory} />
      </Panel>
    </div>
  );
}
