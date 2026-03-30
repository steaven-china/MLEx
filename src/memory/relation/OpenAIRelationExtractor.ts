import {
  LLMRelationExtractor,
  type LLMRelationExtractorConfig
} from "./LLMRelationExtractor.js";

export interface OpenAIRelationExtractorConfig extends LLMRelationExtractorConfig {}

const OPENAI_RELATION_SYSTEM_PROMPT =
  "You extract semantic relations between memory blocks. Return strict JSON only. " +
  'Format: {"relations":[{"src":"block_id_or_empty","dst":"block_id_or_empty","type":"RELATION_TYPE","confidence":0.0-1.0}]}. ' +
  "Allowed types for block-to-block relations: FOLLOWS, CAUSES, PARENT_TASK, CHILD_TASK, ALTERNATIVE, CONTEXT, or any descriptive keyword (e.g. name, events, topic). " +
  "Types SNAPSHOT_OF_FILE and FILE_MENTIONS_BLOCK are reserved for file-entity relations only — do NOT use them for plain block IDs. " +
  "Allow either src or dst to be empty string to denote an unnamed entity, but not both empty.";

export class OpenAIRelationExtractor extends LLMRelationExtractor {
  constructor(config: OpenAIRelationExtractorConfig) {
    super(config, {
      providerName: "OpenAI",
      defaultBaseUrl: "https://api.openai.com/v1",
      systemPrompt: OPENAI_RELATION_SYSTEM_PROMPT
    });
  }
}
