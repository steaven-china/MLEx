import {
  LLMRelationExtractor,
  type LLMRelationExtractorConfig
} from "./LLMRelationExtractor.js";

export interface DeepSeekRelationExtractorConfig extends LLMRelationExtractorConfig {}

const DEEPSEEK_RELATION_SYSTEM_PROMPT =
  "Extract relations. Return strict JSON only with key relations. " +
  'Format: {"relations":[{"src":"neighbor_block_id","dst":"current_block_id","type":"FOLLOWS|CAUSES|PARENT_TASK|CHILD_TASK|ALTERNATIVE|CONTEXT","confidence":0.0-1.0}]}.';

export class DeepSeekRelationExtractor extends LLMRelationExtractor {
  constructor(config: DeepSeekRelationExtractorConfig) {
    super(config, {
      providerName: "DeepSeek",
      defaultBaseUrl: "https://api.deepseek.com/v1",
      systemPrompt: DEEPSEEK_RELATION_SYSTEM_PROMPT
    });
  }
}
