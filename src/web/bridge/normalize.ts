import type {
  NormalizedOpenAIChatRequest,
  OpenAIChatMessage,
  OpenAIChatMessagePart,
  OpenAIChatRequestBody,
  OpenClawSideBag
} from "./types.js";
import {
  firstDefinedRecord,
  firstDefinedString,
  normalizeSessionId,
  normalizeText,
  toNormalizedString
} from "./utils.js";

export function normalizeOpenAIChatRequest(body: OpenAIChatRequestBody): NormalizedOpenAIChatRequest {
  const sideBag = resolveOpenClawSideBag(body);
  const message = firstDefinedString([
    extractOpenAIRequestMessage(body.messages),
    extractOpenAIInputText(body.input),
    extractOpenAIRequestMessage(sideBag?.messages),
    extractOpenAIInputText(sideBag?.input),
    sideBag?.message,
    sideBag?.prompt,
    sideBag?.query,
    body.prompt,
    body.query
  ]);
  const sessionId = normalizeSessionId(
    firstDefinedString([
      body.sessionId,
      body.session_id,
      body.metadata?.sessionId,
      body.metadata?.session_id,
      sideBag?.sessionId,
      sideBag?.session_id,
      body.user
    ])
  );
  const requestId = firstDefinedString([
    body.requestId,
    body.request_id,
    body.metadata?.requestId,
    body.metadata?.request_id,
    sideBag?.requestId,
    sideBag?.request_id
  ]);
  return {
    message,
    stream: body.stream === true || sideBag?.stream === true,
    includeUsage:
      body.stream_options?.include_usage === true ||
      body.stream_options?.includeUsage === true ||
      sideBag?.include_usage === true ||
      sideBag?.includeUsage === true,
    sessionId,
    requestId,
    model: firstDefinedString([body.model, sideBag?.model])
  };
}

export function resolveOpenClawSideBag(body: OpenAIChatRequestBody): OpenClawSideBag | undefined {
  return firstDefinedRecord<OpenClawSideBag>([
    body.sidecar,
    body.sidebag,
    body.openclaw?.sidecar,
    body.openclaw?.sidebag,
    body.metadata?.sidecar,
    body.metadata?.sidebag,
    body.metadata?.openclaw?.sidecar,
    body.metadata?.openclaw?.sidebag
  ]);
}

function extractOpenAIRequestMessage(messages: OpenAIChatMessage[] | undefined): string | undefined {
  if (!Array.isArray(messages) || messages.length === 0) return undefined;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const entry = messages[index];
    if (entry?.role !== "user") continue;
    const content = extractOpenAIMessageText(entry.content);
    if (content) return content;
  }
  return undefined;
}

function extractOpenAIMessageText(content: OpenAIChatMessage["content"]): string | undefined {
  if (typeof content === "string") {
    return normalizeText(content);
  }
  if (!Array.isArray(content)) {
    return undefined;
  }

  const parts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const type = normalizeText(part.type);
    if (type && type !== "text" && type !== "input_text") continue;
    const text = normalizeText(part.text ?? part.content ?? part.value);
    if (text) parts.push(text);
  }
  const joined = parts.join("\n").trim();
  return joined.length > 0 ? joined : undefined;
}

function extractOpenAIInputText(input: unknown): string | undefined {
  if (typeof input === "string") {
    return normalizeText(input);
  }
  if (Array.isArray(input)) {
    const asMessages = input.filter(
      (entry): entry is OpenAIChatMessage =>
        Boolean(entry) &&
        typeof entry === "object" &&
        ("role" in entry || "content" in entry)
    );
    const messageText = extractOpenAIRequestMessage(asMessages);
    if (messageText) return messageText;

    const partText = extractOpenAIMessageText(input as OpenAIChatMessagePart[]);
    if (partText) return partText;

    const looseText = input
      .map((entry) => extractOpenAILooseText(entry))
      .filter((entry): entry is string => Boolean(entry))
      .join("\n")
      .trim();
    return looseText.length > 0 ? looseText : undefined;
  }
  if (!input || typeof input !== "object") {
    return undefined;
  }
  return extractOpenAILooseText(input);
}

function extractOpenAILooseText(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  return firstDefinedString([
    toNormalizedString(record.text),
    toNormalizedString(record.input_text),
    toNormalizedString(record.content),
    toNormalizedString(record.value),
    toNormalizedString(record.query),
    toNormalizedString(record.prompt)
  ]);
}
