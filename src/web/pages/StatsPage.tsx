import React, { useMemo, useState, useRef, useEffect, useLayoutEffect } from "react";
import type { RatingChange, UserSubmission } from "../../api";
// Runtime import from the fs-free tiers.ts module, NOT the api barrel — the
// barrel re-exports fs-using modules (cache.ts, cookie.ts) which would crash
// the browser bundle with "import_fs is not defined".
import { ratingTier } from "../../api/tiers";
import type { UserMe } from "../shared";
import { TIER_COLOR } from "../shared";
import { useFetchJSON } from "../hooks";

// Stats data is large (up to 10k submissions) and rarely changes, so it gets a
// localStorage-backed 24h cache via the unified useFetchJSON hook.
const STATS_CACHE = { keyPrefix: "cfapp_stats_" };

function tierColor(rating: number | null | undefined): string {
  return TIER_COLOR[ratingTier(rating) as keyof typeof TIER_COLOR] ?? "#9ca3af";
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ----- avatar -----
// Route the CF avatar through the local /api/avatar proxy: it fetches via the
// app's (proxy-aware) network path and caches the bytes to disk, so the avatar
// loads without a VPN and survives restarts. If even the proxy can't produce an
// image (disallowed host / offline first-ever load), fall back to initials.
function Avatar({ url, initials, color }: { url: string | null | undefined; initials: string; color: string }) {
  const [failed, setFailed] = useState(false);
  // Clear the failed flag whenever the URL changes: a transient error (e.g. the
  // very first load with the network down) must not pin us to initials for the
  // rest of the session once a working avatar URL / connectivity arrives.
  useEffect(() => { setFailed(false); }, [url]);
  if (!url || failed) return <span style={{ color }}>{initials}</span>;
  return (
    <img
      src={`/api/avatar?u=${encodeURIComponent(url)}`}
      alt=""
      className="stats-avatar-img"
      onError={() => setFailed(true)}
    />
  );
}

// ----- hero header -----
// Full-width banner with avatar + handle (tier-colored) + rating + meta.
// Replaces the flat two-column header with a rich, layered hero that reads
// like a Codeforces profile card but in the leather-book palette.
function StatsHero({ userInfo, ratingHistory, submissions }: {
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

// ----- KPI cards -----
// Four small cards. Each has an icon-ish header label, a big tabular number,
// and a subtle context line. The accent-color left edge gives the row rhythm.
function StatsCards({ submissions }: { submissions: UserSubmission[] }) {
  const acSubs = submissions.filter(s => s.verdict === "OK");
  const uniqueProblems = new Set(acSubs.map(s => `${s.problem.contestId}-${s.problem.index}`));
  const acRate = submissions.length > 0 ? (acSubs.length / submissions.length * 100) : 0;

  const streak = useMemo(() => {
    if (submissions.length === 0) return 0;
    const days = new Set(submissions.map(s => {
      const d = new Date(s.creationTimeSeconds * 1000);
      return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    }));
    const now = new Date();
    let count = 0;
    for (let i = 0; i < 365; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (days.has(key)) count++;
      else break;
    }
    return count;
  }, [submissions]);

  const cards = [
    { value: String(uniqueProblems.size), label: "Problems Solved", sub: `${acSubs.length} AC attempts`, accent: "var(--ok)" },
    { value: String(submissions.length), label: "Submissions", sub: "all time", accent: "var(--accent)" },
    { value: `${acRate.toFixed(1)}%`, label: "Acceptance", sub: acRate > 0 ? `${acSubs.length} of ${submissions.length}` : "—", accent: "var(--warn)" },
    { value: String(streak), label: "Day Streak", sub: streak > 0 ? "current" : "today", accent: "#a855f7" },
  ];

  return (
    <div className="stats-cards">
      {cards.map(c => (
        <div key={c.label} className="stat-card" style={{ ["--card-accent" as string]: c.accent }}>
          <div className="stat-card-label">{c.label}</div>
          <div className="stat-card-value">{c.value}</div>
          <div className="stat-card-sub">{c.sub}</div>
        </div>
      ))}
    </div>
  );
}

// ----- rating distribution (vertical bars) -----
// Each bar's height is proportional; color follows the official CF rating
// tier. Count sits above the bar, rating label below.
function RatingDistChart({ submissions }: { submissions: UserSubmission[] }) {
  const buckets = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of submissions) {
      if (s.verdict !== "OK" || !s.problem.rating) continue;
      const key = `${s.problem.rating}`;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => Number(a[0]) - Number(b[0]));
  }, [submissions]);

  if (buckets.length === 0) return (
    <div className="stats-empty">No rated problems solved yet — solve some rated problems to see your distribution.</div>
  );
  const max = Math.max(...buckets.map(b => b[1]));

  return (
    <div className="stats-bar-chart">
      {buckets.map(([rating, count]) => (
        <div key={rating} className="stats-bar-col">
          <div className="stats-bar-count">{count}</div>
          <div className="stats-bar-track">
            <div className="stats-bar" style={{
              height: `${(count / max) * 100}%`,
              background: tierColor(Number(rating)),
            }} />
          </div>
          <div className="stats-bar-label">{rating}</div>
        </div>
      ))}
    </div>
  );
}

// ----- activity heatmap (GitHub-style) -----
// ~1 year of daily submission counts. Month labels sit above, weekday labels
// (Mon/Wed/Fri) to the left. Color opacity scales with count; 4-step legend
// at the bottom-right.
function ActivityHeatmap({ submissions }: { submissions: UserSubmission[] }) {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [tipPos, setTipPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });

  // Clamp the tooltip fully inside the viewport on BOTH axes. This has to be
  // zoom-aware: the stats page zooms via `document.body.style.zoom`, under which
  // mouse coords (tip.x/y) and getBoundingClientRect() are in SCREEN space
  // (scaled), while offsetWidth and the CSS `left`/`top` we set are in LAYOUT
  // space (unscaled). Mixing them made the tooltip overflow at high zoom. So we
  // measure the real on-screen size with getBoundingClientRect(), derive the
  // zoom factor from rect.width/offsetWidth, clamp entirely in screen space
  // against innerWidth/innerHeight, then divide by zoom to get the layout-space
  // left/top the element actually uses. useLayoutEffect runs before paint → no
  // flicker.
  useLayoutEffect(() => {
    if (!tip || !tipRef.current) return;
    const el = tipRef.current;
    const rect = el.getBoundingClientRect();   // screen space (post-zoom)
    const w = rect.width, h = rect.height;
    const zoom = el.offsetWidth ? rect.width / el.offsetWidth : 1;
    const vw = window.innerWidth, vh = window.innerHeight;   // screen space
    const clamp = (v: number, size: number, max: number) => Math.max(8, Math.min(v, max - size - 8));
    // Prefer right/above the cursor; flip to left/below if it wouldn't fit.
    const rawLeft = tip.x + 12 + w > vw - 8 ? tip.x - 12 - w : tip.x + 12;
    const rawTop = tip.y - 34 < 8 ? tip.y + 20 : tip.y - 34;
    const screenLeft = clamp(rawLeft, w, vw);
    const screenTop = clamp(rawTop, h, vh);
    setTipPos({ left: screenLeft / zoom, top: screenTop / zoom });  // → layout space
  }, [tip]);

  const { grid, monthLabels, maxCount, weeks } = useMemo(() => {
    const dayCounts = new Map<string, number>();
    for (const s of submissions) {
      const d = new Date(s.creationTimeSeconds * 1000);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      dayCounts.set(key, (dayCounts.get(key) ?? 0) + 1);
    }

    const cells: { date: string; displayDate: string; count: number; week: number; day: number }[] = [];
    const now = new Date();
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 363);
    startDate.setDate(startDate.getDate() - startDate.getDay());

    const monthLabels: { week: number; label: string }[] = [];
    let lastMonth = -1;
    const current = new Date(startDate);
    let week = 0;
    while (current <= now) {
      const key = `${current.getFullYear()}-${current.getMonth()}-${current.getDate()}`;
      const displayDate = current.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      cells.push({ date: key, displayDate, count: dayCounts.get(key) ?? 0, week, day: current.getDay() });
      // Emit a month label when the month changes at the start of a week (day 0).
      if (current.getDay() === 0 && current.getMonth() !== lastMonth) {
        monthLabels.push({ week, label: current.toLocaleDateString("en-US", { month: "short" }) });
        lastMonth = current.getMonth();
      }
      if (current.getDay() === 6) week++;
      current.setDate(current.getDate() + 1);
    }
    return { grid: cells, monthLabels, maxCount: Math.max(...cells.map(c => c.count), 1), weeks: week + 1 };
  }, [submissions]);

  // 4-step quantized legend colors.
  const stepColor = (count: number): string => {
    if (count === 0) return "var(--stats-heat-0)";
    const ratio = count / maxCount;
    if (ratio <= 0.25) return "var(--stats-heat-1)";
    if (ratio <= 0.5) return "var(--stats-heat-2)";
    if (ratio <= 0.75) return "var(--stats-heat-3)";
    return "var(--stats-heat-4)";
  };

  return (
    <div className="stats-heatmap-wrap">
      <div className="stats-heatmap-scroll">
        {/* Month grid uses the SAME column template as the cell grid below so
            each label sits exactly above the week column it marks. */}
        <div className="stats-heatmap-months" style={{ gridTemplateColumns: `repeat(${weeks}, 14px)` }}>
          {monthLabels.map(m => (
            <span key={m.week} style={{ gridColumn: `${m.week + 1} / span 1` }}>{m.label}</span>
          ))}
        </div>
        <div className="stats-heatmap-body">
          <div className="stats-heatmap-weekdays">
            <span>Mon</span><span>Wed</span><span>Fri</span>
          </div>
          <div className="stats-heatmap" style={{ gridTemplateColumns: `repeat(${weeks}, 14px)` }}>
            {grid.map((cell, i) => (
              <div
                key={i}
                className="stats-heat-cell"
                style={{ background: stepColor(cell.count) }}
                onMouseEnter={e => setTip({ x: e.clientX, y: e.clientY, text: `${cell.displayDate}: ${cell.count} submission${cell.count === 1 ? "" : "s"}` })}
                onMouseLeave={() => setTip(null)}
              />
            ))}
          </div>
        </div>
        <div className="stats-heatmap-legend">
          <span className="legend-text">Less</span>
          <span className="legend-chip" style={{ background: "var(--stats-heat-0)" }} />
          <span className="legend-chip" style={{ background: "var(--stats-heat-1)" }} />
          <span className="legend-chip" style={{ background: "var(--stats-heat-2)" }} />
          <span className="legend-chip" style={{ background: "var(--stats-heat-3)" }} />
          <span className="legend-chip" style={{ background: "var(--stats-heat-4)" }} />
          <span className="legend-text">More</span>
        </div>
      </div>
      {tip && (
        <div ref={tipRef} className="stats-heat-tip" style={{ left: tipPos.left, top: tipPos.top }}>
          {tip.text}
        </div>
      )}
    </div>
  );
}

// ----- verdict donut -----
// conic-gradient ring with a hole; center shows AC count. Legend to the right
// with absolute counts + percentages. Uses the official CF verdict colors.
const VERDICT_COLORS: Record<string, string> = {
  OK: "#10b981", WRONG_ANSWER: "#ef4444", TIME_LIMIT_EXCEEDED: "#f59e0b",
  RUNTIME_ERROR: "#e879f9", COMPILATION_ERROR: "#a78bfa",
  MEMORY_LIMIT_EXCEEDED: "#06b6d4", IDLENESS_LIMIT_EXCEEDED: "#f472b6",
  CHALLENGED: "#78716c",
};

function VerdistDonut({ submissions }: { submissions: UserSubmission[] }) {
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of submissions) {
      const v = s.verdict || "OTHER";
      map.set(v, (map.get(v) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [submissions]);

  if (counts.length === 0) return <div className="stats-empty">No submissions yet.</div>;

  const total = counts.reduce((s, [, c]) => s + c, 0);
  const top = counts.slice(0, 6);
  const other = total - top.reduce((s, [, c]) => s + c, 0);
  const slices = other > 0 ? [...top, ["OTHER", other] as [string, number]] : top;

  let accum = 0;
  const gradient = slices.map(([v, c]) => {
    const start = (accum / total) * 360;
    accum += c;
    const end = (accum / total) * 360;
    const color = VERDICT_COLORS[v] ?? "#6b7280";
    return `${color} ${start}deg ${end}deg`;
  }).join(", ");

  const acCount = counts.find(([v]) => v === "OK")?.[1] ?? 0;

  return (
    <div className="stats-donut-row">
      <div className="stats-donut" style={{ background: `conic-gradient(${gradient})` }}>
        <div className="stats-donut-hole">
          <div className="stats-donut-center-num">{acCount}</div>
          <div className="stats-donut-center-label">AC</div>
        </div>
      </div>
      <div className="stats-donut-legend">
        {slices.map(([v, c]) => (
          <div key={v} className="stats-legend-item">
            <span className="stats-legend-dot" style={{ background: VERDICT_COLORS[v] ?? "#6b7280" }} />
            <span className="stats-legend-name">{v.replace(/_/g, " ").toLowerCase().replace(/^\w/, ch => ch.toUpperCase())}</span>
            <span className="stats-legend-bar-wrap">
              <span className="stats-legend-bar" style={{ width: `${(c / total) * 100}%`, background: VERDICT_COLORS[v] ?? "#6b7280" }} />
            </span>
            <span className="stats-legend-count">{c}</span>
            <span className="stats-legend-pct">{(c / total * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ----- language usage (horizontal bars) -----
function LangStats({ submissions }: { submissions: UserSubmission[] }) {
  const langs = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of submissions) {
      const lang = s.programmingLanguage || "Unknown";
      map.set(lang, (map.get(lang) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [submissions]);

  if (langs.length === 0) return <div className="stats-empty">No submissions yet.</div>;
  const max = langs[0]![1];

  return (
    <div className="stats-lang-list">
      {langs.map(([lang, count], i) => (
        <div key={lang} className="stats-lang-row">
          <span className="stats-lang-rank">{i + 1}</span>
          <span className="stats-lang-name" title={lang}>{lang}</span>
          <div className="stats-lang-bar">
            <div className="stats-lang-fill" style={{ width: `${(count / max) * 100}%` }} />
          </div>
          <span className="stats-lang-count">{count}</span>
        </div>
      ))}
    </div>
  );
}

// ----- rating history (interactive line chart) -----
// A redesign of the old flat polyline. Adds the things a rating graph needs to
// be readable and explorable:
//   • CF tier bands behind the curve (newbie…LGM) for instant context;
//   • a numeric Y axis (rating gridlines) + a time X axis (date ticks);
//   • responsive width (fills the panel) with a Y scale that auto-fits the
//     *visible* window, so a long calm stretch isn't squashed into a flat line;
//   • hover → crosshair + a tooltip with contest name, rank, old→new, Δ;
//   • zoom: preset time ranges (All/5y/2y/1y/6m) AND drag-to-select on the plot;
//     "All" resets. The Y scale re-fits whenever the window changes.
const TIER_STOPS = [0, 1200, 1400, 1600, 1900, 2100, 2300, 2400, 2600, 3000, 4500];
const YEAR = 365 * 86400;
const ZOOM_PRESETS: { label: string; span: number | null }[] = [
  { label: "全部", span: null },
  { label: "5年", span: 5 * YEAR },
  { label: "2年", span: 2 * YEAR },
  { label: "1年", span: 1 * YEAR },
  { label: "6月", span: Math.round(0.5 * YEAR) },
];

function RatingChart({ ratingHistory }: { ratingHistory: RatingChange[] }) {
  const sorted = useMemo(
    () => [...ratingHistory].sort((a, b) => a.ratingUpdateTimeSeconds - b.ratingUpdateTimeSeconds),
    [ratingHistory],
  );

  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  // Visible time window [t0, t1] in seconds; null = full range.
  const [win, setWin] = useState<[number, number] | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  // Drag-to-zoom selection, in pixel X within the svg.
  const [drag, setDrag] = useState<{ x0: number; x1: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Measure the container so the chart fills its panel and reflows on resize.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (sorted.length === 0) {
    return <div className="stats-empty">No rated contests yet — participate in one to start your rating graph.</div>;
  }

  const H = 340;
  const padL = 52, padR = 16, padT = 16, padB = 40;
  const W = Math.max(width, 320);
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  const tMinData = sorted[0]!.ratingUpdateTimeSeconds;
  const tMaxData = sorted[sorted.length - 1]!.ratingUpdateTimeSeconds;
  const [t0, t1] = win ?? [tMinData, tMaxData];

  const vis = sorted.filter(c => c.ratingUpdateTimeSeconds >= t0 && c.ratingUpdateTimeSeconds <= t1);
  const forY = vis.length > 0 ? vis : sorted;

  // Y range: fit visible points, pad, and enforce a minimum span so a quiet
  // period doesn't get magnified into noise.
  let rLo = Math.min(...forY.map(c => c.newRating));
  let rHi = Math.max(...forY.map(c => c.newRating));
  let yMin = Math.floor((rLo - 60) / 100) * 100;
  let yMax = Math.ceil((rHi + 60) / 100) * 100;
  yMin = Math.max(0, yMin);
  if (yMax - yMin < 400) { const mid = (yMax + yMin) / 2; yMin = Math.max(0, Math.round(mid - 200)); yMax = yMin + 400; }

  const tSpan = Math.max(t1 - t0, 1);
  const rSpan = Math.max(yMax - yMin, 1);
  const sx = (t: number) => padL + ((t - t0) / tSpan) * chartW;
  const sy = (r: number) => padT + chartH - ((r - yMin) / rSpan) * chartH;
  const baselineY = padT + chartH;

  // Tier bands.
  const bands: { y: number; h: number; color: string }[] = [];
  for (let i = 0; i < TIER_STOPS.length - 1; i++) {
    const lo = Math.max(TIER_STOPS[i]!, yMin);
    const hi = Math.min(TIER_STOPS[i + 1]!, yMax);
    if (hi <= lo) continue;
    bands.push({ y: sy(hi), h: sy(lo) - sy(hi), color: tierColor((TIER_STOPS[i]! + TIER_STOPS[i + 1]!) / 2 - 1) });
  }
  const yTicks = TIER_STOPS.filter(r => r > yMin && r < yMax);

  // X ticks: 6 evenly spaced timestamps; format by span (years vs months).
  const spanDays = tSpan / 86400;
  const fmtTick = (t: number) => {
    const d = new Date(t * 1000);
    return spanDays > 1100
      ? String(d.getFullYear())
      : d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
  };
  const xTicks: { x: number; label: string }[] = [];
  let lastLabel = "";
  for (let i = 0; i < 6; i++) {
    const t = t0 + (i / 5) * tSpan;
    const label = fmtTick(t);
    if (label === lastLabel) continue;
    lastLabel = label;
    xTicks.push({ x: sx(t), label });
  }

  const polyline = vis.map(c => `${sx(c.ratingUpdateTimeSeconds)},${sy(c.newRating)}`).join(" ");
  const areaPath = vis.length > 0
    ? `M ${sx(vis[0]!.ratingUpdateTimeSeconds)},${baselineY} `
      + vis.map(c => `L ${sx(c.ratingUpdateTimeSeconds)},${sy(c.newRating)}`).join(" ")
      + ` L ${sx(vis[vis.length - 1]!.ratingUpdateTimeSeconds)},${baselineY} Z`
    : "";

  // Summary stats over the FULL history (not the zoom window).
  const current = sorted[sorted.length - 1]!.newRating;
  const peak = Math.max(...sorted.map(c => c.newRating));
  const low = Math.min(...sorted.map(c => c.newRating));
  const delta = current - sorted[0]!.oldRating;

  // ---- pointer helpers ----
  const pxToTime = (px: number) => t0 + ((px - padL) / chartW) * tSpan;
  const localX = (clientX: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    return clientX - (rect?.left ?? 0);
  };
  const nearestVis = (px: number): number | null => {
    if (vis.length === 0) return null;
    let best = 0, bestD = Infinity;
    for (let i = 0; i < vis.length; i++) {
      const d = Math.abs(sx(vis[i]!.ratingUpdateTimeSeconds) - px);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  };

  const onMove = (e: React.MouseEvent) => {
    const px = localX(e.clientX);
    if (drag) { setDrag({ ...drag, x1: px }); return; }
    setHover(nearestVis(px));
  };
  const onDown = (e: React.MouseEvent) => {
    const px = localX(e.clientX);
    if (px < padL || px > padL + chartW) return;
    setDrag({ x0: px, x1: px });
    setHover(null);
  };
  const onUp = () => {
    if (drag) {
      const dist = Math.abs(drag.x1 - drag.x0);
      if (dist > 6) {
        const ta = pxToTime(Math.min(drag.x0, drag.x1));
        const tb = pxToTime(Math.max(drag.x0, drag.x1));
        setWin([Math.max(tMinData, ta), Math.min(tMaxData, tb)]);
      }
      setDrag(null);
    }
  };
  const onLeave = () => { setHover(null); setDrag(null); };

  const activePreset = (span: number | null): boolean => {
    if (span === null) return win === null;
    if (win === null) return false;
    // Match if the window right edge is the last contest and span ≈ requested.
    return Math.abs((win[1] - win[0]) - span) < 86400 && Math.abs(win[1] - tMaxData) < 86400;
  };
  const applyPreset = (span: number | null) => {
    if (span === null) { setWin(null); return; }
    setWin([Math.max(tMinData, tMaxData - span), tMaxData]);
    setHover(null);
  };

  const hovered = hover != null ? vis[hover] : null;
  const hoveredGain = hovered ? hovered.newRating - hovered.oldRating : 0;

  return (
    <div className="rc-wrap" ref={wrapRef}>
      <div className="rc-toolbar">
        <div className="rc-summary">
          <span>当前 <b style={{ color: tierColor(current) }}>{current}</b></span>
          <span>峰值 <b style={{ color: tierColor(peak) }}>{peak}</b></span>
          <span>最低 <b>{low}</b></span>
          <span>Δ <b className={delta >= 0 ? "rc-up" : "rc-down"}>{delta >= 0 ? "+" : ""}{delta}</b></span>
          <span className="rc-count">{sorted.length} 场</span>
        </div>
        <div className="rc-chips">
          {ZOOM_PRESETS.map(p => (
            <button
              key={p.label}
              className={`rc-chip${activePreset(p.span) ? " active" : ""}`}
              onClick={() => applyPreset(p.span)}
            >{p.label}</button>
          ))}
        </div>
      </div>

      <svg
        ref={svgRef}
        className="rc-svg"
        width={W}
        height={H}
        onMouseMove={onMove}
        onMouseDown={onDown}
        onMouseUp={onUp}
        onMouseLeave={onLeave}
        style={{ cursor: drag ? "ew-resize" : "crosshair" }}
      >
        <defs>
          <linearGradient id="rc-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.30" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* tier bands */}
        {bands.map((b, i) => (
          <rect key={i} x={padL} y={b.y} width={chartW} height={b.h} fill={b.color} opacity={0.1} />
        ))}

        {/* Y gridlines + labels */}
        {yTicks.map(r => (
          <g key={r}>
            <line x1={padL} y1={sy(r)} x2={padL + chartW} y2={sy(r)} stroke="var(--border)" strokeDasharray="3 5" strokeWidth="1" />
            <text x={padL - 8} y={sy(r) + 3} textAnchor="end" className="rc-axis-label">{r}</text>
          </g>
        ))}
        {/* Y bounds labels */}
        <text x={padL - 8} y={sy(yMin) + 3} textAnchor="end" className="rc-axis-label rc-axis-bound">{yMin}</text>
        <text x={padL - 8} y={sy(yMax) + 3} textAnchor="end" className="rc-axis-label rc-axis-bound">{yMax}</text>

        {/* X ticks */}
        {xTicks.map((t, i) => (
          <g key={i}>
            <line x1={t.x} y1={baselineY} x2={t.x} y2={baselineY + 4} stroke="var(--border)" strokeWidth="1" />
            <text x={t.x} y={baselineY + 18} textAnchor="middle" className="rc-axis-label">{t.label}</text>
          </g>
        ))}
        {/* axes */}
        <line x1={padL} y1={padT} x2={padL} y2={baselineY} stroke="var(--border)" strokeWidth="1" />
        <line x1={padL} y1={baselineY} x2={padL + chartW} y2={baselineY} stroke="var(--border)" strokeWidth="1" />

        {/* area + curve */}
        {areaPath && <path d={areaPath} fill="url(#rc-area)" />}
        {vis.length > 1 && (
          <polyline points={polyline} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        )}

        {/* hover crosshair */}
        {hovered && (
          <line
            x1={sx(hovered.ratingUpdateTimeSeconds)} y1={padT}
            x2={sx(hovered.ratingUpdateTimeSeconds)} y2={baselineY}
            stroke="var(--muted)" strokeWidth="1" strokeDasharray="2 3"
          />
        )}

        {/* points — thinned when dense so they don't smear into a blob */}
        {vis.map((c, i) => {
          const dense = vis.length > 80;
          const isHover = i === hover;
          if (dense && !isHover && i % Math.ceil(vis.length / 80) !== 0) return null;
          return (
            <circle
              key={i}
              cx={sx(c.ratingUpdateTimeSeconds)}
              cy={sy(c.newRating)}
              r={isHover ? 5.5 : (dense ? 2 : 3.5)}
              fill={tierColor(c.newRating)}
              stroke="var(--surface)" strokeWidth={isHover ? 2 : 1}
            />
          );
        })}

        {/* drag-to-zoom selection */}
        {drag && Math.abs(drag.x1 - drag.x0) > 2 && (
          <rect
            x={Math.min(drag.x0, drag.x1)} y={padT}
            width={Math.abs(drag.x1 - drag.x0)} height={chartH}
            fill="var(--accent)" opacity={0.14} stroke="var(--accent)" strokeOpacity={0.5} strokeWidth={1}
          />
        )}
      </svg>

      {vis.length === 0 && <div className="rc-note">该区间没有比赛 — 点「全部」重置</div>}
      {!drag && <div className="rc-hint">拖动图表选区缩放 · 点上方时间片切换范围</div>}

      {/* tooltip */}
      {hovered && (
        <div
          className="rc-tip"
          style={{
            left: Math.min(Math.max(sx(hovered.ratingUpdateTimeSeconds), 90), W - 90),
            top: sy(hovered.newRating),
          }}
        >
          <div className="rc-tip-name">{hovered.contestName}</div>
          <div className="rc-tip-row">
            <span className="rc-tip-date">{formatDate(hovered.ratingUpdateTimeSeconds)}</span>
            <span className="rc-tip-rank">rank #{hovered.rank}</span>
          </div>
          <div className="rc-tip-row">
            <span className="rc-tip-rating" style={{ color: tierColor(hovered.newRating) }}>
              {hovered.oldRating} → <b>{hovered.newRating}</b>
            </span>
            <span className={hoveredGain >= 0 ? "rc-up" : "rc-down"}>
              {hoveredGain >= 0 ? "+" : ""}{hoveredGain}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// A titled, framed panel that wraps each chart. Keeps a consistent frame
// around every visualization and gives the page a steady vertical rhythm.
function Panel({ title, subtitle, children, className }: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`stats-panel${className ? ` ${className}` : ""}`}>
      <div className="stats-panel-head">
        <h3>{title}</h3>
        {subtitle && <span className="stats-panel-sub">{subtitle}</span>}
      </div>
      <div className="stats-panel-body">{children}</div>
    </section>
  );
}

// ----- main page -----
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
