import {
  LLMTagger,
  type LLMTaggerConfig
} from "./LLMTagger.js";

export interface OpenAITaggerConfig extends LLMTaggerConfig {}

const buildOpenAiTaggerSystemPrompt = (allowedAiTags: string[]): string =>
  "You are a strict memory tagger. Return JSON only. " +
  `Allowed tags: ${allowedAiTags.join(", ")}. ` +
  'Format: {"tags":["<allowed_tag>"],"importantScore":0.0-1.0}. ';

export class OpenAITagger extends LLMTagger {
  constructor(config: OpenAITaggerConfig) {
    super(config, {
      providerName: "OpenAI",
      defaultBaseUrl: "https://api.openai.com/v1",
      buildSystemPrompt: buildOpenAiTaggerSystemPrompt
    });
  }
}
