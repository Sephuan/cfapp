// Module-scoped constants shared across the API layer, plus the small
// `withNetworkOptions` helper that injects proxy / TLS-verify flags into a
// fetch RequestInit (Bun reads these custom keys).
import type { CFConfig } from "../config";
import type { BunFetchInit } from "./types";

import { homedir } from "os";
import { join } from "path";

export const BASE_URL = "https://codeforces.com/api";
export const CACHE_DIR = join(homedir(), ".cache", "cfapp", "api");

// CF binds CSRF tokens to session cookies (JSESSIONID, 39ce7, _tta, ...). We
// also need a realistic UA — CF returns a Cloudflare interstitial for
// obviously-non-browser UAs. Keep this in sync with CF_USER_AGENT in
// electron/main.cjs so the curl replay matches what cf_clearance was issued
// under.
export const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/148.0.0.0 Safari/537.36";

export function withNetworkOptions(config: CFConfig | undefined, init: RequestInit): BunFetchInit {
  const next = { ...init } as BunFetchInit;
  if (config?.proxy?.trim()) next.proxy = config.proxy.trim();
  if (config && config.verifySsl === false) {
    next.tls = { ...(next.tls ?? {}), rejectUnauthorized: false };
  }
  return next;
}
