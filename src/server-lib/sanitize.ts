import type { CFConfig } from "../config";

/** Public config shape returned to the Settings UI (secrets still included — local app). */
export const sanitize = (c: CFConfig) => ({
  handle: c.handle,
  apiKey: c.apiKey,
  apiSecret: c.apiSecret,
  password: c.password,
  proxy: c.proxy,
  verifySsl: c.verifySsl,
  ai: {
    baseUrl: c.ai.baseUrl,
    apiKey: c.ai.apiKey,
    model: c.ai.model,
    targetLang: c.ai.targetLang,
    promptTemplate: c.ai.promptTemplate,
    stream: c.ai.stream,
    autoMode: c.ai.autoMode,
    autoTrigger: c.ai.autoTrigger,
    rpm: c.ai.rpm,
    concurrency: c.ai.concurrency,
    autoCollapse: c.ai.autoCollapse,
    requestIntervalMs: c.ai.requestIntervalMs,
  },
});
