// Cross-platform application directories and browser UA.
//
// Linux  → XDG (~/.config/cfapp, ~/.cache/cfapp)
// macOS  → ~/Library/Application Support/cfapp, ~/Library/Caches/cfapp
// Windows → %APPDATA%\cfapp, %LOCALAPPDATA%\cfapp\Cache
//
// Older builds always used ~/.config/cfapp and ~/.cache/cfapp on every OS.
// migrateLegacyDataDirs() copies those trees once into the platform dirs.
//
// Override with CFAPP_CONFIG_DIR / CFAPP_CACHE_DIR when needed (tests, portable).

import { existsSync, mkdirSync, readdirSync, realpathSync, cpSync } from "fs";
import { homedir, platform } from "os";
import { join, resolve } from "path";

export type HostPlatform = "linux" | "darwin" | "win32" | "other";

export function hostPlatform(): HostPlatform {
  const p = platform();
  if (p === "linux" || p === "darwin" || p === "win32") return p;
  return "other";
}

/** True when running under Windows (including path style). */
export function isWindows(): boolean {
  return hostPlatform() === "win32";
}

export function isMac(): boolean {
  return hostPlatform() === "darwin";
}

export function isLinux(): boolean {
  return hostPlatform() === "linux";
}

/**
 * Durable user config (config.json, cookies, custom fonts, drafts, ac store).
 * Modeled after XDG on Linux, Application Support on macOS, APPDATA on Windows.
 */
export function configDir(): string {
  if (process.env.CFAPP_CONFIG_DIR) return process.env.CFAPP_CONFIG_DIR;
  const home = homedir();
  switch (hostPlatform()) {
    case "darwin":
      return join(home, "Library", "Application Support", "cfapp");
    case "win32": {
      const base = process.env.APPDATA || join(home, "AppData", "Roaming");
      return join(base, "cfapp");
    }
    default: {
      // Linux + other Unix: respect XDG_CONFIG_HOME
      const xdg = process.env.XDG_CONFIG_HOME || join(home, ".config");
      return join(xdg, "cfapp");
    }
  }
}

/**
 * Rebuildable caches (API cache, bundled font downloads, launcher profile).
 */
export function cacheDir(): string {
  if (process.env.CFAPP_CACHE_DIR) return process.env.CFAPP_CACHE_DIR;
  const home = homedir();
  switch (hostPlatform()) {
    case "darwin":
      return join(home, "Library", "Caches", "cfapp");
    case "win32": {
      const base = process.env.LOCALAPPDATA || join(home, "AppData", "Local");
      return join(base, "cfapp", "Cache");
    }
    default: {
      const xdg = process.env.XDG_CACHE_HOME || join(home, ".cache");
      return join(xdg, "cfapp");
    }
  }
}

export function ensureDir(dir: string): string {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/** Pre-platform-paths layout (every OS used these historically). */
export function legacyConfigDir(): string {
  return join(homedir(), ".config", "cfapp");
}

export function legacyCacheDir(): string {
  return join(homedir(), ".cache", "cfapp");
}

function dirIsMissingOrEmpty(dir: string): boolean {
  if (!existsSync(dir)) return true;
  try {
    return readdirSync(dir).length === 0;
  } catch {
    return true;
  }
}

/**
 * One-shot copy of legacy ~/.config/cfapp → platform configDir (and cache)
 * when the new location is empty but the old tree has data. Safe no-op when
 * paths coincide (Linux default) or CFAPP_*_DIR overrides are set.
 * Leaves the legacy tree in place (does not delete).
 */
export function migrateLegacyDataDirs(): void {
  // Explicit overrides: user owns the path; never surprise-migrate into it.
  if (process.env.CFAPP_CONFIG_DIR || process.env.CFAPP_CACHE_DIR) return;

  const cfg = configDir();
  const legCfg = legacyConfigDir();
  if (resolve(cfg) !== resolve(legCfg) && existsSync(legCfg) && dirIsMissingOrEmpty(cfg)) {
    try {
      ensureDir(cfg);
      cpSync(legCfg, cfg, { recursive: true, force: false, errorOnExist: false });
      console.log(`paths: migrated config ${legCfg} → ${cfg}`);
    } catch (e: any) {
      console.warn(`paths: config migration failed: ${e?.message || e}`);
    }
  }

  const cache = cacheDir();
  const legCache = legacyCacheDir();
  if (resolve(cache) !== resolve(legCache) && existsSync(legCache) && dirIsMissingOrEmpty(cache)) {
    try {
      ensureDir(cache);
      cpSync(legCache, cache, { recursive: true, force: false, errorOnExist: false });
      console.log(`paths: migrated cache ${legCache} → ${cache}`);
    } catch (e: any) {
      console.warn(`paths: cache migration failed: ${e?.message || e}`);
    }
  }
}

/** Normalize to absolute, collapse `..`, resolve symlinks when the path exists. */
export function canonicalizePath(p: string): string | null {
  if (!p) return null;
  try {
    const abs = resolve(p);
    if (existsSync(abs)) {
      try {
        return realpathSync(abs);
      } catch {
        return abs;
      }
    }
    // File may not exist yet — still collapse .. via resolve().
    return abs;
  } catch {
    return null;
  }
}

function pathIsInside(child: string, parent: string): boolean {
  const c = child.replace(/\\/g, "/").replace(/\/+$/, "");
  const p = parent.replace(/\\/g, "/").replace(/\/+$/, "");
  if (c === p) return true;
  // Ensure boundary: parent/foo yes, parent-evil no.
  const prefix = p.endsWith("/") ? p : p + "/";
  return c.startsWith(prefix) || c.toLowerCase().startsWith(prefix.toLowerCase());
}

// ── Chromium User-Agent (must match Electron webview platform for CF) ──────
// Chrome major must stay in sync with Electron's Chromium (currently 148).
const CHROME_MAJOR = "148";
const CHROME_FULL = `${CHROME_MAJOR}.0.0.0`;

/**
 * Platform-correct Chrome UA for Codeforces / Cloudflare.
 * Linux builds used to hardcode X11 for everyone — that mismatches macOS /
 * Windows webviews and can cause cf_clearance fingerprint drift.
 */
export function chromeUserAgent(): string {
  switch (hostPlatform()) {
    case "darwin":
      return (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
        `(KHTML, like Gecko) Chrome/${CHROME_FULL} Safari/537.36`
      );
    case "win32":
      return (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        `(KHTML, like Gecko) Chrome/${CHROME_FULL} Safari/537.36`
      );
    default:
      return (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) " +
        `Chrome/${CHROME_FULL} Safari/537.36`
      );
  }
}

/** @deprecated use chromeUserAgent() — kept for grep-friendly re-exports */
export const UA = chromeUserAgent();

/**
 * Whether an absolute path is allowed for server-side font import.
 * Users may only import fonts they can already read under home / system font dirs.
 *
 * Uses resolve() + realpathSync (when present) so `$HOME/../../etc/passwd` and
 * symlink escapes cannot pass a naive prefix check.
 */
export function isAllowedFontImportPath(p: string): boolean {
  if (!p) return false;
  const canon = canonicalizePath(p);
  if (!canon) return false;

  const home = canonicalizePath(homedir()) || resolve(homedir());
  if (pathIsInside(canon, home)) return true;

  if (isWindows()) {
    const windir = process.env.WINDIR || process.env.SystemRoot || "C:\\Windows";
    const fontsDir = canonicalizePath(join(windir, "Fonts")) || resolve(windir, "Fonts");
    if (pathIsInside(canon, fontsDir)) return true;
    return false;
  }

  if (isMac()) {
    for (const root of [
      "/System/Library/Fonts",
      "/Library/Fonts",
      join(home, "Library", "Fonts"),
    ]) {
      const r = canonicalizePath(root) || resolve(root);
      if (pathIsInside(canon, r)) return true;
    }
    return false;
  }

  // Linux / other — fixed system roots + Steam/Wine only under $HOME.
  for (const root of ["/usr/share/fonts", "/usr/local/share/fonts"]) {
    const r = canonicalizePath(root) || resolve(root);
    if (pathIsInside(canon, r)) return true;
  }
  // Wine / Proton prefixes only if they sit inside the home directory tree.
  const homeSlash = home.replace(/\\/g, "/");
  const c = canon.replace(/\\/g, "/");
  if (c.startsWith(homeSlash + "/")) {
    if (c.includes("/.wine/") && /\/drive_c\/[Ww]indows\/[Ff]onts(\/|$)/.test(c)) return true;
    if (c.includes("/.var/app/com.valvesoftware.Steam/") && /\/fonts\/[^/]+\.ttf$/i.test(c)) return true;
    if (c.includes("/.local/share/Steam/") && /\/fonts\/[^/]+\.ttf$/i.test(c)) return true;
    // Broader: any *Fonts* dir under a Wine prefix in home
    if (c.includes("/drive_c/windows/Fonts/") || c.includes("/drive_c/Windows/Fonts/")) return true;
  }
  return false;
}

/**
 * Candidate absolute paths for the real Microsoft Georgia TTF (user-owned installs only).
 * Never download this font — only copy if present.
 */
export function microsoftGeorgiaCandidates(): string[] {
  const home = homedir();
  const out: string[] = [];

  if (isWindows()) {
    const windir = process.env.WINDIR || process.env.SystemRoot || "C:\\Windows";
    // Standard Windows core fonts (regular / bold / italic / bold-italic names).
    for (const name of ["georgia.ttf", "Georgia.ttf", "georgiab.ttf", "georgiai.ttf", "georgiaz.ttf"]) {
      out.push(join(windir, "Fonts", name));
    }
    return out;
  }

  if (isMac()) {
    out.push("/System/Library/Fonts/Supplemental/Georgia.ttf");
    out.push("/System/Library/Fonts/Supplemental/Georgia Bold.ttf");
    out.push("/System/Library/Fonts/Supplemental/Georgia Italic.ttf");
    out.push("/System/Library/Fonts/Supplemental/Georgia Bold Italic.ttf");
    out.push("/Library/Fonts/Georgia.ttf");
    out.push(join(home, "Library", "Fonts", "Georgia.ttf"));
    return out;
  }

  // Linux: msttcorefonts, Wine, Steam Proton
  out.push(
    "/usr/share/fonts/truetype/msttcorefonts/Georgia.ttf",
    "/usr/share/fonts/truetype/msttcorefonts/Georgia_Bold.ttf",
    "/usr/share/fonts/truetype/msttcorefonts/Georgia_Italic.ttf",
    "/usr/share/fonts/truetype/msttcorefonts/Georgia_Bold_Italic.ttf",
    "/usr/share/fonts/msttcorefonts/Georgia.ttf",
    join(home, ".wine/drive_c/windows/Fonts/georgia.ttf"),
    join(home, ".wine/drive_c/windows/Fonts/Georgia.ttf"),
    join(
      home,
      ".var/app/com.valvesoftware.Steam/.local/share/Steam/steamapps/common",
      "Proton - Experimental/files/share/fonts/georgia.ttf",
    ),
    join(
      home,
      ".local/share/Steam/steamapps/common",
      "Proton - Experimental/files/share/fonts/georgia.ttf",
    ),
  );
  return out;
}

/** Guess weight/style from a Microsoft Georgia filename. */
export function guessGeorgiaFace(filePath: string): { weight: number; style: "normal" | "italic" } {
  const base = filePath.replace(/\\/g, "/").split("/").pop()?.toLowerCase() || "";
  if (base.includes("bold") && base.includes("italic") || base === "georgiaz.ttf") {
    return { weight: 700, style: "italic" };
  }
  if (base.includes("bold") || base === "georgiab.ttf") {
    return { weight: 700, style: "normal" };
  }
  if (base.includes("italic") || base === "georgiai.ttf") {
    return { weight: 400, style: "italic" };
  }
  return { weight: 400, style: "normal" };
}
