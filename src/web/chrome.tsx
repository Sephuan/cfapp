import type { BottomTab, Route } from "./shared";
import { useLang, t } from "./i18n";
import { AuthIndicator } from "./chrome/AuthIndicator";

export { PersistentCfFrame } from "./chrome/PersistentCfFrame";

// ----- topbar with browser-style nav -----
export function Topbar(props: {
  route: Route;
  activeTab: BottomTab | null;
  canBack: boolean; canForward: boolean;
  onBack: () => void; onForward: () => void;
  onHome: () => void; onRefresh: () => void; onSettings: () => void;
  theme: "light" | "dark"; onToggleTheme: () => void;
  onOpenLogin: () => void;
  onLogout: () => void;
}) {
  const { route, activeTab } = props;
  const [lang] = useLang();
  const crumbs = (() => {
    if (activeTab === "submit")    return <span>{t(lang, "nav.submit")}</span>;
    if (activeTab === "standings") return <span>{t(lang, "nav.standings")}</span>;
    if (activeTab === "mysubs")    return <span>{t(lang, "nav.mysubs")}</span>;
    if (activeTab === "login")     return <span>{t(lang, "nav.login")}</span>;
    if (route.kind === "contests") return <span>{t(lang, "nav.contests")}</span>;
    if (route.kind === "settings") return <span>{t(lang, "nav.settings")}</span>;
    if (route.kind === "stats") return <span>{t(lang, "nav.statistics")}</span>;
    if (route.kind === "problems") return <span>{route.contest.name}</span>;
    return <span>{route.contest.name} / {route.problem.index}. {route.problem.name}</span>;
  })();
  return (
    <div className="topbar">
      <button className="nav-btn" disabled={!props.canBack} onClick={props.onBack} title="Back">‹</button>
      <button className="nav-btn" disabled={!props.canForward} onClick={props.onForward} title="Forward">›</button>
      <button className="nav-btn" onClick={props.onRefresh} title="Refresh">↻</button>
      <button className="nav-btn" onClick={props.onHome} title="Home">⌂</button>
      <span className="brand" onClick={props.onHome}>cfapp</span>
      <span className="crumbs">/ {crumbs}</span>
      <span className="spacer" />
      <AuthIndicator onLogin={props.onOpenLogin} onLogout={props.onLogout} />
      <button className="theme-toggle" onClick={props.onToggleTheme} title="Toggle theme">
        {props.theme === "dark" ? t(lang, "theme.dark") : t(lang, "theme.light")}
      </button>
      <button className="iconbtn" onClick={props.onSettings}>{t(lang, "nav.settings")}</button>
    </div>
  );
}

export function BottomBar(props: {
  active: BottomTab | null;
  activeRoute?: Route["kind"];
  hasContest: boolean;
  onSwitch: (tab: Exclude<BottomTab, "login">) => void;
  onMain: () => void;
  onNavigateStats: () => void;
}) {
  const [lang] = useLang();
  const btn = (label: string, key: Exclude<BottomTab, "login"> | null, activeOverride?: boolean, onClickOverride?: () => void) => {
    const active = activeOverride ?? (props.active === key);
    const disabled = key !== null && !props.hasContest;
    return (
      <button
        className="tab-btn"
        aria-pressed={active}
        disabled={disabled}
        onClick={() => onClickOverride ? onClickOverride() : (key === null ? props.onMain() : props.onSwitch(key))}
        title={disabled ? t(lang, "bottom.pickContest") : label}
      >{label}</button>
    );
  };
  return (
    <div className="tabbar">
      {btn(t(lang, "bottom.main"), null, props.active === null && props.activeRoute !== "stats")}
      <span className="tab-divider" />
      {btn(t(lang, "bottom.submit"), "submit")}
      {btn(t(lang, "bottom.standings"), "standings")}
      {btn(t(lang, "bottom.mysubs"), "mysubs")}
      {btn(t(lang, "bottom.stats"), null, props.activeRoute === "stats", props.onNavigateStats)}
    </div>
  );
}
