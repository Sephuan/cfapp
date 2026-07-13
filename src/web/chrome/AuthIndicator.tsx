import { useEffect, useRef, useState } from "react";
import type { UserMe } from "../shared";
import { TIER_COLOR } from "../shared";
import { useLang, t } from "../i18n";

// ----- auth indicator (in the topbar) -----
export function AuthIndicator({ onLogin, onLogout }: { onLogin: () => void; onLogout: () => void }) {
  const [lang] = useLang();
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
        title={t(lang, "auth.loginTooltip")}>
        <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 4, background: "var(--err)", marginRight: 6, verticalAlign: "middle" }} />
        {t(lang, "nav.login")}
      </button>
    );
  }

  const tier = me?.tier ?? "unrated";
  const color = TIER_COLOR[tier];
  const handle = me?.handle ?? status.handle ?? t(lang, "auth.loggedIn");
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
        title={me?.rank ? `${me.rank}${rating != null ? ` · ${rating}` : ""}` : t(lang, "auth.loggedIn")}
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
            {me?.rank ?? (me?.rating != null ? t(lang, "auth.rated") : t(lang, "auth.unrated"))}
            {rating != null ? <> · <b style={{ color }}>{rating}</b></> : null}
            {me?.maxRating != null && me?.maxRating !== rating ? <> · {t(lang, "auth.max")} {me.maxRating}</> : null}
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
          >{t(lang, "auth.logout")}</button>
        </div>
      )}
    </span>
  );
}

