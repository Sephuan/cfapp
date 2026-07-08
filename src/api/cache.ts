// Two-tier cache (in-memory Map + JSON files under .cfapp-cache/) with a
// stale-while-revalidate fetcher wrapper. Used by every CF API function.
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "fs";
import { CACHE_DIR } from "./net";

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const cache = new Map<string, CacheEntry<unknown>>();
const CACHE_TTL = 24 * 60 * 60 * 1000;

function initCache(): void {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
  }
  try {
    const files = existsSync(CACHE_DIR) ? readdirSync(CACHE_DIR) : [];
    for (const file of files) {
      if (file.endsWith(".json")) {
        const key = file.replace(".json", "");
        const path = `${CACHE_DIR}/${file}`;
        try {
          const content = readFileSync(path, "utf-8");
          const entry = JSON.parse(content) as CacheEntry<unknown>;
          cache.set(key, entry);
        } catch {
          // ignore corrupted files
        }
      }
    }
  } catch {
    // ignore errors during init
  }
}

export function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  return entry.data as T;
}

export function setCached<T>(key: string, data: T): void {
  const entry: CacheEntry<T> = { data, timestamp: Date.now() };
  cache.set(key, entry);
  try {
    if (!existsSync(CACHE_DIR)) {
      mkdirSync(CACHE_DIR, { recursive: true });
    }
    writeFileSync(`${CACHE_DIR}/${key}.json`, JSON.stringify(entry));
  } catch {
    // ignore write errors
  }
}

export async function updateCacheIfNeeded<T>(key: string, fetcher: () => Promise<T>, force = false): Promise<T> {
  if (force) {
    const data = await fetcher();
    setCached(key, data);
    return data;
  }
  const entry = cache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL) {
    return entry.data as T;
  }

  if (entry) {
    // stale-while-revalidate: return old data, refresh in background
    setTimeout(async () => {
      try {
        const newData = await fetcher();
        setCached(key, newData);
      } catch {
        // ignore update errors
      }
    }, 100);
    return entry.data as T;
  }

  const data = await fetcher();
  setCached(key, data);
  return data;
}

export function clearCache(): void {
  cache.clear();
}

initCache();
