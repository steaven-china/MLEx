import type { AppConfig } from "../../config.js";
import type { IDebugTraceRecorder } from "../../debug/DebugTraceRecorder.js";
import { DeepSeekTagger } from "./DeepSeekTagger.js";
import { HeuristicTagger } from "./HeuristicTagger.js";
import { normalizeAllowedAiTags } from "./TagNormalizer.js";
import type { LLMFallbackDetails } from "./LLMTagger.js";
import { OpenAITagger } from "./OpenAITagger.js";
import type { ITagger } from "./Tagger.js";

export function buildTagger(config: AppConfig, traceRecorder?: IDebugTraceRecorder): ITagger {
  const importantThreshold = Math.min(1, Math.max(0, config.component.taggerImportantThreshold));
  const allowedAiTags = normalizeAllowedAiTags(config.component.allowedAiTags);

  const recordFallback = (provider: "openai" | "deepseek", details: LLMFallbackDetails): void => {
    traceRecorder?.record("tagger", `${provider}.fallback`, details);
    console.warn(`[tagger:${provider}] fallback ${details.reason} block=${details.blockId}`);
  };

  if (config.component.tagger === "deepseek") {
    if (!config.service.deepseekApiKey) {
      throw new Error("DEEPSEEK_API_KEY is required when tagger is deepseek. You can also use heuristic.");
    }
    return new DeepSeekTagger({
      apiKey: config.service.deepseekApiKey,
      baseUrl: config.service.deepseekBaseUrl,
      model: config.component.taggerModel || config.service.deepseekModel,
      timeoutMs: config.component.taggerTimeoutMs,
      importantThreshold,
      allowedAiTags,
      onFallback: (details) => {
        recordFallback("deepseek", details);
      }
    });
  }

  if (config.component.tagger === "openai") {
    if (!config.service.openaiApiKey) {
      throw new Error("OPENAI_API_KEY is required when tagger is openai. You can also use heuristic.");
    }
    return new OpenAITagger({
      apiKey: config.service.openaiApiKey,
      baseUrl: config.service.openaiBaseUrl,
      model: config.component.taggerModel,
      timeoutMs: config.component.taggerTimeoutMs,
      importantThreshold,
      allowedAiTags,
      onFallback: (details) => {
        recordFallback("openai", details);
      }
    });
  }

  return new HeuristicTagger({ importantThreshold, allowedAiTags });
}
