import React, { useEffect, useImperativeHandle, useRef } from "react";
import type { CfFrameHandle } from "../shared";

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

