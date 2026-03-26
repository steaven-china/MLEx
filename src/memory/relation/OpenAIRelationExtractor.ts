import {
  LLMRelationExtractor,
  type LLMRelationExtractorConfig
} from "./LLMRelationExtractor.js";

export interface OpenAIRelationExtractorConfig extends LLMRelationExtractorConfig {}

const OPENAI_RELATION_SYSTEM_PROMPT =
  "You extract relations between memory blocks. Return strict JSON only. " +
  'Format: {"relations":[{"src":"neighbor_block_id","dst":"current_block_id","type":"FOLLOWS|CAUSES|PARENT_TASK|CHILD_TASK|ALTERNATIVE|CONTEXT","confidence":0.0-1.0}]}.';

export class OpenAIRelationExtractor extends LLMRelationExtractor {
  constructor(config: OpenAIRelationExtractorConfig) {
    super(config, {
      providerName: "OpenAI",
      defaultBaseUrl: "https://api.openai.com/v1",
      systemPrompt: OPENAI_RELATION_SYSTEM_PROMPT
    });
  }
}
