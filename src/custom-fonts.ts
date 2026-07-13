// User-supplied fonts: stored under <configDir>/custom-fonts/, served as
// @font-face via /fonts/custom/* and listed for the Settings picker.
//
// Separate from the built-in FACES in fonts.ts (those are open redistributable
// faces). Custom files may include proprietary fonts the user already owns
// locally (e.g. Microsoft Georgia from Windows Fonts / macOS Supplemental /
// Linux msttcorefonts or Proton) — we only copy paths the user can already
// read; we never download MS Georgia.

import {
  existsSync, mkdirSync, writeFileSync, readFileSync,
  unlinkSync, readdirSync, statSync,
} from "fs";
import { join, basename } from "path";
import { createHash, randomBytes } from "crypto";
import {
  configDir,
  isAllowedFontImportPath,
  microsoftGeorgiaCandidates,
  guessGeorgiaFace,
} from "./paths";

const ROOT = join(configDir(), "custom-fonts");
const FILES_DIR = join(ROOT, "files");
const MANIFEST = join(ROOT, "manifest.json");

export type CustomFontFace = {
  file: string;          // basename under files/
  weight: number;
  style: "normal" | "italic";
};

export type CustomFont = {
  id: string;
  family: string;        // CSS font-family name
  faces: CustomFontFace[];
  source?: string;       // optional human note (e.g. "imported from …")
  createdAt: number;
};

type Manifest = { fonts: CustomFont[] };

function ensureDirs() {
  if (!existsSync(ROOT)) mkdirSync(ROOT, { recursive: true });
  if (!existsSync(FILES_DIR)) mkdirSync(FILES_DIR, { recursive: true });
}

function loadManifest(): Manifest {
  ensureDirs();
  if (!existsSync(MANIFEST)) return { fonts: [] };
  try {
    const j = JSON.parse(readFileSync(MANIFEST, "utf-8"));
    const fonts = Array.isArray(j?.fonts) ? j.fonts : [];
    return { fonts: fonts.filter((f: any) => f && typeof f.id === "string" && typeof f.family === "string") };
  } catch {
    return { fonts: [] };
  }
}

function saveManifest(m: Manifest) {
  ensureDirs();
  writeFileSync(MANIFEST, JSON.stringify(m, null, 2), { mode: 0o600 });
}

function newId(): string {
  return randomBytes(6).toString("hex");
}

function safeFileBase(name: string): string {
  return basename(name).replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "font";
}

function detectFormat(buf: Uint8Array): "woff2" | "woff" | "truetype" | "opentype" | null {
  if (buf.length < 4) return null;
  if (buf[0] === 0x77 && buf[1] === 0x4f && buf[2] === 0x46 && buf[3] === 0x32) return "woff2";
  if (buf[0] === 0x77 && buf[1] === 0x4f && buf[2] === 0x46 && buf[3] === 0x46) return "woff";
  if (buf[0] === 0x4f && buf[1] === 0x54 && buf[2] === 0x54 && buf[3] === 0x4f) return "opentype";
  if (buf[0] === 0x00 && buf[1] === 0x01 && buf[2] === 0x00 && buf[3] === 0x00) return "truetype";
  if (buf[0] === 0x74 && buf[1] === 0x72 && buf[2] === 0x75 && buf[3] === 0x65) return "truetype";
  return null;
}

function extForFormat(fmt: string): string {
  if (fmt === "woff2") return ".woff2";
  if (fmt === "woff") return ".woff";
  if (fmt === "opentype") return ".otf";
  return ".ttf";
}

export function listCustomFonts(): CustomFont[] {
  return loadManifest().fonts.slice().sort((a, b) => a.family.localeCompare(b.family));
}

export function getCustomFont(id: string): CustomFont | null {
  return loadManifest().fonts.find((f) => f.id === id) ?? null;
}

export function customFontFile(name: string): { body: ArrayBuffer; type: string } | null {
  const base = basename(name);
  if (!base || base !== name || name.includes("..")) return null;
  const path = join(FILES_DIR, base);
  if (!existsSync(path)) return null;
  const bytes = readFileSync(path);
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const type = base.endsWith(".woff2") ? "font/woff2"
    : base.endsWith(".woff") ? "font/woff"
    : base.endsWith(".otf") ? "font/otf"
    : "font/ttf";
  return { body, type };
}

export function customFontsCss(): string {
  const lines: string[] = [];
  for (const font of listCustomFonts()) {
    for (const face of font.faces) {
      const path = join(FILES_DIR, face.file);
      if (!existsSync(path)) continue;
      const fmt = face.file.endsWith(".woff2") ? "woff2"
        : face.file.endsWith(".woff") ? "woff"
        : face.file.endsWith(".otf") ? "opentype"
        : "truetype";
      const weight = Number.isFinite(face.weight) ? face.weight : 400;
      const style = face.style === "italic" ? "italic" : "normal";
      lines.push(
        `@font-face{font-family:"${font.family.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}";` +
        `font-style:${style};font-weight:${weight};font-display:swap;` +
        `src:url("/fonts/custom/${face.file}") format("${fmt}");}`,
      );
    }
  }
  return lines.join("\n");
}

export type AddFaceInput = {
  name?: string;
  data: Uint8Array | Buffer;
  weight?: number;
  style?: "normal" | "italic";
};

export function addCustomFont(opts: {
  family: string;
  id?: string;
  faces: AddFaceInput[];
  source?: string;
}): { ok: true; font: CustomFont } | { ok: false; error: string } {
  const family = String(opts.family || "").trim();
  if (!family) return { ok: false, error: "Family name is empty" };
  if (family.length > 80) return { ok: false, error: "Family name too long" };
  if (!opts.faces?.length) return { ok: false, error: "No font files" };

  ensureDirs();
  const m = loadManifest();
  // Prefer explicit id; otherwise merge into an existing family of the same
  // name so a second upload (italic/bold) can append faces instead of 400.
  let font = opts.id ? m.fonts.find((f) => f.id === opts.id) : undefined;
  if (opts.id && !font) return { ok: false, error: "Font id not found" };
  if (!font) {
    font = m.fonts.find((f) => f.family === family);
  }

  if (!font) {
    font = {
      id: newId(),
      family,
      faces: [],
      source: opts.source,
      createdAt: Date.now(),
    };
    m.fonts.push(font);
  }

  for (const face of opts.faces) {
    const buf = face.data instanceof Uint8Array ? face.data : new Uint8Array(face.data);
    if (buf.length < 100) return { ok: false, error: "Font file too small" };
    const fmt = detectFormat(buf);
    if (!fmt) return { ok: false, error: "Not a recognized font file (ttf/otf/woff/woff2)" };
    const weight = Number.isFinite(face.weight) ? Math.max(100, Math.min(900, Math.round(face.weight!))) : 400;
    const style = face.style === "italic" ? "italic" : "normal";
    const hash = createHash("sha1").update(buf).digest("hex").slice(0, 10);
    const base = safeFileBase(face.name || `font-${weight}`);
    const stem = base.replace(/\.(ttf|otf|woff2?|TTF|OTF|WOFF2?)$/i, "");
    const file = `${font.id}-${stem}-${weight}${style === "italic" ? "i" : ""}-${hash}${extForFormat(fmt)}`;
    writeFileSync(join(FILES_DIR, file), buf);
    font.faces = font.faces.filter((x) => !(x.weight === weight && x.style === style));
    font.faces.push({ file, weight, style });
    font.faces.sort((a, b) => a.weight - b.weight || a.style.localeCompare(b.style));
  }
  if (opts.source) font.source = opts.source;
  saveManifest(m);
  return { ok: true, font };
}

export function deleteCustomFont(id: string): { ok: true } | { ok: false; error: string } {
  const m = loadManifest();
  const idx = m.fonts.findIndex((f) => f.id === id);
  if (idx < 0) return { ok: false, error: "Not found" };
  const [font] = m.fonts.splice(idx, 1);
  for (const face of font?.faces ?? []) {
    try { unlinkSync(join(FILES_DIR, face.file)); } catch {}
  }
  saveManifest(m);
  return { ok: true };
}

export function importCustomFontFromPath(opts: {
  family: string;
  path: string;
  weight?: number;
  style?: "normal" | "italic";
  source?: string;
}): { ok: true; font: CustomFont } | { ok: false; error: string } {
  const p = String(opts.path || "").trim();
  // Absolute path: Unix "/" or Windows "C:\…"
  const isAbs = p.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(p);
  if (!isAbs) return { ok: false, error: "Path must be absolute" };
  // Allowlist on the raw path first (cheap reject), then again after realpath.
  if (!existsSync(p) || !statSync(p).isFile()) return { ok: false, error: "File not found" };
  // Allowlist after the file exists so realpath() resolves symlinks (a link
  // under $HOME must not point at /etc/…). Also collapses .. via resolve().
  if (!isAllowedFontImportPath(p)) return { ok: false, error: "Path not in an allowed directory" };
  let data: Buffer;
  try {
    data = readFileSync(p);
  } catch (e: any) {
    return { ok: false, error: e?.message || "Cannot read file" };
  }
  // Merge by family name when re-importing extra weights (seed path).
  const existing = listCustomFonts().find((f) => f.family === opts.family);
  return addCustomFont({
    family: opts.family,
    id: existing?.id,
    faces: [{ name: basename(p), data, weight: opts.weight ?? 400, style: opts.style ?? "normal" }],
    source: opts.source ?? `imported from ${p}`,
  });
}

const MS_GEORGIA_FAMILY = "Microsoft Georgia";

/**
 * If the user already has Microsoft Georgia on disk (Windows Fonts / macOS
 * Supplemental / Linux msttcorefonts·Wine·Proton) and we haven't imported it
 * yet, copy into the custom library as "Microsoft Georgia" — distinct from
 * the open Gelasio face registered as "Georgia" in fonts.ts.
 *
 * Imports every weight/style variant found (regular, bold, italic, …).
 */
export function seedMicrosoftGeorgia(): CustomFont | null {
  const existing = listCustomFonts().find(
    (f) => f.family === MS_GEORGIA_FAMILY || f.id === "ms-georgia",
  );
  if (existing) return existing;

  let font: CustomFont | null = null;
  for (const p of microsoftGeorgiaCandidates()) {
    if (!existsSync(p)) continue;
    try {
      if (statSync(p).size < 10_000) continue;
    } catch { continue; }
    const { weight, style } = guessGeorgiaFace(p);
    if (!font) {
      const r = importCustomFontFromPath({
        family: MS_GEORGIA_FAMILY,
        path: p,
        weight,
        style,
        source: `Microsoft Georgia (local: ${p})`,
      });
      if (r.ok) {
        font = r.font;
        console.log(`fonts: seeded Microsoft Georgia from ${p}`);
      }
    } else {
      // Append additional faces onto the same family.
      try {
        const data = readFileSync(p);
        const r = addCustomFont({
          id: font.id,
          family: MS_GEORGIA_FAMILY,
          faces: [{ name: basename(p), data, weight, style }],
          source: font.source,
        });
        if (r.ok) font = r.font;
      } catch {}
    }
  }
  return font;
}

export function pruneCustomFontOrphans(): void {
  ensureDirs();
  const keep = new Set<string>();
  for (const f of listCustomFonts()) {
    for (const face of f.faces) keep.add(face.file);
  }
  try {
    for (const name of readdirSync(FILES_DIR)) {
      if (!keep.has(name)) {
        try { unlinkSync(join(FILES_DIR, name)); } catch {}
      }
    }
  } catch {}
}

export { MS_GEORGIA_FAMILY, FILES_DIR as CUSTOM_FONTS_DIR };
