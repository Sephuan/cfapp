/** @jsxImportSource react */
import { useEffect, useRef, useState, useCallback } from "react";
import { createRoot } from "react-dom/client";
import type { Contest } from "../api";
import type { CfFrameHandle, Route } from "./shared";
import { useHistoryStack } from "./hooks";
import { Topbar, BottomBar, PersistentCfFrame } from "./chrome";
import { applyColorTheme, applyTrTheme, applyAllFonts, readColorTheme, readTrTheme } from "./themes";
import { ContestsPage } from "./pages/ContestsPage";
import { ProblemsPage } from "./pages/ProblemsPage";
import { ProblemPage } from "./pages/ProblemPage";
import { SettingsPage } from "./pages/SettingsPage";
import { StatsPage } from "./pages/StatsPage";

declare global {
  interface Window {
    cfapp?: {
      logoutCf: () => Promise<{ ok: boolean; error?: string }>;
    };
  }
}

// ----- root -----
function App() {
  const hist = useHistoryStack({ kind: "contests" });
  const { route } = hist;
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    try {
      const saved = localStorage.getItem("cfapp:theme");
      if (saved === "light" || saved === "dark") return saved;
    } catch {}
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("cfapp:theme", theme); } catch {}
  }, [theme]);

  // Restore the translation-annotation palette + color palette on mount.
  // amber (default) leaves no attribute so the :root fallback colors win.
  useEffect(() => {
    applyTrTheme(readTrTheme());
    applyColorTheme(readColorTheme());
    applyAllFonts();
  }, []);

  // CF context — drives default URLs for the bottom-bar tabs. Tracks the
  // most recently visited contest/problem so Submit/Standings/My subs know
  // where to go even after the user navigates back to the contest list.
  const [ctxContest, setCtxContest] = useState<Contest | null>(null);
  const [ctxProblemIndex, setCtxProblemIndex] = useState<string | null>(null);
  useEffect(() => {
    if (route.kind === "problems" || route.kind === "problem") setCtxContest(route.contest);
    if (route.kind === "problem") setCtxProblemIndex(route.problem.index);
    else if (route.kind === "problems") setCtxProblemIndex(null);
  }, [route]);

  // Bottom-bar tabs — each is an independent persistent webview. `url` stays
  // null until the user first activates the tab, at which point we lazily
  // mount it. `reloadKey` bumping forces a remount (= navigate that webview
  // to its url again, used by Submit-from-editor).
  type BottomTab = "submit" | "standings" | "mysubs" | "login";
  const [activeTab, setActiveTab] = useState<BottomTab | null>(null);
  const [submitUrl, setSubmitUrl] = useState<string | null>(null);
  const [submitKey, setSubmitKey] = useState(0);
  const [standingsUrl, setStandingsUrl] = useState<string | null>(null);
  const [standingsKey, setStandingsKey] = useState(0);
  const [mysubsUrl, setMysubsUrl] = useState<string | null>(null);
  const [mysubsKey, setMysubsKey] = useState(0);
  const [loginUrl, setLoginUrl] = useState<string | null>(null);
  const [loginKey, setLoginKey] = useState(0);

  // Initial URL each tab snaps to when its Home button is hit. Recomputed
  // every render from the live CF context.
  const tabHome = (tab: Exclude<BottomTab, "login">): string | null => {
    if (!ctxContest) return null;
    if (tab === "submit") {
      const idx = ctxProblemIndex ? `?submittedProblemIndex=${ctxProblemIndex}` : "";
      return `https://codeforces.com/contest/${ctxContest.id}/submit${idx}`;
    }
    if (tab === "standings") return `https://codeforces.com/contest/${ctxContest.id}/standings`;
    if (tab === "mysubs")    return `https://codeforces.com/contest/${ctxContest.id}/my`;
    return null;
  };

  // Pending code injection: when ProblemPage's Submit fires, we stash the
  // code here; once the submit-tab webview signals dom-ready, we paste it.
  const pendingInject = useRef<{ code: string; problemIndex: string; langId?: number } | null>(null);

  // Per-tab webview handles. Used by the topbar nav buttons to drive
  // back/forward/reload of whichever tab is active.
  const submitFrame = useRef<CfFrameHandle>(null);
  const standingsFrame = useRef<CfFrameHandle>(null);
  const mysubsFrame = useRef<CfFrameHandle>(null);
  const loginFrame = useRef<CfFrameHandle>(null);
  const activeFrame = (): CfFrameHandle | null => {
    if (activeTab === "submit") return submitFrame.current;
    if (activeTab === "standings") return standingsFrame.current;
    if (activeTab === "mysubs") return mysubsFrame.current;
    if (activeTab === "login") return loginFrame.current;
    return null;
  };
  // Mirror activeFrame into a ref on every render so the zoom key/wheel
  // handler (subscribed once, below) always sees the current tab without
  // re-subscribing. Previously the effect had NO dependency array, which
  // re-bound three listeners on every render — a slow leak.
  const activeFrameRef = useRef<CfFrameHandle | null>(null);
  activeFrameRef.current = activeFrame();

  // navTick bumps every time a webview fires did-navigate, just to force a
  // re-render so the back/forward button enabled state stays current.
  const [navTick, setNavTick] = useState(0);
  const onNavStateChange = useCallback(() => setNavTick(t => t + 1), []);

  // Inject pending code once the submit tab finishes loading the CF page.
  useEffect(() => {
    if (!pendingInject.current) return;
    if (activeTab !== "submit") return;
    // dom-ready already fired; give CF a beat to mount its editor widgets.
    const t = setTimeout(() => {
      const p = pendingInject.current;
      if (p) {
        submitFrame.current?.injectCode(p.code, p.problemIndex, p.langId);
        pendingInject.current = null;
      }
    }, 500);
    return () => clearTimeout(t);
  }, [activeTab, navTick, submitKey]);

  const onSwitchTab = (tab: BottomTab) => {
    if (tab !== "login" && !ctxContest) return;
    if (tab === "submit" && !submitUrl) {
      const idx = ctxProblemIndex ? `?submittedProblemIndex=${ctxProblemIndex}` : "";
      setSubmitUrl(`https://codeforces.com/contest/${ctxContest!.id}/submit${idx}`);
    }
    if (tab === "standings" && !standingsUrl) {
      setStandingsUrl(`https://codeforces.com/contest/${ctxContest!.id}/standings`);
    }
    if (tab === "mysubs" && !mysubsUrl) {
      setMysubsUrl(`https://codeforces.com/contest/${ctxContest!.id}/my`);
    }
    if (tab === "login" && !loginUrl) {
      setLoginUrl("https://codeforces.com/enter");
    }
    setActiveTab(tab);
  };
  // Editor's Submit button: force-navigate the Submit tab to this URL and
  // switch to it. Also stash the code so the submit page's editor gets it
  // once it finishes loading.
  const onOpenSubmitTab = (url: string, code: string, problemIndex: string, langId?: number) => {
    pendingInject.current = { code, problemIndex, langId };
    if (submitUrl) {
      // Tab already mounted — load the new URL into the existing webview so
      // we keep the partition's network state warm.
      submitFrame.current?.loadURL(url);
      setSubmitUrl(url);
    } else {
      setSubmitUrl(url);
      setSubmitKey(k => k + 1);
    }
    setActiveTab("submit");
  };
  // Login button (AuthIndicator) — open CF login in its own persistent
  // webview, sharing the partition so the cookie immediately applies to
  // the other three tabs.
  const onOpenLogin = () => {
    // Purge stale cf_clearance from the webview before navigating to
    // login — a revoked clearance causes 403 redirect loops that block
    // the login page entirely.
    try {
      const wv = loginFrame.current?.getWebview();
      if (wv) {
        const ses = wv.getWebContents?.()?.session;
        if (ses) {
          ses.cookies.get({ name: "cf_clearance" }).then((cs: any[]) => {
            for (const c of cs) {
              const host = (c.domain || "").replace(/^\./, "");
              if (host) ses.cookies.remove(`https://${host}${c.path || "/"}`, c.name);
            }
          }).catch(() => {});
        }
      }
    } catch {}
    if (!loginUrl) {
      setLoginUrl("https://codeforces.com/enter");
    } else {
      // Force a remount so a stale login page (e.g. one that already redirected
      // away after a previous successful login) snaps back to /enter.
      loginFrame.current?.loadURL("https://codeforces.com/enter");
    }
    setActiveTab("login");
  };
  // Logout — wipe Chromium partition cookies via Electron IPC and tell the
  // server to forget its on-disk cookie file. Then bump the main-app refresh
  // tick so AC markers etc. reset, and close any open CF tabs to avoid them
  // showing a stale logged-in view.
  const onLogout = async () => {
    try { await window.cfapp?.logoutCf(); } catch {}
    try { await fetch("/api/auth/logout", { method: "POST" }); } catch {}
    setSubmitUrl(null); setStandingsUrl(null); setMysubsUrl(null); setLoginUrl(null);
    setActiveTab(null);
    setMainRefreshTick(t => t + 1);
  };

  // Main-app refresh: bumping this tick re-fetches whichever data the active
  // page is showing (contests / problems / my-status / statement). The
  // ProblemPage's draft / editor state is unaffected — those aren't driven
  // by useFetchJSON.
  const [mainRefreshTick, setMainRefreshTick] = useState(0);

  // Topbar nav — routes to the active pane.
  const onTopBack = () => {
    const f = activeFrame();
    if (f) f.back();
    else hist.back();
  };
  const onTopForward = () => {
    const f = activeFrame();
    if (f) f.forward();
    else hist.forward();
  };
  const onTopRefresh = () => {
    const f = activeFrame();
    if (f) { f.reload(); return; }
    // Main-app refresh re-fetches the active page's data via useFetchJSON's
    // refresh-tick. The route itself doesn't change, so the user stays on
    // whatever problem / contest / settings page they were looking at.
    setMainRefreshTick(t => t + 1);
  };
  const onTopHome = () => {
    if (!activeTab) {
      hist.push({ kind: "contests" });
      return;
    }
    // Each tab's Home = its initial URL.
    if (activeTab === "login") {
      loginFrame.current?.loadURL("https://codeforces.com/enter");
      return;
    }
    const home = tabHome(activeTab);
    if (!home) return;
    const f = activeFrame();
    if (f) f.loadURL(home);
    if (activeTab === "submit") setSubmitUrl(home);
    if (activeTab === "standings") setStandingsUrl(home);
    if (activeTab === "mysubs") setMysubsUrl(home);
  };

  // Ctrl+Wheel / Ctrl+0/+/- zoom for the host window. When a webview tab is
  // active the zoom is delegated to the webview handle (guest-side shim
  // handles Ctrl+wheel inside the guest process). The host-level handler
  // covers the main React app and also provides a fallback.
  // Subscribed ONCE ([] deps); it reads the live active tab via
  // activeFrameRef so we don't re-bind listeners on every render.
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const f = activeFrameRef.current;
      if (f) {
        if (e.deltaY < 0) f.zoomIn(); else f.zoomOut();
      } else {
        // zoom body
        const cur = parseFloat(document.body.style.zoom || "1");
        const next = e.deltaY < 0 ? cur * 1.1 : cur / 1.1;
        document.body.style.zoom = String(Math.max(0.25, Math.min(5, next)));
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const f = activeFrameRef.current;
      if (e.key === "=" || e.key === "+") { e.preventDefault(); if (f) f.zoomIn(); else document.body.style.zoom = String(Math.min(5, (parseFloat(document.body.style.zoom || "1")) * 1.1)); }
      if (e.key === "-") { e.preventDefault(); if (f) f.zoomOut(); else document.body.style.zoom = String(Math.max(0.25, (parseFloat(document.body.style.zoom || "1")) / 1.1)); }
      if (e.key === "0") { e.preventDefault(); if (f) f.zoomReset(); else document.body.style.zoom = "1"; }
    };
    window.addEventListener("wheel", onWheel, { passive: false, capture: true });
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("wheel", onWheel, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, []);

  const canBack = activeTab ? !!activeFrame()?.canGoBack() : hist.canBack;
  const canForward = activeTab ? !!activeFrame()?.canGoForward() : hist.canForward;
  // Touch navTick so canBack/canForward recompute when the active webview navigates.
  void navTick;

  return (
    <>
      <Topbar
        route={route}
        activeTab={activeTab}
        canBack={canBack}
        canForward={canForward}
        onBack={onTopBack}
        onForward={onTopForward}
        onHome={onTopHome}
        onRefresh={onTopRefresh}
        onSettings={() => { hist.push({ kind: "settings" }); setActiveTab(null); }}
        theme={theme}
        onToggleTheme={() => setTheme(t => t === "dark" ? "light" : "dark")}
        onOpenLogin={onOpenLogin}
        onLogout={onLogout}
      />
      {/* Main app — kept mounted, hidden when a CF tab is active so its
          state (scroll, draft, highlights, selection) survives switching. */}
      <div style={{ display: activeTab ? "none" : "block" }}>
        {route.kind === "contests" && <ContestsPage refreshTick={mainRefreshTick} onPick={c => hist.push({ kind: "problems", contest: c })} />}
        {route.kind === "problems" && <ProblemsPage refreshTick={mainRefreshTick} contest={route.contest}
          onPick={p => hist.push({ kind: "problem", contest: route.contest, problem: p })} />}
        {route.kind === "problem" && <ProblemPage refreshTick={mainRefreshTick} contest={route.contest} problem={route.problem}
          onOpenSubmitTab={onOpenSubmitTab} />}
        {route.kind === "settings" && <SettingsPage theme={theme} onToggleTheme={() => setTheme(t => t === "dark" ? "light" : "dark")} />}
        {route.kind === "stats" && <StatsPage refreshTick={mainRefreshTick} />}
      </div>
      {/* All four CF webviews are conditionally mounted but never unmounted
          once shown — switching tabs just toggles display:none. */}
      <PersistentCfFrame ref={submitFrame}    url={submitUrl}    active={activeTab === "submit"}    reloadKey={submitKey}    onNavStateChange={onNavStateChange} />
      <PersistentCfFrame ref={standingsFrame} url={standingsUrl} active={activeTab === "standings"} reloadKey={standingsKey} onNavStateChange={onNavStateChange} />
      <PersistentCfFrame ref={mysubsFrame}    url={mysubsUrl}    active={activeTab === "mysubs"}    reloadKey={mysubsKey}    onNavStateChange={onNavStateChange} />
      <PersistentCfFrame ref={loginFrame}     url={loginUrl}     active={activeTab === "login"}     reloadKey={loginKey}     onNavStateChange={onNavStateChange} />

      <BottomBar
        active={activeTab}
        activeRoute={route.kind}
        hasContest={!!ctxContest}
        onSwitch={onSwitchTab}
        onMain={() => { if (route.kind !== "contests") hist.push({ kind: "contests" }); setActiveTab(null); }}
        onNavigateStats={() => { hist.push({ kind: "stats" }); setActiveTab(null); }}
      />
    </>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
