import { useEffect, useState } from "react";
import type { Route } from "./shared";

// Module-scoped in-memory cache keyed by URL. Revisiting a list page (Back
// from a problem → Problems list) shows the same data instantly without
// flashing "Loading…", and the server is re-queried in the background. The
// server itself also caches and serves stale-while-revalidate
// (updateCacheIfNeeded), so the second leg is usually a no-op cache hit.
//
// Callers that want a *persistent* cache (surviving reload, with TTL) pass a
// `localStorageCache` descriptor — the entry is then mirrored to localStorage
// under `<keyPrefix><url-without-query>` and used as the initial state.
const __fetchCache = new Map<string, unknown>();

export type LocalStorageCache = { keyPrefix: string; ttlMs: number };

function readLsCache<T>(c: LocalStorageCache, cacheKey: string): T | null {
  try {
    const raw = localStorage.getItem(c.keyPrefix + cacheKey);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts > c.ttlMs) return null;
    return data as T;
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
    ? (localStorageCache ? readLsCache<T>(localStorageCache, cacheKey) : null)
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
    const hadLs = localStorageCache ? readLsCache<T>(localStorageCache, cacheKey) !== null : false;
    if (hadMem) setData(__fetchCache.get(url) as T);
    if (!hadMem && !hadLs) setLoading(true);
    setErr(null);
    const u = refreshTick > 0
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
      .catch((e) => { if (!cancelled) setErr(e.message); })
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
