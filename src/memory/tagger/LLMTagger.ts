import type { BlockTag } from "../../types.js";
import { normalizeAllowedAiTags } from "./TagNormalizer.js";
import type { MemoryBlock } from "../MemoryBlock.js";
import { HeuristicTagger } from "./HeuristicTagger.js";
import type { ITagger } from "./Tagger.js";

export interface LLMFallbackDetails {
  reason: string;
  blockId: string;
}

export interface LLMTaggerConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
  timeoutMs?: number;
  importantThreshold: number;
  allowedAiTags?: string[];
  onFallback?: (details: LLMFallbackDetails) => void;
}

export interface LLMTaggerOptions {
  providerName: string;
  defaultBaseUrl: string;
  buildSystemPrompt: (allowedAiTags: string[]) => string;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

interface TaggerPayload {
  tags?: string[];
  importantScore?: number;
}

export class LLMTagger implements ITagger {
  private readonly fallback: HeuristicTagger;
  private readonly timeoutMs: number;
  private readonly baseUrl: string;
  private readonly allowedAiTags: string[];
  private readonly systemPrompt: string;

  constructor(
    private readonly config: LLMTaggerConfig,
    private readonly options: LLMTaggerOptions
  ) {
    this.timeoutMs = config.timeoutMs ?? 10_000;
    this.baseUrl = config.baseUrl ?? options.defaultBaseUrl;
    this.allowedAiTags = normalizeAllowedAiTags(config.allowedAiTags);
    this.systemPrompt = options.buildSystemPrompt(this.allowedAiTags);
    this.fallback = new HeuristicTagger({
      importantThreshold: config.importantThreshold,
      allowedAiTags: this.allowedAiTags
    });
  }

  async tag(block: MemoryBlock): Promise<BlockTag[]> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let response: Response;
      try {
        response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.config.apiKey}`
          },
          body: JSON.stringify({
            model: this.config.model,
            temperature: 0,
            messages: [
              { role: "system", content: this.systemPrompt },
              { role: "user", content: buildPrompt(block) }
            ]
          }),
          signal: controller.signal
        });
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        throw new Error(`${this.options.providerName} tag request failed: ${response.status}`);
      }

      const payload = parsePayload((await response.json()) as ChatCompletionResponse);
      const tags = normalizeTags(payload, this.config.importantThreshold, this.allowedAiTags);
      if (tags.length > 0) return tags;

      this.reportFallback("empty_or_invalid_model_output", block.id);
      return this.fallback.tag(block);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.reportFallback(`request_or_parse_error:${message}`, block.id);
      return this.fallback.tag(block);
    }
  }

  private reportFallback(reason: string, blockId: string): void {
    this.config.onFallback?.({ reason, blockId });
  }
}

function buildPrompt(block: MemoryBlock): string {
  const events = block.rawEvents
    .slice(-8)
    .map((event) => `- [${event.role}] ${truncate(event.text, 220)}`)
    .join("\n");

  return [
    `block.id=${block.id}`,
    `retentionMode=${block.retentionMode}`,
    `conflict=${block.conflict}`,
    `summary=${truncate(block.summary, 600)}`,
    "recent_events:",
    events || "- (none)",
    "\nReturn JSON only."
  ].join("\n");
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

function parsePayload(data: ChatCompletionResponse): TaggerPayload {
  const content = data.choices?.[0]?.message?.content ?? "";
  const cleaned = stripCodeFences(content).trim();
  const jsonText = extractJsonObject(cleaned) ?? cleaned;
  try {
    return JSON.parse(jsonText) as TaggerPayload;
  } catch {
    return {};
  }
}

function stripCodeFences(content: string): string {
  return content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
}

function extractJsonObject(text: string): string | undefined {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < 0 || end <= start) return undefined;
  return text.slice(start, end + 1);
}

function normalizeTags(payload: TaggerPayload, threshold: number, allowedAiTags: string[]): BlockTag[] {
  const allowed = new Set(allowedAiTags);
  const output: string[] = [];

  for (const rawTag of payload.tags ?? []) {
    if (typeof rawTag !== "string") continue;
    const tag = rawTag.trim().toLowerCase();
    if (!tag || !allowed.has(tag) || output.includes(tag)) continue;
    output.push(tag);
  }

  if (typeof payload.importantScore === "number" && Number.isFinite(payload.importantScore)) {
    if (payload.importantScore >= threshold && allowed.has("important")) {
      return ["important"];
    }
  }

  return output;
}
