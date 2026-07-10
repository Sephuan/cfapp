// Avatar proxy + on-disk byte cache. CF avatars live on userpic.codeforces.org
// / CDN hosts that the browser would otherwise fetch DIRECTLY — bypassing the
// app's proxy and vanishing the moment the VPN drops (and Electron wipes its
// HTTP cache on every launch). Routing them through the local server means:
//   • they go through the same proxy-aware network path as the API, so if the
//     API works without a VPN the avatar does too;
//   • the bytes are cached to disk and served cache-first, so a cached avatar
//     shows instantly and survives restarts and offline periods.
//
// CF avatar URLs embed a content hash (e.g. …/avatar/e55b2c97d0cc2561.jpg), so
// a changed avatar is a different URL → a different cache entry. We therefore
// never need to revalidate: cache-first with no expiry is always correct.
//
// Because we never revalidate, the cache must never store a NON-image body: a
// Cloudflare interstitial or error page returned with HTTP 200 would otherwise
// be served as an image forever, permanently breaking the avatar. We sniff the
// magic bytes and refuse to cache anything that isn't a recognized image, and
// we derive the served content-type from those bytes so the disk-served type
// matches the network-served one exactly (even for extension-less URLs).
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import type { CFConfig } from "../config";
import { CACHE_DIR, UA, withNetworkOptions } from "./net";

const AVATAR_DIR = join(CACHE_DIR, "avatars");

// Only proxy CF-owned image hosts — this endpoint takes a URL from the client,
// so an allowlist keeps it from being turned into an open proxy/SSRF vector.
const ALLOWED_HOSTS = new Set([
  "userpic.codeforces.org",
  "userpic.codeforces.com",
  "cdn.codeforces.com",
  "assets.codeforces.com",
  "sta.codeforces.com",
  "codeforces.org",
  "codeforces.com",
]);

// Sniff the leading bytes to decide the real image type. Returns null for
// anything that isn't a recognized image (HTML challenge page, JSON error,
// empty body) so the caller can refuse to cache/serve it. The detected type is
// what we persist and serve, so network and disk paths always agree. Exported
// for unit testing.
export function sniffImageType(b: Uint8Array): string | null {
  if (b.length < 4) return null;
  // JPEG: FF D8 FF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  // PNG: 89 50 4E 47
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  // GIF: "GIF8"
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  // WEBP: "RIFF"...."WEBP"
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  // SVG / XML: skip a UTF-8 BOM + leading whitespace, then look for an svg root.
  let i = 0;
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) i = 3;
  while (i < b.length && (b[i] === 0x20 || b[i] === 0x09 || b[i] === 0x0a || b[i] === 0x0d)) i++;
  const head = new TextDecoder().decode(b.slice(i, Math.min(b.length, i + 256))).toLowerCase();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) return "image/svg+xml";
  return null;
}

// The stored image mime ⇆ cached-file extension. The extension is part of the
// filename so the cached entry carries its own type — no sidecar, and the
// disk-read path resolves the exact same content-type it was fetched with.
const TYPE_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};
const EXT_TO_TYPE: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};

// Stable, collision-resistant filename stem for a URL. sha1 (hex) is wide
// enough that distinct avatar URLs never share a cache file.
function keyOf(u: string): string {
  return createHash("sha1").update(u).digest("hex");
}

// A Node Buffer's .buffer may be a shared pool slice, so copy out exactly the
// entry's bytes into a standalone ArrayBuffer for the Response body.
function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

export type AvatarBytes = { body: ArrayBuffer; type: string };

// Resolve an avatar URL to bytes, cache-first. Returns null for a disallowed
// host, a malformed URL, a non-image response, or a genuine miss that also
// fails to download (offline with nothing cached) — the caller renders a
// fallback (initials) in that case.
export async function serveAvatar(config: CFConfig, rawUrl: string): Promise<AvatarBytes | null> {
  let url: URL;
  try { url = new URL(rawUrl); } catch { return null; }
  // https only: no plaintext downgrade, and it narrows the SSRF surface.
  if (url.protocol !== "https:") return null;
  if (!ALLOWED_HOSTS.has(url.hostname)) return null;

  const stem = join(AVATAR_DIR, keyOf(rawUrl));

  // Cache-first: a saved copy is served without touching the network, so
  // avatars keep working offline and across restarts. The extension on the
  // cached file names its image type, so the served content-type is exact.
  for (const ext of Object.keys(EXT_TO_TYPE)) {
    const file = `${stem}.${ext}`;
    if (existsSync(file)) {
      try {
        return { body: toArrayBuffer(readFileSync(file)), type: EXT_TO_TYPE[ext]! };
      } catch { /* fall through to refetch */ }
    }
  }

  try {
    const resp = await fetch(rawUrl, withNetworkOptions(config, {
      headers: { "User-Agent": UA },
      // Don't follow redirects: the allowlist only vetted the initial host, so
      // a 3xx to an internal/other host would be an SSRF bypass. A redirect is
      // treated as a miss (→ null → 404 → initials fallback).
      redirect: "manual",
    }));
    if (!resp.ok) return null;
    const ab = await resp.arrayBuffer();
    const bytes = new Uint8Array(ab);
    // Only cache/serve genuine images. A 200 HTML interstitial or empty body
    // sniffs to null → we never poison the cache with it.
    const type = sniffImageType(bytes);
    if (!type) return null;
    const ext = TYPE_TO_EXT[type]!;
    try {
      mkdirSync(AVATAR_DIR, { recursive: true });
      // Write to a temp file then rename so a concurrent reader (or a crash
      // mid-write) never sees a truncated cache entry — rename is atomic.
      const tmp = `${stem}.${ext}.${process.pid}.tmp`;
      writeFileSync(tmp, bytes);
      renameSync(tmp, `${stem}.${ext}`);
    } catch { /* serving still works even if the cache write fails */ }
    return { body: ab, type };
  } catch {
    return null;
  }
}
