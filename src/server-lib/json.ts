// Shared JSON response helper for the Bun HTTP servers.
// no-store: the Electron host keeps a Chromium HTTP cache (persist:cf
// partition, cleared only on launch). Without an explicit freshness
// directive, a 200 with no Cache-Control gets heuristic-cached, so a
// passive re-fetch (e.g. navigating back to the contest list, which
// re-GETs /api/ac-sync WITHOUT ?refresh=1) can be served from that
// cache instead of the server — and a freshly-recorded problemCount
// never shows until the user manually refreshes. no-store defeats the
// heuristic so every passive fetch really hits the server.
export const json = (data: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      ...(init?.headers ?? {}),
    },
  });
