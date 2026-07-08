// Local font cache. We serve Newsreader from `~/.cache/cfapp/fonts/` so the
// browser never needs to talk to fonts.googleapis.com — handy when the user is
// behind GFW or has the launcher in --app mode (which ignores system proxy).
//
// Format: jsdelivr distributes @fontsource packages with predictable URLs.
// We grab the .woff2 and an inline @font-face CSS file the first time.
import { existsSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const CACHE_DIR = join(homedir(), ".cache", "cfapp", "fonts");

type FontFace = {
  family: string;
  weight: number;
  style: "normal" | "italic";
  pkg: string;        // fontsource package name (used to build mirror URLs)
  variant: string;    // e.g. "newsreader-latin-400-normal"
  file: string;       // local filename — extension picks the @font-face format
  directUrl?: string; // skip mirrors, fetch this exact URL (single source)
  directUrls?: string[]; // try each URL in order; first that succeeds wins
  systemPaths?: string[]; // try copying from these absolute paths first
};

// Mirrors are tried in order. jsdelivr first (works for most), npmmirror next
// (best for mainland China), unpkg last (often slow but rarely blocked).
const MIRRORS = [
  (pkg: string, variant: string) => `https://cdn.jsdelivr.net/npm/@fontsource/${pkg}@latest/files/${variant}.woff2`,
  (pkg: string, variant: string) => `https://registry.npmmirror.com/@fontsource/${pkg}/latest/files/files/${variant}.woff2`,
  (pkg: string, variant: string) => `https://unpkg.com/@fontsource/${pkg}@latest/files/${variant}.woff2`,
];

const FACES: FontFace[] = [
  // Newsreader (body, default)
  ...[400, 500, 600, 700].flatMap((w): FontFace[] => [
    { family: "Newsreader", weight: w, style: "normal",
      pkg: "newsreader", variant: `newsreader-latin-${w}-normal`, file: `newsreader-${w}.woff2` },
    { family: "Newsreader", weight: w, style: "italic",
      pkg: "newsreader", variant: `newsreader-latin-${w}-italic`, file: `newsreader-${w}i.woff2` },
  ]),
  // Source Serif 4 (body, alternate)
  ...[400, 500, 600, 700].flatMap((w): FontFace[] => [
    { family: "Source Serif 4", weight: w, style: "normal",
      pkg: "source-serif-4", variant: `source-serif-4-latin-${w}-normal`, file: `source-serif-4-${w}.woff2` },
    { family: "Source Serif 4", weight: w, style: "italic",
      pkg: "source-serif-4", variant: `source-serif-4-latin-${w}-italic`, file: `source-serif-4-${w}i.woff2` },
  ]),
  // EB Garamond (statement default + body alternate) — classical Garamond
  // revival. Primary face for --font-statement (the problem-statement reading
  // surface) and one of the switchable body fonts. Must be cached: it is NOT
  // installed system-wide on most machines, so without this the whole
  // statement surface silently falls back to Georgia.
  ...[400, 500, 600, 700].flatMap((w): FontFace[] => [
    { family: "EB Garamond", weight: w, style: "normal",
      pkg: "eb-garamond", variant: `eb-garamond-latin-${w}-normal`, file: `eb-garamond-${w}.woff2` },
    { family: "EB Garamond", weight: w, style: "italic",
      pkg: "eb-garamond", variant: `eb-garamond-latin-${w}-italic`, file: `eb-garamond-${w}i.woff2` },
  ]),
  // Lora (body + statement alternate) — contemporary brushed serif, soft
  // curves, wide set. Distinct warm reading face vs the sharper Newsreader.
  ...[400, 500, 600, 700].flatMap((w): FontFace[] => [
    { family: "Lora", weight: w, style: "normal",
      pkg: "lora", variant: `lora-latin-${w}-normal`, file: `lora-${w}.woff2` },
    { family: "Lora", weight: w, style: "italic",
      pkg: "lora", variant: `lora-latin-${w}-italic`, file: `lora-${w}i.woff2` },
  ]),
  // Spectral (body + statement alternate) — screen-tuned literary serif by
  // Production Type, refined and text-oriented.
  ...[400, 500, 600, 700].flatMap((w): FontFace[] => [
    { family: "Spectral", weight: w, style: "normal",
      pkg: "spectral", variant: `spectral-latin-${w}-normal`, file: `spectral-${w}.woff2` },
    { family: "Spectral", weight: w, style: "italic",
      pkg: "spectral", variant: `spectral-latin-${w}-italic`, file: `spectral-${w}i.woff2` },
  ]),
  // Bitter (body alternate) — slab serif; square bracketed serifs make it the
  // most visually distinct reading face in the set.
  ...[400, 500, 600, 700].flatMap((w): FontFace[] => [
    { family: "Bitter", weight: w, style: "normal",
      pkg: "bitter", variant: `bitter-latin-${w}-normal`, file: `bitter-${w}.woff2` },
    { family: "Bitter", weight: w, style: "italic",
      pkg: "bitter", variant: `bitter-latin-${w}-italic`, file: `bitter-${w}i.woff2` },
  ]),
  // Libre Baskerville (statement alternate) — high-contrast Baskerville with a
  // very large x-height, tuned for on-screen body text; crisp and legible.
  ...[400, 500, 600, 700].flatMap((w): FontFace[] => [
    { family: "Libre Baskerville", weight: w, style: "normal",
      pkg: "libre-baskerville", variant: `libre-baskerville-latin-${w}-normal`, file: `libre-baskerville-${w}.woff2` },
    { family: "Libre Baskerville", weight: w, style: "italic",
      pkg: "libre-baskerville", variant: `libre-baskerville-latin-${w}-italic`, file: `libre-baskerville-${w}i.woff2` },
  ]),
  // Playfair Display (titles, fallback)
  ...[500, 700].flatMap((w): FontFace[] => [
    { family: "Playfair Display", weight: w, style: "normal",
      pkg: "playfair-display", variant: `playfair-display-latin-${w}-normal`, file: `playfair-${w}.woff2` },
    { family: "Playfair Display", weight: w, style: "italic",
      pkg: "playfair-display", variant: `playfair-display-latin-${w}-italic`, file: `playfair-${w}i.woff2` },
  ]),
  // Cormorant Garamond (topbar brand) — classical Garamond revival with the
  // long-descender italic `f` the user asked for ("three-grid f").
  ...[500, 600, 700].flatMap((w): FontFace[] => [
    { family: "Cormorant Garamond", weight: w, style: "normal",
      pkg: "cormorant-garamond", variant: `cormorant-garamond-latin-${w}-normal`, file: `cormorant-garamond-${w}.woff2` },
    { family: "Cormorant Garamond", weight: w, style: "italic",
      pkg: "cormorant-garamond", variant: `cormorant-garamond-latin-${w}-italic`, file: `cormorant-garamond-${w}i.woff2` },
  ]),
  // JetBrains Mono (code)
  ...[400, 500, 600].map((w): FontFace => ({
    family: "JetBrains Mono", weight: w, style: "normal",
    pkg: "jetbrains-mono", variant: `jetbrains-mono-latin-${w}-normal`,
    file: `jetbrains-mono-${w}.woff2`,
  })),
  // LXGW WenKai (霞鹜文楷) — open-source kaishu by lxgw. The user has the
  // full TTFs installed system-wide; we copy them into the cache so the
  // webview can fetch via /fonts/* without going through fontconfig.
  // Falls back to GitHub releases if the system files aren't present.
  {
    family: "LXGW WenKai", weight: 400, style: "normal",
    pkg: "lxgw-wenkai", variant: "lxgw-wenkai-regular",
    file: "lxgw-wenkai-regular.ttf",
    systemPaths: [
      join(homedir(), ".local/share/fonts/LXGWWenKai-Regular.ttf"),
      "/usr/share/fonts/LXGWWenKai-Regular.ttf",
      "/usr/local/share/fonts/LXGWWenKai-Regular.ttf",
    ],
    directUrls: [
      "https://github.com/lxgw/LxgwWenKai/releases/download/v1.510/LXGWWenKai-Regular.ttf",
      "https://cdn.jsdelivr.net/gh/lxgw/LxgwWenKai@main/dist/LXGWWenKai-Regular.ttf",
    ],
  },
  {
    family: "LXGW WenKai", weight: 500, style: "normal",
    pkg: "lxgw-wenkai", variant: "lxgw-wenkai-medium",
    file: "lxgw-wenkai-medium.ttf",
    systemPaths: [
      join(homedir(), ".local/share/fonts/LXGWWenKai-Medium.ttf"),
      "/usr/share/fonts/LXGWWenKai-Medium.ttf",
      "/usr/local/share/fonts/LXGWWenKai-Medium.ttf",
    ],
    directUrls: [
      "https://github.com/lxgw/LxgwWenKai/releases/download/v1.510/LXGWWenKai-Medium.ttf",
      "https://cdn.jsdelivr.net/gh/lxgw/LxgwWenKai@main/dist/LXGWWenKai-Medium.ttf",
    ],
  },
];

async function downloadOnce(face: FontFace): Promise<boolean> {
  const out = join(CACHE_DIR, face.file);
  if (existsSync(out)) return true;
  // 1. Try system paths first — instant, no network.
  if (face.systemPaths) {
    for (const sp of face.systemPaths) {
      try {
        if (existsSync(sp) && statSync(sp).size > 1000) {
          copyFileSync(sp, out);
          return true;
        }
      } catch { /* try next */ }
    }
  }
  // 2. Fall back to network mirrors.
  const urls = face.directUrls
    ? face.directUrls
    : face.directUrl
    ? [face.directUrl]
    : MIRRORS.map((make) => make(face.pkg, face.variant));
  const isWoff2 = face.file.endsWith(".woff2");
  for (const url of urls) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (!r.ok) continue;
      const buf = new Uint8Array(await r.arrayBuffer());
      if (buf.length < 100) continue;
      // sanity: woff2 starts with "wOF2" (0x77 4F 46 32);
      // TTF starts with 0x00 01 00 00 or "OTTO" (0x4F 54 54 4F) or "true".
      if (isWoff2) {
        if (buf[0] !== 0x77 || buf[1] !== 0x4F) continue;
      } else {
        const ttfOk =
          (buf[0] === 0x00 && buf[1] === 0x01 && buf[2] === 0x00 && buf[3] === 0x00) ||
          (buf[0] === 0x4F && buf[1] === 0x54 && buf[2] === 0x54 && buf[3] === 0x4F) ||
          (buf[0] === 0x74 && buf[1] === 0x72 && buf[2] === 0x75 && buf[3] === 0x65);
        if (!ttfOk) continue;
      }
      writeFileSync(out, buf);
      return true;
    } catch { /* try next mirror */ }
  }
  return false;
}

// Kick off downloads in the background — page can serve a system fallback in
// the meantime. The CSS keeps the same family names so once the woff2 lands,
// next reload picks it up.
export function primeFontCache(): void {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  const total = FACES.length;
  let done = 0, ok = 0;
  for (const f of FACES) {
    downloadOnce(f).then((success) => {
      done++;
      if (success) ok++;
      if (done === total) {
        console.log(`fonts: ${ok}/${total} cached at ${CACHE_DIR}`);
      }
    }).catch(() => { done++; });
  }
}

export function fontFile(name: string): { body: ArrayBuffer; type: string } | null {
  const path = join(CACHE_DIR, name);
  if (!existsSync(path)) return null;
  const bytes = readFileSync(path);
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const type = name.endsWith(".woff2") ? "font/woff2"
    : name.endsWith(".woff") ? "font/woff"
    : name.endsWith(".otf") ? "font/otf"
    : "font/ttf";
  return { body, type };
}

// CSS served at /fonts/fonts.css — defines @font-face for every cached file.
export function fontsCss(): string {
  const lines: string[] = [];
  for (const f of FACES) {
    if (!existsSync(join(CACHE_DIR, f.file))) continue;
    const fmt = f.file.endsWith(".woff2") ? "woff2"
      : f.file.endsWith(".woff") ? "woff"
      : f.file.endsWith(".otf") ? "opentype"
      : "truetype";
    lines.push(
      `@font-face{font-family:"${f.family}";font-style:${f.style};` +
      `font-weight:${f.weight};font-display:swap;` +
      `src:url("/fonts/${f.file}") format("${fmt}");}`
    );
  }
  return lines.join("\n");
}
