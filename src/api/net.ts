// Module-scoped constants shared across the API layer, plus the small
// `withNetworkOptions` helper that injects proxy / TLS-verify flags into a
// fetch RequestInit (Bun reads these custom keys).
import type { CFConfig } from "../config";
import type { BunFetchInit } from "./types";

import { join } from "path";
import { cacheDir, chromeUserAgent } from "../paths";

export const BASE_URL = "https://codeforces.com/api";
export const CACHE_DIR = join(cacheDir(), "api");

// CF binds CSRF tokens to session cookies (JSESSIONID, 39ce7, _tta, ...). We
// also need a realistic UA — CF returns a Cloudflare interstitial for
// obviously-non-browser UAs. Platform-correct string from paths.ts; Electron
// main must use the same chromeUserAgent() so cf_clearance matches curl replay.
export const UA = chromeUserAgent();

export function withNetworkOptions(config: CFConfig | undefined, init: RequestInit): BunFetchInit {
  const next = { ...init } as BunFetchInit;
  if (config?.proxy?.trim()) next.proxy = config.proxy.trim();
  if (config && config.verifySsl === false) {
    next.tls = { ...(next.tls ?? {}), rejectUnauthorized: false };
  }
  return next;
}
