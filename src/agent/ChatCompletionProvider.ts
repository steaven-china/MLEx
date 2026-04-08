import type { I18n } from "../i18n/index.js";
import type {
  ChatMessage,
  ILLMProvider,
  LlmGenerateOptions,
  LlmUsage,
  TokenCallback
} from "./LLMProvider.js";

export interface ChatCompletionProviderConfig {
  apiKey: string;
  baseUrl?: string;
  model: string;
}

export interface ChatCompletionProviderOptions {
  defaultBaseUrl: string;
  providerName: string;
  i18n?: I18n;
  emptyResponseMessage?: string;
  retryPrompt?: string;
  onTrace?: ChatCompletionTraceCallback;
  requestPath?: string;
  extraQueryParams?: Record<string, string | undefined>;
  extraHeaders?: Record<string, string | undefined>;
  includeModelInBody?: boolean;
}

export type ChatCompletionTraceCallback = (event: string, payload: unknown) => void;

interface ChatCompletionResponse {
  id?: string;
  model?: string;
  usage?: unknown;
  choices?: Array<{
    message?: ChatCompletionMessage;
    finish_reason?: string | null;
  }>;
}

interface ChatCompletionChunk {
  usage?: unknown;
  choices?: Array<{
    delta?: {
      content?: string;
      reasoning_content?: string;
    };
    finish_reason?: string | null;
  }>;
}

interface ChatCompletionMessage {
  reasoning_content?: string | null;
  content?:
    | string
    | Array<{
        type?: string;
        text?: string;
      }>
    | null;
}

export class ChatCompletionProvider implements ILLMProvider {
  private readonly baseUrl: string;
  private readonly emptyResponseMessage: string;
  private readonly retryPrompt: string;
  private readonly assistantReasoningByContent = new Map<string, string>();
  private lastUsage: LlmUsage | undefined;

  constructor(
    private readonly config: ChatCompletionProviderConfig,
    private readonly options: ChatCompletionProviderOptions
  ) {
    this.baseUrl = config.baseUrl ?? options.defaultBaseUrl;
    this.emptyResponseMessage =
      options.emptyResponseMessage ?? options.i18n?.t("chat.empty_response") ?? "Model returned no usable text.";
    this.retryPrompt =
      options.retryPrompt ??
      options.i18n?.t("chat.retry_prompt") ??
      "Please provide a non-empty plain text answer to my previous request.";
  }

  async generate(messages: ChatMessage[], options?: LlmGenerateOptions): Promise<string> {
    this.lastUsage = undefined;
    this.trace("request.start", {
      stream: false,
      messages
    });
    const response = await this.request(messages, false, options?.signal);
    this.trace("request.response", {
      stream: false,
      status: response.status
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`${this.options.providerName} request failed: ${response.status} ${text}`);
    }

    const data = (await response.json()) as ChatCompletionResponse;
    this.lastUsage = parseLlmUsage(data.usage);
    const message = data.choices?.[0]?.message;
    const content = extractMessageText(message);
    const reasoning = extractMessageReasoning(message);
    this.trace("response.parsed", {
      stream: false,
      id: data.id,
      model: data.model,
      finishReason: data.choices?.[0]?.finish_reason ?? null,
      usage: data.usage ?? null,
      content,
      reasoning
    });
    if (!content) {
      this.trace("response.empty_content", {
        stream: false,
        reasoning
      });
      const retried = await this.retryForNonEmptyText(messages, options?.signal);
      return retried ?? this.emptyResponseMessage;
    }
    this.rememberAssistantReasoning(content, reasoning);
    return content;
  }

  async generateStream(
    messages: ChatMessage[],
    onToken: TokenCallback,
    options?: LlmGenerateOptions
  ): Promise<string> {
    this.lastUsage = undefined;
    this.trace("request.start", {
      stream: true,
      messages
    });
    const response = await this.request(messages, true, options?.signal);
    this.trace("request.response", {
      stream: true,
      status: response.status
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`${this.options.providerName} stream request failed: ${response.status} ${text}`);
    }

    const body = response.body;
    if (!body) {
      throw new Error(`${this.options.providerName} stream response body is empty.`);
    }

    const reader = body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let fullText = "";
    let fullReasoning = "";
    let usage: LlmUsage | undefined;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const result = consumeBufferedEvents(buffer, fullText, fullReasoning, usage, onToken);
      if (result.done) {
        fullText = result.fullText;
        fullReasoning = result.fullReasoning;
        usage = result.usage;
        buffer = result.buffer;
        break;
      }
      buffer = result.buffer;
      fullText = result.fullText;
      fullReasoning = result.fullReasoning;
      usage = result.usage;
    }

    if (buffer.length > 0) {
      const result = consumeSingleEvent(buffer, fullText, fullReasoning, usage, onToken);
      fullText = result.fullText;
      fullReasoning = result.fullReasoning;
      usage = result.usage;
    }
    this.lastUsage = usage;

    this.trace("response.parsed", {
      stream: true,
      content: fullText,
      reasoning: fullReasoning,
      usage: usage ?? null
    });

    if (fullText.trim().length > 0) {
      this.rememberAssistantReasoning(fullText, fullReasoning);
      return fullText;
    }

    this.trace("response.empty_content", {
      stream: true,
      reasoning: fullReasoning
    });
    const retried = await this.retryForNonEmptyText(messages, options?.signal);
    if (retried) {
      onToken(retried);
      return retried;
    }

    return this.emptyResponseMessage;
  }

  getLastUsage(): LlmUsage | undefined {
    return this.lastUsage;
  }

  private request(messages: ChatMessage[], stream: boolean, signal?: AbortSignal): Promise<Response> {
    const apiMessages = messages.map((message) => this.toApiMessage(message));
    const requestPath = this.options.requestPath ?? "/chat/completions";
    const endpoint = new URL(requestPath, this.baseUrl.endsWith("/") ? this.baseUrl : `${this.baseUrl}/`);
    for (const [key, value] of Object.entries(this.options.extraQueryParams ?? {})) {
      if (value === undefined) continue;
      endpoint.searchParams.set(key, value);
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.config.apiKey}`
    };
    for (const [key, value] of Object.entries(this.options.extraHeaders ?? {})) {
      if (value === undefined) continue;
      headers[key] = value;
    }

    const body: Record<string, unknown> = {
      messages: apiMessages,
      stream
    };
    if (this.options.includeModelInBody !== false) {
      body.model = this.config.model;
    }

    return fetch(endpoint.toString(), {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal
    });
  }

  private async retryForNonEmptyText(
    messages: ChatMessage[],
    signal?: AbortSignal
  ): Promise<string | undefined> {
    const retryMessages: ChatMessage[] = [
      ...messages,
      {
        role: "user",
        content: this.retryPrompt
      }
    ];
    try {
      this.trace("retry.start", {
        stream: false,
        messages: retryMessages
      });
      const retryResponse = await this.request(retryMessages, false, signal);
      if (!retryResponse.ok) {
        this.trace("retry.response", {
          stream: false,
          status: retryResponse.status
        });
        return undefined;
      }
      const retryData = (await retryResponse.json()) as ChatCompletionResponse;
      this.lastUsage = parseLlmUsage(retryData.usage) ?? this.lastUsage;
      const retryMessage = retryData.choices?.[0]?.message;
      const text = extractMessageText(retryMessage);
      const reasoning = extractMessageReasoning(retryMessage);
      this.trace("retry.response", {
        stream: false,
        status: retryResponse.status,
        text,
        reasoning
      });
      this.rememberAssistantReasoning(text, reasoning);
      return text;
    } catch {
      this.trace("retry.error", {
        stream: false
      });
      return undefined;
    }
  }

  private trace(event: string, payload: unknown): void {
    this.options.onTrace?.(event, payload);
  }

  private rememberAssistantReasoning(
    content: string | undefined,
    reasoning: string | undefined
  ): void {
    if (!content || !reasoning) return;
    const contentKey = content.trim();
    const reasoningValue = reasoning.trim();
    if (!contentKey || !reasoningValue) return;

    this.assistantReasoningByContent.set(contentKey, reasoningValue);
    if (this.assistantReasoningByContent.size > MAX_REASONING_CACHE_SIZE) {
      const oldestKey = this.assistantReasoningByContent.keys().next().value;
      if (typeof oldestKey === "string") {
        this.assistantReasoningByContent.delete(oldestKey);
      }
    }
  }

  private toApiMessage(message: ChatMessage): Record<string, unknown> {
    const output: Record<string, unknown> = {
      role: message.role,
      content: message.content
    };
    if (message.role !== "assistant") {
      return output;
    }
    const reasoning = this.assistantReasoningByContent.get(message.content.trim());
    if (reasoning) {
      output.reasoning_content = reasoning;
    }
    return output;
  }
}

function consumeBufferedEvents(
  buffer: string,
  fullText: string,
  fullReasoning: string,
  usage: LlmUsage | undefined,
  onToken: TokenCallback
): { done: boolean; buffer: string; fullText: string; fullReasoning: string; usage: LlmUsage | undefined } {
  let workingBuffer = buffer;
  let outputText = fullText;
  let outputReasoning = fullReasoning;
  let outputUsage = usage;
  let boundary = workingBuffer.indexOf("\n\n");
  while (boundary !== -1) {
    const event = workingBuffer.slice(0, boundary);
    workingBuffer = workingBuffer.slice(boundary + 2);
    const eventResult = consumeSingleEvent(event, outputText, outputReasoning, outputUsage, onToken);
    outputText = eventResult.fullText;
    outputReasoning = eventResult.fullReasoning;
    outputUsage = eventResult.usage;
    if (eventResult.done) {
      return {
        done: true,
        buffer: "",
        fullText: outputText,
        fullReasoning: outputReasoning,
        usage: outputUsage
      };
    }
    boundary = workingBuffer.indexOf("\n\n");
  }

  return {
    done: false,
    buffer: workingBuffer,
    fullText: outputText,
    fullReasoning: outputReasoning,
    usage: outputUsage
  };
}

function consumeSingleEvent(
  event: string,
  fullText: string,
  fullReasoning: string,
  usage: LlmUsage | undefined,
  onToken: TokenCallback
): { done: boolean; fullText: string; fullReasoning: string; usage: LlmUsage | undefined } {
  let output = fullText;
  let reasoning = fullReasoning;
  let outputUsage = usage;
  for (const line of event.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload) continue;
    if (payload === "[DONE]") {
      return {
        done: true,
        fullText: output,
        fullReasoning: reasoning,
        usage: outputUsage
      };
    }

    const parsed = safeJsonParse<ChatCompletionChunk>(payload);
    const chunkUsage = parseLlmUsage(parsed?.usage);
    if (chunkUsage) {
      outputUsage = chunkUsage;
    }
    const token = parsed?.choices?.[0]?.delta?.content;
    const reasoningToken = parsed?.choices?.[0]?.delta?.reasoning_content;
    if (reasoningToken) {
      reasoning += reasoningToken;
    }
    if (!token) continue;
    output += token;
    onToken(token);
  }

  return {
    done: false,
    fullText: output,
    fullReasoning: reasoning,
    usage: outputUsage
  };
}

function safeJsonParse<T>(raw: string): T | undefined {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function extractMessageText(message: ChatCompletionMessage | undefined): string | undefined {
  if (!message) return undefined;

  if (typeof message.content === "string") {
    const trimmed = message.content.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (Array.isArray(message.content)) {
    const parts = message.content
      .map((item) => (typeof item?.text === "string" ? item.text.trim() : ""))
      .filter((item) => item.length > 0);
    if (parts.length === 0) return undefined;
    return parts.join("\n");
  }

  return undefined;
}

function extractMessageReasoning(message: ChatCompletionMessage | undefined): string | undefined {
  if (!message) return undefined;
  if (typeof message.reasoning_content !== "string") return undefined;
  const trimmed = message.reasoning_content.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseLlmUsage(input: unknown): LlmUsage | undefined {
  if (!input || typeof input !== "object") return undefined;
  const usage = input as Record<string, unknown>;
  const promptTokens = toFiniteInt(usage.prompt_tokens ?? usage.promptTokens);
  const completionTokens = toFiniteInt(usage.completion_tokens ?? usage.completionTokens);
  const totalTokens = toFiniteInt(usage.total_tokens ?? usage.totalTokens);
  if (promptTokens === undefined && completionTokens === undefined && totalTokens === undefined) {
    return undefined;
  }

  const resolvedPrompt = promptTokens ?? 0;
  const resolvedCompletion = completionTokens ?? 0;
  const resolvedTotal = totalTokens ?? resolvedPrompt + resolvedCompletion;
  return {
    promptTokens: resolvedPrompt,
    completionTokens: resolvedCompletion,
    totalTokens: resolvedTotal
  };
}

function toFiniteInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.floor(parsed));
    }
  }
  return undefined;
}

const MAX_REASONING_CACHE_SIZE = 500;
