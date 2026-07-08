import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export interface CFConfig {
  handle: string;
  apiKey: string;
  apiSecret: string;
  password: string;
  proxy: string;
  verifySsl: boolean;
  ai: {
    baseUrl: string;
    apiKey: string;
    model: string;
  };
}

const CONFIG_DIR = join(homedir(), ".config", "cfapp");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");
// NOTE: Sensitive fields (password, apiKey, apiSecret) are stored in plaintext.
// For production, consider encrypting these values or using system keychain.

export function loadConfig(): CFConfig {
  const defaults: CFConfig = {
    handle: "",
    apiKey: "",
    apiSecret: "",
    password: "",
    proxy: "",
    verifySsl: true,
    ai: {
      baseUrl: "https://token.sensenova.cn/v1",
      apiKey: "",
      model: "sensenova-6.7-flash-lite",
    },
  };
  if (existsSync(CONFIG_FILE)) {
    try {
      const data = JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
      return {
        handle: data.handle || defaults.handle,
        apiKey: data.apiKey || data.api_key || defaults.apiKey,
        apiSecret: data.apiSecret || data.api_secret || defaults.apiSecret,
        password: data.password || defaults.password,
        proxy: data.proxy || defaults.proxy,
        verifySsl: data.verifySsl ?? data.verify_ssl ?? defaults.verifySsl,
        ai: {
          baseUrl: data.ai?.baseUrl || defaults.ai.baseUrl,
          apiKey: data.ai?.apiKey || defaults.ai.apiKey,
          model: data.ai?.model || defaults.ai.model,
        },
      };
    } catch {
      return defaults;
    }
  }
  return defaults;
}

export function saveConfig(config: CFConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
  try {
    chmodSync(CONFIG_FILE, 0o600);
  } catch {
    // Best effort. Some filesystems ignore chmod.
  }
}

export function isAuthenticated(config: CFConfig): boolean {
  return !!(config.handle && config.apiKey && config.apiSecret);
}
