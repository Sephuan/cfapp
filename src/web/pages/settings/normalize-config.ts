import type { AppConfig } from "../../shared";
import { DEFAULT_TRANSLATE_PROMPT } from "../../../api/translate-prompt";

// Fill in fields an older server (or a config.json predating a feature) may omit,
// so the form never renders a blank control for something that has a default.
// Mirrors loadConfig() defaults for every AI field the form touches.
export function normalizeConfig(c: AppConfig): AppConfig {
  const ai = c.ai ?? ({} as AppConfig["ai"]);
  return {
    ...c,
    ai: {
      ...ai,
      baseUrl: ai.baseUrl ?? "",
      apiKey: ai.apiKey ?? "",
      model: ai.model ?? "",
      targetLang: ai.targetLang ?? "中文",
      promptTemplate: ai.promptTemplate || DEFAULT_TRANSLATE_PROMPT,
      stream: ai.stream ?? true,
      autoMode: ai.autoMode ?? "off",
      autoTrigger: ai.autoTrigger ?? "manual",
      rpm: ai.rpm ?? 5,
      concurrency: ai.concurrency ?? 2,
      requestIntervalMs: ai.requestIntervalMs ?? 200,
      autoCollapse: ai.autoCollapse ?? false,
    },
  };
}
