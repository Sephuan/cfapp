# cfapp

A Codeforces client with a polished web UI: contest/problem browser, server-rendered LaTeX (KaTeX), inline AI translation with persistent annotations, optional auto-translate (full / section / paragraph) with rate limits, a syntax-highlighted code editor with autosave, an interactive stats dashboard, per-role fonts (including custom uploads), color themes and translation-annotation palettes, and a transparent Cloudflare bypass so submissions actually go through.

Three runtime modes, all backed by the same Bun HTTP server (`src/server.ts` in dev, `src/server-prod.ts` in packaged builds):

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

The first time, click **Login** in the top bar — a CF webview opens, you log in normally, and cookies sync back to the app config dir (mode 0600 on Unix) so the server-side API calls share the session.

## Platforms (Linux / macOS / Windows)

Runtime data is stored in the OS-native application directories (see `src/paths.ts`):

| | Linux | macOS | Windows |
|---|---|---|---|
| **Config** (settings, cookies, custom fonts, drafts) | `~/.config/cfapp/` | `~/Library/Application Support/cfapp/` | `%APPDATA%\cfapp\` |
| **Cache** (API, bundled fonts) | `~/.cache/cfapp/` | `~/Library/Caches/cfapp/` | `%LOCALAPPDATA%\cfapp\Cache\` |

Cross-platform behaviour that is already wired:

- **User-Agent** matches the host OS (Linux / macOS / Windows) so Cloudflare `cf_clearance` matches the Electron webview + curl replay.
- **Built-in fonts** (including the open “Georgia” = Gelasio under `font-family: Georgia`) download into the cache dir on first run. Mirrors include jsDelivr and npmmirror for better reach in China; once cached, loads are local (`/fonts/…`).
- **Custom fonts** — upload TTF / OTF / WOFF / WOFF2 in Settings → 字体; stored under `<configDir>/custom-fonts/`. Body / statement / display roles can each pick a custom family.
- **Microsoft Georgia** (real TTF, optional): auto-imported into the custom-font library when present — Windows `Fonts\georgia.ttf`, macOS Supplemental, Linux msttcorefonts / Wine / Proton. Distinct from the bundled Gelasio “Georgia”.
- **Legacy migration** — if you previously used `~/.config/cfapp` on macOS/Windows, data is copied into the OS-native config dir when the new dir is empty.
- **Packaging**: `bun run build:linux` / `build:mac` / `build:win`. Ship a **matching** Bun binary under `.bun-packaged` for the target OS/arch before packaging (cross-building needs that target’s Bun from [bun releases](https://github.com/oven-sh/bun/releases)).

Dev on any platform:

```bash
bun install
bun start          # Electron + Bun server
# or
bun run dev        # browser-only UI work
```

## Configuration

`<configDir>/config.json` (see table above; on Linux that is `~/.config/cfapp/config.json`):

```jsonc
{
  "handle": "your_handle",          // for rankings / my-status
  "apiKey": "...",                  // CF API key (settings → API)
  "apiSecret": "...",
  "password": "...",                // only needed for web-form submit fallback
  "proxy": "http://127.0.0.1:7890", // optional, applies to CF + AI calls
  "verifySsl": true,
  "ai": {                           // OpenAI-compatible endpoint for translation
    "baseUrl": "",                  // e.g. https://api.example.com/v1  (empty by default)
    "apiKey": "",
    "model": "",                    // empty until you pick one in Settings
    "targetLang": "中文",             // language AI translation renders into (preset or custom)
    "promptTemplate": "",            // system prompt; {lang}/{source_text} substituted (blank = built-in)
    "stream": true,                  // stream translation token-by-token
    // Auto-translate (problem page). "off" keeps manual selection-only behaviour.
    "autoMode": "off",               // off | full | section | paragraph
    "autoTrigger": "manual",         // manual button | onopen (start when the statement loads)
    "rpm": 5,                        // rolling 60s start budget; 0 = unlimited
    "concurrency": 2,                // max in-flight translation requests
    "requestIntervalMs": 200,        // min gap between request *starts*; also enforced after a finish before the next start
    "autoCollapse": false            // full-mode: collapse translation cards by default
  }
}
```

Sensitive fields are stored in plaintext; the file is written with mode `0600`. Don't fill `password` unless you need the web-form submit fallback (the webview's logged-in session is preferred).

AI **Base URL** and **model** default to empty — fill them (or use Settings → AI 翻译) for whichever OpenAI-compatible provider you use. No vendor endpoint is pre-filled.

Settings UI fields **autosave** (debounced); there is no separate Save button.

Two different "languages":

| Setting | Where | Stored in | Meaning |
|---|---|---|---|
| **App language** | Settings → 语言 | `localStorage` (`cfapp:lang`) | UI chrome: English / 中文 / bilingual |
| **AI target language** | Settings → AI 翻译 | `config.json` → `ai.targetLang` | Language the model translates *into* |

Client-only appearance (also `localStorage`):

| Setting | Key | Options |
|---|---|---|
| Color theme | `cfapp:color-theme` | Leather Book (default), Cool Gray, Forest, Rose Gold, Violet, Obsidian |
| Translation annotation style | `cfapp:tr-theme` | Amber 赭黄 (default), Ink 青墨, Indigo 靛蓝, Cinnabar 朱砂, Plum 紫藤 |
| Per-role fonts | `cfapp:font-{body,statement,display}` | Built-in stacks, custom family, or explicit default |

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
  server.ts              Bun HTTP server (dev / HMR): REST API, fonts, translation
  server-prod.ts         Production entry used by packaged Electron builds
  server-lib/            Shared server helpers (JSON body, config sanitize, drafts)
  api.ts                 re-export shim (backward compat)
  api/                   CF + AI backend modules
    html.ts              barrel for statement HTML parsing
    html-parts/          math (KaTeX / CF $$$$), statement, text, page-detect
    translate-prompt.ts  language-parameterized, injection-resistant system prompt
    translate-stream.ts  SSE streaming translation (throttled KaTeX, stall salvage)
    ai-probe.ts          list models / chat test / rate-limit probe for Settings
    cookie.ts            curl JA3 path + cookie jar
    avatar-cache.ts      proxy + disk cache for CF avatars
    …
  paths.ts               OS-native config/cache dirs + path allowlists
  custom-fonts.ts        user-uploaded font library under <configDir>/custom-fonts/
  config.ts              config.json load/save + migrations
  ac-store.ts            per-handle contest AC verdict persistence
  fonts.ts               multi-mirror font cache under <cacheDir>/fonts/
  web/
    app.tsx              root router + layout chrome
    auto-translate.ts    problem-page auto-translate orchestration
    rate-limiter.ts      dual limiter: request interval + rolling 60s RPM
    themes.ts            color themes, tr-annotation palettes, font-role metadata
    chrome.tsx           Topbar / BottomBar barrel
    chrome/              AuthIndicator, PersistentCfFrame
    pages/
      SettingsPage.tsx   account, language, AI, theme, fonts
      settings/          AI / auto-translate / model / font / custom-font UI
      ProblemPage.tsx    statement + editor + translation UI
      problem/           selection toolbar, popover, copy, request-translate
      StatsPage.tsx      dashboard shell
      stats/             charts, heatmap, avatar, cards
      ContestsPage.tsx / ProblemsPage.tsx
    styles/              base, problem, stats, settings, themes
    i18n.ts              app UI language (en / zh / mix) + dictionary
    shared.ts            Route, UserMe, AppConfig, …
  index.tsx              legacy terminal UI (OpenTUI)
  screens/               legacy TUI screens
electron/
  main.cjs               app shell, CF cookie sync, Turnstile solver
  preload.cjs            logout IPC bridge
bin/cfapp                standalone launcher (Chromium --app mode)
scripts/
  auth-codeforces.ts     headless CF login helper
  build-web.ts           bundle web UI into dist-web/
  seed-config.ts         write a starter config.json (dev convenience)
```

## Development

```bash
bun run typecheck    # tsc --noEmit
bun run test         # bun test
bun run build:web    # produce dist-web/ for Electron packaging
bun run build        # web bundle + electron-builder (Linux)
```

## Features

- **Contest & Problem browser** — paginated contest list with per-contest "x/y solved" badges synced from your full submission history in one pull; problem statements with server-rendered LaTeX (KaTeX), including Codeforces `$$$…$$$` math
- **Inline AI translation** — OpenAI-compatible endpoint translates problem text with persistent annotations; streams token-by-token with LaTeX and inline code preserved. Target language is configurable (中文 / English / 日本語 / 한국어 / … or custom); the system prompt is fully editable — the built-in one is injection-resistant so problem imperatives like "determine" or "output YES" are translated as text instead of obeyed. Base URL and model start empty until you configure them.
- **Auto-translate** — optional full / section / paragraph modes; manual trigger or start on open; dual rate limit (min gap between starts, and after a finish before the next start under concurrency) + rolling RPM; full-mode cards can default collapsed
- **Rate-limit probe** — Settings → auto-translate can fire a short burst with the *current* concurrency / interval / RPM; if the provider returns 429, that knobs set is too aggressive (manual check, not auto-tuning)
- **Bilingual UI** — English, 中文, or mixed bilingual chrome, instantly and per-client (`localStorage`)
- **Offline-tolerant & instant** — contest lists, problem statements, stats, and avatars are persisted locally and painted immediately on launch (show-cached-then-refresh), so the app stays usable when the network / VPN drops; avatars are proxied through the app's network path and byte-cached to disk
- **Code editor** — syntax-highlighted, autosave, direct submission via CF API or web-form fallback
- **Stats dashboard** — interactive rating history (tier bands, hover tooltips, drag-to-zoom + time-range presets), submission heatmap, verdict/language distribution, pure CSS + inline SVG (zero chart deps). Solve data is scoped per handle.
- **Fonts & themes** — body / statement / display roles from a multi-mirror local font cache; optional custom font library; six color themes; five translation-annotation palettes (赭黄 / 青墨 / 靛蓝 / 朱砂 / 紫藤) via `data-*` flips
- **Cloudflare bypass** — curl-based JA3 path with automatic `cf_clearance` renewal via Turnstile solver
- **Cross-platform** — Linux / macOS / Windows data dirs, UA, packaging targets, and optional Microsoft Georgia import
- **Modular codebase** — large surfaces split into focused modules under `api/`, `web/pages/`, `server-lib/`, with thin barrels for stable import paths
