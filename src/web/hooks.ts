import { useEffect, useState } from "react";
import type { Route } from "./shared";

// Module-scoped in-memory cache keyed by URL. Revisiting a list page (Back
// from a problem → Problems list) shows the same data instantly without
// flashing "Loading…", and the server is re-queried in the background. The
// server itself also caches and serves stale-while-revalidate
// (updateCacheIfNeeded), so the second leg is usually a no-op cache hit.
//
// Callers that want a *persistent* cache (surviving reload/restart) pass a
// `localStorageCache` descriptor — the entry is mirrored to localStorage under
// `<keyPrefix><url-without-query>`. We paint that saved value IMMEDIATELY
// regardless of age (show-then-refresh), then always re-fetch in the background
// and swap in fresh data if it arrives. This is what makes the homepage /
// contest / stats views feel instant on every launch and keeps showing
// last-known data when the network (VPN) is down. There is deliberately no TTL:
// the refresh always runs, so freshness is never sacrificed, and stale data is
// always preferable to a spinner or a blank page.
const __fetchCache = new Map<string, unknown>();

export type LocalStorageCache = { keyPrefix: string };

// Read the persisted value ignoring age — used to seed the first paint so the
// user never stares at a spinner when we have *something* to show.
function peekLsCache<T>(c: LocalStorageCache, cacheKey: string): T | null {
  try {
    const raw = localStorage.getItem(c.keyPrefix + cacheKey);
    if (!raw) return null;
    const { data } = JSON.parse(raw);
    return (data ?? null) as T | null;
  } catch {
    return null;
  }
}

function writeLsCache<T>(c: LocalStorageCache, cacheKey: string, data: T): void {
  try {
    localStorage.setItem(c.keyPrefix + cacheKey, JSON.stringify({ data, ts: Date.now() }));
  } catch {}
}

// `refreshTick` is a counter the caller bumps to force a re-fetch even when
// the URL hasn't changed (e.g. user pressed the topbar refresh button).
export function useFetchJSON<T>(
  url: string | null,
  refreshTick = 0,
  localStorageCache?: LocalStorageCache,
) {
  // Strip the query string before using it as a persistent cache key so that
  // a refresh (`?refresh=1`) doesn't fragment the cache.
  const cacheKey = url ? url.split("?")[0]! : "";
  const cached = url
    ? (localStorageCache ? peekLsCache<T>(localStorageCache, cacheKey) : null)
      ?? (__fetchCache.get(url) as T | undefined ?? null)
    : null;
  const [data, setData] = useState<T | null>(cached);
  const [err, setErr] = useState<string | null>(null);
  // Only show the loading state when we have nothing cached to display.
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    const hadMem = __fetchCache.has(url);
    const lsSeed = localStorageCache ? peekLsCache<T>(localStorageCache, cacheKey) : null;
    const hadLs = lsSeed !== null;
    // Re-seed `data` for the CURRENT url. This instance may be reused across a
    // url change (e.g. problem A → problem B); without this, `data` would keep
    // showing the previous entity until the network fetch resolves — wrong
    // content, or forever if offline. Prefer the in-memory value; fall back to
    // the persisted one so an LS-only entry is painted too.
    if (hadMem) setData(__fetchCache.get(url) as T);
    else if (hadLs) setData(lsSeed);
    else { setData(null); setLoading(true); }
    setErr(null);
    // A user-initiated refresh (topbar ↻ bumps refreshTick) means "get me new
    // data"; if that fails we must say so even when a cache is on screen, or the
    // failure is invisible. A passive/background refresh keeps silent and just
    // leaves the cached data up.
    const forced = refreshTick > 0;
    const u = forced
      ? url + (url.includes("?") ? "&" : "?") + "refresh=1"
      : url;
    fetch(u)
      .then((r) => r.ok ? r.json() : r.json().then((j) => { throw new Error(j.error ?? `HTTP ${r.status}`); }))
      .then((j) => {
        if (cancelled) return;
        __fetchCache.set(url, j);
        if (localStorageCache) writeLsCache(localStorageCache, cacheKey, j);
        setData(j);
      })
      // Keep showing cached data on a failed refresh (e.g. VPN dropped). Surface
      // an error when we have nothing to show, OR when the user explicitly asked
      // for a refresh (so a forced refresh that fails isn't silently swallowed).
      .catch((e) => { if (!cancelled && (forced || (!hadMem && !hadLs))) setErr(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [url, refreshTick, cacheKey, localStorageCache]);

  return { data, err, loading };
}

// Minimal browser-style history stack (back / forward / push). Avoids pulling
// in react-router for an app whose routes are a tagged-union discriminant.
export function useHistoryStack(initial: Route) {
  const [past, setPast] = useState<Route[]>([]);
  const [present, setPresent] = useState<Route>(initial);
  const [future, setFuture] = useState<Route[]>([]);

  const push = (r: Route) => {
    setPast((p) => [...p, present]);
    setPresent(r);
    setFuture([]);
  };
  const back = () => {
    if (!past.length) return;
    const prev = past[past.length - 1]!;
    setPast((p) => p.slice(0, -1));
    setFuture((f) => [present, ...f]);
    setPresent(prev);
  };
  const forward = () => {
    if (!future.length) return;
    const next = future[0]!;
    setFuture((f) => f.slice(1));
    setPast((p) => [...p, present]);
    setPresent(next);
  };

  return {
    route: present,
    push,
    back,
    forward,
    canBack: past.length > 0,
    canForward: future.length > 0,
  };
}
