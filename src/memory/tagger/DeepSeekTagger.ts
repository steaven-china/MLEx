import {
  LLMTagger,
  type LLMTaggerConfig
} from "./LLMTagger.js";

export interface DeepSeekTaggerConfig extends LLMTaggerConfig {}

const buildDeepSeekTaggerSystemPrompt = (allowedAiTags: string[]): string =>
  "Tag memory block importance. Return JSON only. " +
  `Allowed tags: ${allowedAiTags.join(", ")}. ` +
  'Format: {"tags":["<allowed_tag>"],"importantScore":0.0-1.0}. ';

export class DeepSeekTagger extends LLMTagger {
  constructor(config: DeepSeekTaggerConfig) {
    super(config, {
      providerName: "DeepSeek",
      defaultBaseUrl: "https://api.deepseek.com/v1",
      buildSystemPrompt: buildDeepSeekTaggerSystemPrompt
    });
  }
}
