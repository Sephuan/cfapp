# cfapp

A Codeforces client with a polished web UI: contest/problem browser, server-rendered LaTeX (KaTeX), inline AI translation with persistent annotations, syntax-highlighted code editor with autosave, an interactive stats dashboard, per-role font and color-theme customization, and a transparent Cloudflare bypass so submissions actually go through.

Three runtime modes, all backed by the same Bun HTTP server (`src/server.ts`):

| Mode | Command | What it is |
|---|---|---|
| **Electron app** (recommended) | `bun start` or `electron .` | Frameless desktop window. Embeds real CF pages via `<webview>` under a persistent `persist:cf` partition — that's where `cf_clearance` lives, auto-refreshed by a background Turnstile solver. |
| **Launcher** | `bash ./bin/cfapp` | Picks an installed Chromium, opens it in `--app` mode with an isolated profile. Same cookie isolation, no Electron dependency. |
| **Dev** | `bun run dev` | Bun's HMR server on `http://localhost:3000`, open in any browser. No CF cookie partition — use this for UI work only. |

A legacy terminal UI (`src/index.tsx` + `src/screens/`) is also present via `bun run tui`; it is not the maintained surface.

## Quick start

```bash
bun install
bun run dev            # terminal prints the URL
```

For real CF login + submissions, use the Electron app:

```bash
bun start
```

The first time, click **Login** in the top bar — a CF webview opens, you log in normally, and cookies sync back to `~/.config/cfapp/codeforces-cookies.json` (mode 0600) so the server-side API calls share the session.

## Configuration

`~/.config/cfapp/config.json`:

```jsonc
{
  "handle": "your_handle",          // for rankings / my-status
  "apiKey": "...",                  // CF API key (settings → API)
  "apiSecret": "...",
  "password": "...",                // only needed for web-form submit fallback
  "proxy": "http://127.0.0.1:7890", // optional, applies to CF + AI calls
  "verifySsl": true,
  "ai": {                           // OpenAI-compatible endpoint for translation
    "baseUrl": "",
    "apiKey": "",
    "model": ""
  }
}
```

Sensitive fields are stored in plaintext; the file is written with mode `0600`. Don't fill `password` unless you need the web-form submit fallback (the webview's logged-in session is preferred).

## How the Cloudflare bypass works

`codeforces.com` sits behind Cloudflare, which fingerprints the TLS handshake (JA3). Bun's fetch — like Node's and Deno's — has a recognizable non-Chrome JA3 and gets the "Just a moment" challenge even with a valid `cf_clearance` cookie. curl's JA3 happens to pass.

So in `src/api/cookie.ts`, every request to `*.codeforces.com` is routed through a curl subprocess (`jarFetchViaCurl`) that preserves real-Chrome header casing and replays the session cookie jar. Everything else (AI translate, font downloads) goes through plain `fetch`.

The Electron main process (`electron/main.cjs`) additionally:

- pins the `persist:cf` partition's User-Agent to a Chrome major that matches the bundled Chromium, so `cf_clearance` is issued under a UA the server can replay;
- watches every CF response for 403, purges the now-revoked `cf_clearance`, and opens a tiny background window to let Turnstile re-issue one;
- syncs the partition's cookies to disk so the Bun server's curl calls see the same session.

## Project layout

```
src/
  server.ts          Bun HTTP server: REST API, font proxy, translation rendering
  api.ts             re-export shim (backward compat)
  api/               CF API modules (types, net, cache, cookie, html, cf-api, auth, tiers)
  config.ts          ~/.config/cfapp/config.json load/save
  ac-store.ts        per-handle contest AC verdict persistence (survives CF rate-limiting; bulk-synced from user.status)
  fonts.ts           multi-mirror font cache under ~/.cache/cfapp/fonts/
  web/
    app.tsx          root router + layout chrome
    pages/           ContestsPage, ProblemsPage, ProblemPage, StatsPage, SettingsPage
    styles/          per-page CSS (base, problem, stats, settings, themes)
    shared.ts        shared types (Route, UserMe, AppConfig, etc.)
    chrome.tsx       Topbar + BottomBar + PersistentCfFrame
    hooks.ts         useFetchJSON, useHistoryStack
    index.html
  index.tsx          legacy terminal UI (OpenTUI)
  screens/           legacy terminal UI screens
electron/
  main.cjs           app shell, CF cookie sync, Turnstile solver
  preload.cjs        logout IPC bridge
bin/cfapp            standalone launcher (auto-picks Chromium, --app mode)
scripts/
  auth-codeforces.ts headless CF login helper
  seed-config.ts     write a starter config.json
```

## Development

```bash
bun run typecheck    # tsc --noEmit
bun run test         # bun test
```

## Features

- **Contest & Problem browser** — paginated contest list with per-contest "x/y solved" badges synced from your full submission history in one pull; problem statements with server-rendered LaTeX (KaTeX)
- **Inline AI translation** — OpenAI-compatible endpoint translates problem text with persistent annotations
- **Code editor** — syntax-highlighted, autosave, direct submission via CF API or web-form fallback
- **Stats dashboard** — interactive rating history (tier bands, hover tooltips, drag-to-zoom + time-range presets), submission heatmap, verdict/language distribution, all rendered with pure CSS + inline SVG (zero chart deps). Solve data is scoped per handle, so switching accounts never leaks the wrong stats.
- **Fonts & themes** — per-role serif fonts (body / statement / display) served from a local `@fontsource` cache, plus swappable color themes (leather-book, cool-gray, forest, rosegold, violet, obsidian) and translation-annotation palettes, all applied via `data-*` attribute flips with no re-render
- **Cloudflare bypass** — curl-based JA3 impersonation with automatic `cf_clearance` renewal via Turnstile solver
- **Modular API layer** — `src/api/` split into focused modules (types, net, cache, cookie, html, cf-api, auth, tiers) with backward-compatible barrel export
