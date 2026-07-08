import React, { useEffect, useImperativeHandle, useRef, useState } from "react";
import type { BottomTab, CfFrameHandle, Route, UserMe } from "./shared";
import { TIER_COLOR } from "./shared";

// ----- auth indicator (in the topbar) -----
function AuthIndicator({ onLogin, onLogout }: { onLogin: () => void; onLogout: () => void }) {
  const [status, setStatus] = useState<{ ok: boolean; handle: string | null; error: string | null } | null>(null);
  const [me, setMe] = useState<UserMe | null>(null);
  const [open, setOpen] = useState(false);
  const fastTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = async () => {
    try {
      const r = await fetch("/api/auth/status");
      const j = await r.json();
      setStatus({ ok: !!j.ok, handle: j.handle ?? null, error: j.error ?? null });
      if (j.ok && j.handle) {
        // Pull rating/rank in a separate call — purely cosmetic, never block
        // the auth indicator on it.
        try {
          const r2 = await fetch("/api/user/me");
          if (r2.ok) setMe(await r2.json());
        } catch {}
      } else {
        setMe(null);
      }
    } catch { /* keep last state */ }
  };
  useEffect(() => {
    poll();
    // Slow poll: use the lightweight /api/auth/ping for heartbeat (60s),
    // fall back to full /api/auth/status only when ping indicates trouble.
    const doPing = async () => {
      try {
        const r = await fetch("/api/auth/ping");
        const j = await r.json();
        if (!j.ok) {
          // Cookie file is empty — full status check
          poll();
        } else if (!j.fresh) {
          // Has cookies but no cf_clearance — likely stale, do full check
          poll();
        }
        // else: fresh=true, session is healthy, skip full check
      } catch {
        poll();
      }
    };
    const slow = setInterval(doPing, 60_000);
    const fast = setInterval(poll, 30_000);
    return () => {
      clearInterval(slow);
      clearInterval(fast);
      if (fastTimerRef.current) clearInterval(fastTimerRef.current);
    };
  }, []);

  // After login is initiated, poll once a second for two minutes so the badge
  // flips green quickly when the cookie lands.
  const handleLogin = () => {
    onLogin();
    if (fastTimerRef.current) clearInterval(fastTimerRef.current);
    fastTimerRef.current = setInterval(poll, 1000);
    setTimeout(() => {
      if (fastTimerRef.current) {
        clearInterval(fastTimerRef.current);
        fastTimerRef.current = null;
      }
    }, 2 * 60_000);
  };

  // Close the dropdown on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest(".auth-indicator")) setOpen(false);
    };
    setTimeout(() => document.addEventListener("mousedown", onDown), 0);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (!status) return <span className="iconbtn" style={{ opacity: 0.6 }}>auth…</span>;

  if (!status.ok) {
    return (
      <button className="iconbtn auth-indicator" onClick={handleLogin}
        title="Open Codeforces login. Cookies sync back automatically.">
        <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 4, background: "var(--err)", marginRight: 6, verticalAlign: "middle" }} />
        Login
      </button>
    );
  }

  const tier = me?.tier ?? "unrated";
  const color = TIER_COLOR[tier];
  const handle = me?.handle ?? status.handle ?? "logged in";
  const rating = me?.rating;
  // Status dot communicates "session active" — always green when logged in.
  // Tier color is for the handle text only (unrated → grey would otherwise
  // make the dot look like a not-logged-in indicator).
  const dotColor = "var(--ok)";

  return (
    <span className="auth-indicator" style={{ position: "relative" }}>
      <button
        className="iconbtn"
        onClick={() => setOpen(o => !o)}
        title={me?.rank ? `${me.rank}${rating != null ? ` · ${rating}` : ""}` : "Logged in"}
        style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
      >
        <span style={{ width: 8, height: 8, borderRadius: 4, background: dotColor, display: "inline-block" }} />
        <span style={{ color, fontWeight: 700 }}>{handle}</span>
        {rating != null && <span style={{ opacity: 0.7, fontSize: "0.78rem" }}>{rating}</span>}
        <span style={{ opacity: 0.5, fontSize: "0.7rem" }}>▾</span>
      </button>
      {open && (
        <div style={{
          position: "absolute", right: 0, top: "calc(100% + 4px)",
          minWidth: 200, background: "var(--surface)", color: "var(--text)",
          border: "1px solid var(--border)", borderRadius: 6,
          boxShadow: "0 8px 24px rgba(0,0,0,0.18)", zIndex: 200, padding: 6,
        }}>
          <div style={{ padding: "6px 10px", fontSize: "0.82rem", color: "var(--muted)" }}>
            {me?.rank ?? (me?.rating != null ? "rated" : "unrated")}
            {rating != null ? <> · <b style={{ color }}>{rating}</b></> : null}
            {me?.maxRating != null && me?.maxRating !== rating ? <> · max {me.maxRating}</> : null}
          </div>
          <button
            onClick={() => { setOpen(false); onLogout(); }}
            style={{
              width: "100%", textAlign: "left", padding: "6px 10px",
              background: "none", border: "none", color: "var(--err)",
              cursor: "pointer", fontFamily: "inherit", fontSize: "0.92rem",
              borderRadius: 4,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--code-bg)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
          >Log out</button>
        </div>
      )}
    </span>
  );
}

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
  // Crumbs follow whichever pane the user is actually looking at — main app
  // route when no CF tab is active, otherwise the tab name itself.
  const crumbs = (() => {
    if (activeTab === "submit")    return <span>Submit</span>;
    if (activeTab === "standings") return <span>Standings</span>;
    if (activeTab === "mysubs")    return <span>My submissions</span>;
    if (activeTab === "login")     return <span>Login</span>;
    if (route.kind === "contests") return <span>Contests</span>;
    if (route.kind === "settings") return <span>Settings</span>;
    if (route.kind === "stats") return <span>Statistics</span>;
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
        {props.theme === "dark" ? "☾ dark" : "☀ light"}
      </button>
      <button className="iconbtn" onClick={props.onSettings}>Settings</button>
    </div>
  );
}

// ----- bottom bar: persistent CF tabs (Submit / Standings / My subs) -----
// These tabs are independent of the problem-page navigation stack.
// Click → lazy mount the webview; switching away keeps it in the DOM with
// display:none so login state, scroll, in-page navigation all survive.
// "login" is also a valid active tab — it has no button (the AuthIndicator
// in the topbar opens it) but lives in the same persistent-webview slot.
export function BottomBar(props: {
  active: BottomTab | null;
  activeRoute?: Route["kind"];
  hasContest: boolean;
  onSwitch: (tab: Exclude<BottomTab, "login">) => void;
  onMain: () => void;
  onNavigateStats: () => void;
}) {
  const btn = (label: string, key: Exclude<BottomTab, "login"> | null, activeOverride?: boolean, onClickOverride?: () => void) => {
    const active = activeOverride ?? (props.active === key);
    const disabled = key !== null && !props.hasContest;
    return (
      <button
        className="tab-btn"
        aria-pressed={active}
        disabled={disabled}
        onClick={() => onClickOverride ? onClickOverride() : (key === null ? props.onMain() : props.onSwitch(key))}
        title={disabled ? "Pick a contest first" : label}
      >{label}</button>
    );
  };
  return (
    <div className="tabbar">
      {btn("Main", null, props.active === null && props.activeRoute !== "stats")}
      <span className="tab-divider" />
      {btn("Submit", "submit")}
      {btn("Standings", "standings")}
      {btn("My subs", "mysubs")}
      {btn("Stats", null, props.activeRoute === "stats", props.onNavigateStats)}
    </div>
  );
}

// Persistent CF webview. Mounted once when url first becomes non-null; stays
// in the DOM across tab switches (display:none when inactive). Bumping
// `reloadKey` forces a remount, used by the editor's Submit button to
// navigate this tab to a specific URL. Uses Electron's <webview> with a
// shared persist:cf partition so login/cookies/cf_clearance survive across
// tabs and across app restarts.
//
// Exposes an imperative handle so the topbar can drive per-tab nav: back,
// forward, reload, zoom, and one-shot loadURL (used by the editor's submit
// flow to push a specific URL into an already-mounted webview without
// blowing away its session).
export const PersistentCfFrame = React.forwardRef<CfFrameHandle, {
  url: string | null;
  active: boolean;
  reloadKey: number;
  onNavStateChange?: () => void;
}>(function PersistentCfFrame({ url, active, reloadKey, onNavStateChange }, ref) {
  const wvRef = useRef<any>(null);
  const zoomRef = useRef<number>(1);

  // Re-attach handlers and seed the in-guest Ctrl+wheel zoom shim every time
  // the webview remounts (reloadKey bump) or finishes its first navigation.
  useEffect(() => {
    const wv = wvRef.current;
    if (!wv) return;

    const onDomReady = () => {
      try {
        wv.setZoomFactor(zoomRef.current);
      } catch {}
      // Inject Ctrl+wheel / Ctrl+0/+/- shortcuts into the guest page itself.
      // <webview> guests run in their own renderer process and don't bubble
      // these to the host, so we ride out via console.log with a magic prefix
      // and the host listens via the webview's "console-message" event.
      // Same shim also auto-ticks "Remember me" on /enter so CF issues a
      // ~1-month cookie instead of a session-only one — that's how the user
      // stays logged in across app restarts without re-typing credentials.
      try {
        wv.executeJavaScript(`
          (function(){
            if (!window.__cfappZoomShimInstalled) {
              window.__cfappZoomShimInstalled = true;
              window.addEventListener('wheel', function(e){
                if (!e.ctrlKey) return;
                e.preventDefault();
                console.log('__CFTUI_ZOOM__', e.deltaY < 0 ? 1 : -1);
              }, { passive: false, capture: true });
              window.addEventListener('keydown', function(e){
                if (!(e.ctrlKey || e.metaKey)) return;
                if (e.key === '+' || e.key === '=') { e.preventDefault(); console.log('__CFTUI_ZOOM__', 1); }
                else if (e.key === '-')             { e.preventDefault(); console.log('__CFTUI_ZOOM__', -1); }
                else if (e.key === '0')             { e.preventDefault(); console.log('__CFTUI_ZOOM__', 0); }
              }, true);
            }
            // Auto-tick the Remember-me box when on /enter. The form may
            // hydrate after dom-ready, so retry a few times.
            if (/\\/enter(\\?|$|\\/)/i.test(location.pathname + location.search)) {
              var tries = 0;
              var iv = setInterval(function(){
                tries++;
                var cb = document.querySelector('input[name="remember"]') ||
                         document.querySelector('#remember') ||
                         document.querySelector('input[type="checkbox"][name*="remember" i]');
                if (cb) { cb.checked = true; cb.dispatchEvent(new Event('change', {bubbles:true})); clearInterval(iv); }
                else if (tries > 20) clearInterval(iv);
              }, 250);
            }
          })();
        `).catch(() => {});
      } catch {}
      onNavStateChange?.();
    };

    const onNavigate = () => onNavStateChange?.();
    const onConsole = (e: any) => {
      // Catch the zoom signal from the in-guest shim.
      const msg: string = e?.message || "";
      const m = msg.match(/^__CFTUI_ZOOM__\s+(-?\d+)/);
      if (!m) return;
      const dir = Number(m[1]);
      if (dir === 0) {
        zoomRef.current = 1;
      } else {
        zoomRef.current = Math.max(0.25, Math.min(5, zoomRef.current * (dir > 0 ? 1.1 : 1 / 1.1)));
      }
      try { wv.setZoomFactor(zoomRef.current); } catch {}
    };

    wv.addEventListener("dom-ready", onDomReady);
    wv.addEventListener("did-navigate", onNavigate);
    wv.addEventListener("did-navigate-in-page", onNavigate);
    wv.addEventListener("console-message", onConsole);
    return () => {
      wv.removeEventListener("dom-ready", onDomReady);
      wv.removeEventListener("did-navigate", onNavigate);
      wv.removeEventListener("did-navigate-in-page", onNavigate);
      wv.removeEventListener("console-message", onConsole);
    };
  }, [reloadKey, onNavStateChange]);

  useImperativeHandle(ref, () => ({
    back: () => { try { wvRef.current?.goBack(); } catch {} },
    forward: () => { try { wvRef.current?.goForward(); } catch {} },
    canGoBack: () => { try { return !!wvRef.current?.canGoBack(); } catch { return false; } },
    canGoForward: () => { try { return !!wvRef.current?.canGoForward(); } catch { return false; } },
    reload: () => { try { wvRef.current?.reload(); } catch {} },
    loadURL: (u: string) => { try { wvRef.current?.loadURL(u); } catch {} },
    injectCode: (code: string, problemIndex: string, langId?: number) => {
      // Best-effort: paste the user's code into CF's submission textarea.
      // Runs in the guest page so it can poke #sourceCodeTextArea / Codemirror.
      try {
        const literal = JSON.stringify(code);
        const idx = JSON.stringify(problemIndex);
        const lid = langId != null ? String(langId) : "";
        wvRef.current?.executeJavaScript(`
          (function(){
            var code = ${literal};
            var idx = ${idx};
            var langId = ${JSON.stringify(lid)};
            // Fill problem dropdown if present.
            try {
              var pd = document.querySelector('select[name="submittedProblemIndex"]');
              if (pd) {
                for (var i=0; i<pd.options.length; i++) {
                  if (pd.options[i].value === idx) { pd.selectedIndex = i; pd.dispatchEvent(new Event('change', {bubbles:true})); break; }
                }
              }
            } catch(e){}
            // Fill language dropdown if langId provided.
            if (langId) {
              try {
                var ls = document.querySelector('select[name="programTypeId"]');
                if (ls) {
                  for (var i=0; i<ls.options.length; i++) {
                    if (ls.options[i].value === langId) { ls.selectedIndex = i; ls.dispatchEvent(new Event('change', {bubbles:true})); break; }
                  }
                }
              } catch(e){}
            }
            // 1) plain textarea
            var ta = document.querySelector('#sourceCodeTextArea, textarea[name="source"]');
            if (ta) {
              var nat = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
              nat.call(ta, code);
              ta.dispatchEvent(new Event('input', {bubbles:true}));
              ta.dispatchEvent(new Event('change', {bubbles:true}));
            }
            // 2) ACE editor (CF uses it for the in-page code editor)
            try {
              if (window.ace && document.querySelector('.ace_editor')) {
                var ed = window.ace.edit(document.querySelector('.ace_editor'));
                ed.setValue(code, -1);
              }
            } catch(e){}
            // 3) Codemirror fallback
            try {
              var cmEl = document.querySelector('.CodeMirror');
              if (cmEl && cmEl.CodeMirror) cmEl.CodeMirror.setValue(code);
            } catch(e){}
          })();
        `).catch(() => {});
      } catch {}
    },
    setZoom: (z: number) => { zoomRef.current = z; try { wvRef.current?.setZoomFactor(z); } catch {} },
    getZoom: () => zoomRef.current,
    zoomIn:  () => { zoomRef.current = Math.min(5, zoomRef.current * 1.1); try { wvRef.current?.setZoomFactor(zoomRef.current); } catch {} },
    zoomOut: () => { zoomRef.current = Math.max(0.25, zoomRef.current / 1.1); try { wvRef.current?.setZoomFactor(zoomRef.current); } catch {} },
    zoomReset: () => { zoomRef.current = 1; try { wvRef.current?.setZoomFactor(1); } catch {} },
    getWebview: () => wvRef.current,
  }), []);

  if (!url) return null;
  return (
    <webview
      key={reloadKey}
      ref={wvRef}
      src={url}
      partition="persist:cf"
      allowpopups={true as any}
      style={{
        display: active ? "flex" : "none",
        position: "fixed",
        top: 64, left: 0, right: 0, bottom: 56,
        width: "100vw",
        height: "calc(100vh - 64px - 56px)",
        border: "none",
        background: "var(--surface)",
      }}
    />
  );
});
