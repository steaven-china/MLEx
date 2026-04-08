import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { loadUserTagsToml } from "../config/tagsToml.js";
import { renderTagTemplate } from "./TagTemplateRenderer.js";

import type { Context, ConversationStats, MemoryEvent, ProactivePlan } from "../types.js";
import type { I18n } from "../i18n/index.js";
import { createId } from "../utils/id.js";
import type { IMemoryManager } from "../memory/IMemoryManager.js";
import { ProactiveDialoguePlanner } from "../proactive/ProactiveDialoguePlanner.js";
import { ProactiveActuator } from "../proactive/ProactiveActuator.js";
import type { IDebugTraceRecorder } from "../debug/DebugTraceRecorder.js";
import {
  formatToolResult,
  parseToolCall,
  type IAgentToolExecutor
} from "./AgentToolExecutor.js";
import type {
  ChatMessage,
  ILLMProvider,
  LlmGenerateOptions,
  LlmUsage,
  TokenCallback
} from "./LLMProvider.js";

export interface AgentResponse {
  text: string;
  context: Context;
  proactiveText?: string;
  llmUsage?: LlmUsage;
}

export interface AgentOptions {
  systemPrompt?: string;
  includeAgentsMd?: boolean;
  agentsMdPath?: string;
  workspaceRoot?: string;
  includeIntroductionWhenNoMemory?: boolean;
  introductionPath?: string;
  includeTagsIntro?: boolean;
  tagsIntroPath?: string;
  tagsTomlPath?: string;
  tagsTemplateVars?: Record<string, string>;
  toolExecutor?: IAgentToolExecutor;
  traceRecorder?: IDebugTraceRecorder;
  proactivePlanner?: ProactiveDialoguePlanner;
  proactiveActuator?: ProactiveActuator;
  i18n?: I18n;
  maxToolRounds?: number;
}

export interface AgentGenerateOptions {
  signal?: AbortSignal;
  externalSystemContext?: string;
}

export class Agent {
  private static readonly DEFAULT_MAX_TOOL_ROUNDS = 12;
  private readonly systemPrompt: string;
  private readonly toolExecutor?: IAgentToolExecutor;
  private readonly introduction?: string;
  private readonly includeIntroductionWhenNoMemory: boolean;
  private readonly tagsIntroduction?: string;
  private readonly traceRecorder?: IDebugTraceRecorder;
  private readonly proactivePlanner?: ProactiveDialoguePlanner;
  private readonly proactiveActuator?: ProactiveActuator;
  private readonly i18n?: I18n;
  private readonly maxToolRounds: number;
  private proactiveTickRunning = false;
  private hasInjectedIntroduction = false;

  constructor(
    private readonly memoryManager: IMemoryManager,
    private readonly provider: ILLMProvider,
    options: AgentOptions = {}
  ) {
    const basePrompt =
      options.systemPrompt ??
      options.i18n?.t("agent.system.default") ??
      "You are a practical AI assistant. Use provided memory context as high-priority factual grounding.";
    const agentsGuidelines =
      options.includeAgentsMd === false
        ? undefined
        : loadAgentsGuidelines(options.agentsMdPath, options.workspaceRoot);
    this.introduction = loadIntroduction(options.introductionPath, options.workspaceRoot);
    this.includeIntroductionWhenNoMemory = options.includeIntroductionWhenNoMemory !== false;
    this.tagsIntroduction = loadTagsIntroduction({
      includeTagsIntro: options.includeTagsIntro,
      tagsIntroPath: options.tagsIntroPath,
      tagsTomlPath: options.tagsTomlPath,
      tagsTemplateVars: options.tagsTemplateVars,
      workspaceRoot: options.workspaceRoot
    });
    this.toolExecutor = options.toolExecutor;
    this.traceRecorder = options.traceRecorder;
    this.proactivePlanner = options.proactivePlanner;
    this.proactiveActuator = options.proactiveActuator;
    this.i18n = options.i18n;
    this.maxToolRounds = normalizePositiveInt(options.maxToolRounds, Agent.DEFAULT_MAX_TOOL_ROUNDS);
    const toolGuidelines = this.toolExecutor?.instructions();

    const parts = [basePrompt];
    if (agentsGuidelines) {
      parts.push(`${this.i18n?.t("agent.section.guidelines") ?? "=== WORKSPACE AGENTS GUIDELINES ==="}\n${agentsGuidelines}`);
    }
    if (toolGuidelines) {
      parts.push(`${this.i18n?.t("agent.section.tool_protocol") ?? "=== TOOL USE PROTOCOL ==="}\n${toolGuidelines}`);
    }
    this.systemPrompt = parts.join("\n\n");
  }

  async respond(input: string, options: AgentGenerateOptions = {}): Promise<AgentResponse> {
    this.trace("respond.start", { stream: false, input });
    const userEvent = this.createEvent("user", input);
    await this.memoryManager.addEvent(userEvent);

    const context = await this.memoryManager.getContext(input);
    this.trace("context.ready", {
      stream: false,
      blockCount: context.blocks.length,
      recentEventCount: context.recentEvents.length,
      formattedLength: context.formatted.length
    });
    const baseMessages = this.composeMessages(input, context, options.externalSystemContext);
    const text = await this.generateWithTools(baseMessages, undefined, options);
    const llmUsage = this.readProviderUsage();

    const assistantEvent = this.createEvent("assistant", text);
    await this.memoryManager.addEvent(assistantEvent);
    const proactiveText = await this.maybeProactiveWakeup(input, context, options);
    this.trace("respond.done", {
      stream: false,
      text,
      proactiveText,
      llmUsage: llmUsage ?? null
    });

    return { text, context, proactiveText, llmUsage };
  }

  async respondStream(
    input: string,
    onToken: TokenCallback,
    options: AgentGenerateOptions = {}
  ): Promise<AgentResponse> {
    this.trace("respond.start", { stream: true, input });
    const userEvent = this.createEvent("user", input);
    await this.memoryManager.addEvent(userEvent);

    const context = await this.memoryManager.getContext(input);
    this.trace("context.ready", {
      stream: true,
      blockCount: context.blocks.length,
      recentEventCount: context.recentEvents.length,
      formattedLength: context.formatted.length
    });
    const baseMessages = this.composeMessages(input, context, options.externalSystemContext);
    const text = await this.generateWithTools(baseMessages, onToken, options);
    const llmUsage = this.readProviderUsage();

    const assistantEvent = this.createEvent("assistant", text);
    await this.memoryManager.addEvent(assistantEvent);
    const proactiveText = await this.maybeProactiveWakeup(input, context, options);
    this.trace("respond.done", {
      stream: true,
      text,
      proactiveText,
      llmUsage: llmUsage ?? null
    });

    return { text, context, proactiveText, llmUsage };
  }

  async sealMemory(): Promise<void> {
    await this.memoryManager.sealCurrentBlock();
  }

  async getContext(query: string, triggerSource: "user" | "timer" = "user"): Promise<Context> {
    return this.memoryManager.getContext(query, triggerSource);
  }

  async tickProactiveWakeup(): Promise<string | undefined> {
    if (!this.proactivePlanner || !this.proactiveActuator) return undefined;
    if (this.proactiveTickRunning) return undefined;
    this.proactiveTickRunning = true;
    try {
      await this.memoryManager.tickProactiveWakeup();
      const context = await this.memoryManager.getContext(
        this.i18n?.t("agent.timer.wakeup_query") ?? "continue current task",
        "timer"
      );
      const proactiveText = await this.maybeProactiveWakeup(
        this.i18n?.t("agent.timer.wakeup_query") ?? "continue current task",
        context
      );
      this.trace("proactive.timer.tick", {
        proactiveText
      });
      return proactiveText;
    } finally {
      this.proactiveTickRunning = false;
    }
  }

  private composeMessages(
    input: string,
    context: Context,
    externalSystemContext?: string
  ): ChatMessage[] {
    const systemParts = [this.systemPrompt];
    systemParts.push(this.buildRuntimeContextSection(context));
    if (this.shouldInjectIntroduction(context)) {
      const introductionTitle =
        context.blocks.length === 0
          ? this.i18n?.t("agent.introduction.title") ??
            "=== INTRODUCTION (NO MEMORY BLOCKS AVAILABLE) ==="
          : this.i18n?.t("agent.introduction.title_with_memory") ?? "=== INTRODUCTION ===";
      systemParts.push(
        `${introductionTitle}\n${this.introduction}`
      );
      this.hasInjectedIntroduction = true;
    }
    if (this.tagsIntroduction) {
      systemParts.push(
        `${this.i18n?.t("agent.tags_intro.title") ?? "=== TAGS INTRODUCTION ==="}\n${this.tagsIntroduction}`
      );
    }
    const externalContext = normalizeOptionalText(externalSystemContext);
    if (externalContext) {
      systemParts.push(externalContext);
    }
    systemParts.push(context.formatted);

    return [
      {
        role: "system",
        content: systemParts.join("\n\n")
      },
      {
        role: "user",
        content: input
      }
    ];
  }

  private buildRuntimeContextSection(context: Context): string {
    const stats = this.memoryManager.getConversationStats?.();
    const nowIso = new Date().toISOString();
    const lines = [
      this.i18n?.t("agent.runtime_context.title") ?? "=== RUNTIME CONTEXT ===",
      `current_time_iso: ${nowIso}`
    ];
    if (stats) {
      lines.push(`dialogue_turns: ${stats.dialogueTurns}`);
      lines.push(`events_total: ${stats.totalEvents}`);
      lines.push(`events_user: ${stats.userEvents}`);
      lines.push(`events_assistant: ${stats.assistantEvents}`);
      lines.push(`events_tool: ${stats.toolEvents}`);
      lines.push(`events_system: ${stats.systemEvents}`);
      return lines.join("\n");
    }

    const estimated = estimateConversationStatsFromRecentEvents(context.recentEvents);
    lines.push(`dialogue_turns_recent_window: ${estimated.dialogueTurns}`);
    lines.push(`recent_events_count: ${estimated.totalEvents}`);
    lines.push(`recent_user_events: ${estimated.userEvents}`);
    lines.push(`recent_assistant_events: ${estimated.assistantEvents}`);
    return lines.join("\n");
  }

  private createEvent(role: MemoryEvent["role"], text: string): MemoryEvent {
    return {
      id: createId("event"),
      role,
      text,
      timestamp: Date.now()
    };
  }

  private async generateFallbackStream(
    messages: ChatMessage[],
    onToken: TokenCallback,
    options: LlmGenerateOptions
  ): Promise<string> {
    const text = await this.provider.generate(messages, options);
    onToken(text);
    return text;
  }

  private async generateWithTools(
    baseMessages: ChatMessage[],
    onToken?: TokenCallback,
    options: LlmGenerateOptions = {}
  ): Promise<string> {
    this.trace("model.round.start", {
      toolMode: Boolean(this.toolExecutor),
      stream: Boolean(onToken)
    });
    if (!this.toolExecutor) {
      if (onToken && this.provider.generateStream) {
        return this.provider.generateStream(baseMessages, onToken, options);
      }
      if (onToken) {
        return this.generateFallbackStream(baseMessages, onToken, options);
      }
      return this.provider.generate(baseMessages, options);
    }

    const messages: ChatMessage[] = [...baseMessages];
    for (let round = 0; round < this.maxToolRounds; round += 1) {
      const candidate = await this.provider.generate(messages, options);
      this.trace("model.round.candidate", {
        round,
        candidate
      });
      const call = parseToolCall(candidate);
      if (!call) {
        const trimmedCandidate = candidate.trim();
        const looksLikeJsonToolPayload =
          trimmedCandidate.startsWith("{") ||
          trimmedCandidate.startsWith("```") ||
          trimmedCandidate.startsWith("```json");
        const looksLikeToolPayload =
          candidate.includes("<tool_call>") ||
          (looksLikeJsonToolPayload &&
            (candidate.includes('"tool":') ||
              candidate.includes('"name":') ||
              candidate.includes('"function":')));
        if (looksLikeToolPayload) {
          this.trace("tool.parse.invalid", {
            round,
            candidate
          });
          messages.push({ role: "assistant", content: candidate });
          messages.push({
            role: "user",
            content:
              this.i18n?.t("agent.tool.parse.invalid") ??
              'TOOL_RESULT {"tool":"tool_call.parser","ok":false,"content":"Invalid tool-call payload. Please return strict JSON with name and args (or tool/arguments)."}'
          });
          continue;
        }
        this.trace("model.round.final", {
          round,
          candidate
        });
        if (onToken) onToken(candidate);
        return candidate;
      }

      this.trace("tool.parse.ok", {
        round,
        call
      });
      const result = await this.toolExecutor.execute(call);
      this.trace("tool.execute.done", {
        round,
        call,
        result
      });
      messages.push({ role: "assistant", content: candidate });
      messages.push({ role: "user", content: formatToolResult(call, result) });
    }

    const fallback =
      this.i18n?.t("agent.tool.round.limit", { limit: this.maxToolRounds }) ??
      `Tool call rounds exceeded limit (${this.maxToolRounds}). Please provide a concise best-effort answer with available information.`;
    this.trace("tool.round.limit", {
      maxToolRounds: this.maxToolRounds,
      fallback
    });
    if (onToken) onToken(fallback);
    return fallback;
  }

  private async maybeProactiveWakeup(
    input: string,
    context: Context,
    options: AgentGenerateOptions = {}
  ): Promise<string | undefined> {
    if (!this.proactivePlanner || !this.proactiveActuator) return undefined;
    let effectiveContext = context;
    let plan = this.proactivePlanner.buildPlan({ userInput: input, context: effectiveContext });

    if (plan.action === "ask_followup") {
      const refreshedContext = await this.refreshProactiveContext(input, context);
      if (refreshedContext) {
        effectiveContext = refreshedContext;
        plan = this.proactivePlanner.buildPlan({ userInput: input, context: effectiveContext });
      }

      const questioningControl = resolveProactiveQuestioningControl(effectiveContext.recentEvents);
      if (questioningControl && !questioningControl.enabled) {
        this.trace("proactive.questioning_disabled", {
          planReason: plan.reason,
          controlReason: questioningControl.reason ?? null,
          updatedAt: questioningControl.updatedAt ?? null
        });
        return undefined;
      }
    }

    if (plan.action === "noop") return undefined;
    const planned = await this.enhanceProactivePlan(plan, input, effectiveContext, options);
    const proactiveText = await this.proactiveActuator.execute(planned);
    if (!proactiveText) return undefined;
    this.trace("proactive.wakeup", {
      action: planned.action,
      reason: planned.reason,
      proactiveText
    });
    return proactiveText;
  }

  private async refreshProactiveContext(input: string, context: Context): Promise<Context | undefined> {
    const triggerSource = context.proactiveSignal?.triggerSource ?? "user";
    try {
      return await this.memoryManager.getContext(input, triggerSource);
    } catch (error) {
      this.trace("proactive.context_refresh_error", {
        triggerSource,
        error: error instanceof Error ? error.message : String(error)
      });
      return undefined;
    }
  }

  private async enhanceProactivePlan(
    plan: ProactivePlan,
    userInput: string,
    context: Context,
    options: AgentGenerateOptions
  ): Promise<ProactivePlan> {
    if (plan.action !== "ask_followup") return plan;
    if (!shouldModelDraftProactiveFollowup(plan.reason)) return plan;

    const drafted = await this.generateProactiveFollowupMessage(plan, userInput, context, options);
    if (!drafted) return plan;
    return {
      ...plan,
      messageSeed: drafted
    };
  }

  private async generateProactiveFollowupMessage(
    plan: ProactivePlan,
    userInput: string,
    context: Context,
    options: AgentGenerateOptions
  ): Promise<string | undefined> {
    const fullContextPayload = JSON.stringify(
      {
        reason: plan.reason,
        userInput,
        proactiveSignal: context.proactiveSignal ?? null,
        blocks: context.blocks.map((block) => ({
          id: block.id,
          score: block.score,
          source: block.source,
          summary: block.summary,
          startTime: block.startTime,
          endTime: block.endTime,
          keywords: block.keywords,
          tags: block.tags,
          retentionMode: block.retentionMode,
          conflict: block.conflict,
          matchScore: block.matchScore,
          rawEvents: block.rawEvents
        })),
        recentEvents: context.recentEvents
      },
      null,
      2
    );

    const systemPrompt =
      this.i18n?.t("agent.proactive_followup.system") ??
      "You are a retrieval-diagnosis assistant. Generate a comprehensive clarification questionnaire to close entity/relation/causal/process-chain gaps.";
    const userPrompt = [
      `reason: ${plan.reason}`,
      `user_input: ${userInput}`,
      `current_seed: ${plan.messageSeed}`,
      "Return in the same language as user_input.",
      "Draft 4-8 forward-looking follow-up questions that cover missing entities, dependencies, causality, timeline, constraints, owners, and verification evidence.",
      "Tone must be colloquial, polite, and non-judgmental. Avoid blame, accusations, and offensive wording.",
      "Output plain text only, one line per question. This draft will be reviewed by the agent before user delivery.",
      `full_context_json:\n${fullContextPayload}`,
      `formatted_context:\n${context.formatted}`
    ].join("\n\n");

    try {
      const candidate = await this.provider.generate(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        { signal: options.signal }
      );
      const reviewed = reviewProactiveFollowupDraft(candidate, userInput);
      this.trace("proactive.model_followup", {
        reason: plan.reason,
        draft: candidate,
        reviewed
      });
      return reviewed || undefined;
    } catch (error) {
      this.trace("proactive.model_followup_error", {
        reason: plan.reason,
        error: error instanceof Error ? error.message : String(error)
      });
      return undefined;
    }
  }

  private shouldInjectIntroduction(context: Context): boolean {
    if (!this.includeIntroductionWhenNoMemory) return false;
    if (!this.introduction) return false;
    if (!this.hasInjectedIntroduction) return true;
    return context.blocks.length === 0;
  }

  private trace(event: string, payload: unknown): void {
    this.traceRecorder?.record("agent", event, payload);
  }

  private readProviderUsage(): LlmUsage | undefined {
    if (!this.provider.getLastUsage) return undefined;
    const usage = this.provider.getLastUsage();
    if (!usage) return undefined;
    const promptTokens = normalizeNonNegativeInt(usage.promptTokens);
    const completionTokens = normalizeNonNegativeInt(usage.completionTokens);
    const totalTokens = normalizeNonNegativeInt(usage.totalTokens);
    return {
      promptTokens,
      completionTokens,
      totalTokens: totalTokens === 0 ? promptTokens + completionTokens : totalTokens
    };
  }
}

function loadAgentsGuidelines(customPath?: string, workspaceRoot?: string): string | undefined {
  const root = resolve(workspaceRoot ?? process.cwd());
  const candidates = new Set<string>();
  if (customPath) {
    candidates.add(resolve(customPath));
  }
  candidates.add(resolve(root, "AgentDocs", "AGENT.md"));
  candidates.add(resolve(root, "AgentDocs", "AGENTS.md"));

  let current = root;
  while (true) {
    candidates.add(resolve(current, "AGENTS.md"));
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return readFirstNonEmpty(candidates, 4000);
}

function loadIntroduction(customPath?: string, workspaceRoot?: string): string | undefined {
  const root = resolve(workspaceRoot ?? process.cwd());
  const candidates = new Set<string>();
  if (customPath) {
    candidates.add(resolve(customPath));
  }
  candidates.add(resolve(root, "AgentDocs", "Introduction.md"));
  candidates.add(resolve(root, "Introduction.md"));

  return readFirstNonEmpty(candidates, 6000);
}

function loadTagsIntroduction(options: {
  includeTagsIntro?: boolean;
  tagsIntroPath?: string;
  tagsTomlPath?: string;
  tagsTemplateVars?: Record<string, string>;
  workspaceRoot?: string;
}): string | undefined {
  if (options.includeTagsIntro === false) return undefined;

  const root = resolve(options.workspaceRoot ?? process.cwd());
  const tagsToml = loadUserTagsToml({ filePath: options.tagsTomlPath });
  const tagsTomlDoc = buildTagsTomlDoc(tagsToml);

  const candidates = new Set<string>();
  if (options.tagsIntroPath) {
    candidates.add(resolve(options.tagsIntroPath));
  }
  candidates.add(resolve(root, "AgentDocs", "TagsIntro.md"));
  candidates.add(resolve(root, "TagsIntro.md"));

  const fileDoc = readFirstNonEmpty(candidates, 6000);
  const mergedDoc = [tagsTomlDoc, fileDoc].filter((part): part is string => Boolean(part)).join("\n\n");
  if (!mergedDoc) return undefined;

  const vars = {
    ...(tagsToml.vars ?? {}),
    ...(options.tagsTemplateVars ?? {})
  };
  return renderTagTemplate(mergedDoc, vars);
}

function buildTagsTomlDoc(config: ReturnType<typeof loadUserTagsToml>): string | undefined {
  const parts: string[] = [];
  const intro = config.docs?.intro?.trim();
  if (intro) {
    parts.push(intro);
  }
  const items = config.docs?.item ?? [];
  if (items.length > 0) {
    parts.push(items.map((item) => `- ${item}`).join("\n"));
  }
  if (parts.length === 0) return undefined;
  return parts.join("\n\n");
}

function readFirstNonEmpty(paths: Iterable<string>, maxLength: number): string | undefined {
  for (const path of paths) {
    if (!existsSync(path)) continue;
    const content = readFileSync(path, "utf8").trim();
    if (!content) continue;
    return content.length <= maxLength ? content : `${content.slice(0, maxLength)}\n...[truncated]`;
  }

  return undefined;
}

function normalizePositiveInt(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : fallback;
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeNonNegativeInt(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function estimateConversationStatsFromRecentEvents(events: MemoryEvent[]): ConversationStats {
  const stats: ConversationStats = {
    totalEvents: 0,
    userEvents: 0,
    assistantEvents: 0,
    toolEvents: 0,
    systemEvents: 0,
    dialogueTurns: 0
  };
  for (const event of events) {
    stats.totalEvents += 1;
    if (event.role === "user") {
      stats.userEvents += 1;
      continue;
    }
    if (event.role === "assistant") {
      stats.assistantEvents += 1;
      continue;
    }
    if (event.role === "tool") {
      stats.toolEvents += 1;
      continue;
    }
    stats.systemEvents += 1;
  }
  stats.dialogueTurns = stats.userEvents;
  return stats;
}

function shouldModelDraftProactiveFollowup(reason: string): boolean {
  return reason.startsWith("low_entropy_") || reason.startsWith("relation_");
}

function reviewProactiveFollowupDraft(input: string, userInput: string): string {
  const preferChinese = hasCjk(userInput);
  const draftItems = extractProactiveDraftItems(input);
  const reviewedItems: string[] = [];
  const seen = new Set<string>();

  for (const item of draftItems) {
    const reviewed = reviewSingleProactiveItem(item, preferChinese);
    if (!reviewed) continue;
    const fingerprint = reviewed.toLowerCase();
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    reviewedItems.push(`- ${reviewed}`);
    if (reviewedItems.length >= PROACTIVE_FOLLOWUP_MAX_ITEMS) break;
  }

  if (reviewedItems.length < PROACTIVE_FOLLOWUP_MIN_ITEMS) {
    const fallbacks = defaultProactiveFallbackItems(preferChinese);
    for (const fallback of fallbacks) {
      const fingerprint = fallback.toLowerCase();
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      reviewedItems.push(`- ${fallback}`);
      if (reviewedItems.length >= PROACTIVE_FOLLOWUP_MIN_ITEMS) break;
    }
  }

  if (reviewedItems.length === 0) return "";
  const joined = reviewedItems.join("\n");
  return joined.length <= PROACTIVE_FOLLOWUP_MAX_CHARS
    ? joined
    : `${joined.slice(0, PROACTIVE_FOLLOWUP_MAX_CHARS).trim()}\n...`;
}

function extractProactiveDraftItems(input: string): string[] {
  const normalized = input.replace(/\r/g, "\n");
  const lineItems = normalized
    .split("\n")
    .map((line) => cleanProactiveDraftFragment(line))
    .filter((line): line is string => Boolean(line));
  if (lineItems.length >= 2) return lineItems;

  const sentenceItems = normalized
    .split(/[?？\n]/)
    .map((line) => cleanProactiveDraftFragment(line))
    .filter((line): line is string => Boolean(line));
  return sentenceItems.length > lineItems.length ? sentenceItems : lineItems;
}

function cleanProactiveDraftFragment(input: string): string | undefined {
  const cleaned = input
    .replace(/^\s*[-*+]\s*/, "")
    .replace(/^\s*[0-9]+[.)、:：-]?\s*/, "")
    .replace(/^\s*Q[0-9]+[.)、:：-]?\s*/i, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

function reviewSingleProactiveItem(item: string, preferChinese: boolean): string | undefined {
  const cleaned = cleanProactiveDraftFragment(item);
  if (!cleaned) return undefined;
  if (OFFENSIVE_PROACTIVE_PATTERN.test(cleaned)) return undefined;

  const base = cleaned.replace(/[。.!?？]+$/g, "").trim();
  if (!base) return undefined;

  if (preferChinese) {
    const normalized = base.replace(/^(请|麻烦|你能|你可以|是否|能否)\s*/u, "").trim();
    const stem = normalized.length > 0 ? normalized : base;
    const sentence = `为了下一步推进，你方便补充一下${stem}吗？`;
    return sentence.length <= 120 ? sentence : `${sentence.slice(0, 118)}...`;
  }

  const normalized = base.replace(/^(please\s+|can you\s+|could you\s+|would you\s+)/i, "").trim();
  const stem = lowerFirst(normalized.length > 0 ? normalized : base);
  const sentence = `To move forward, could you share ${stem}?`;
  return sentence.length <= 180 ? sentence : `${sentence.slice(0, 178)}...`;
}

function defaultProactiveFallbackItems(preferChinese: boolean): string[] {
  if (preferChinese) {
    return [
      "为了下一步推进，你方便说一下这次最优先的目标是什么吗？",
      "为了下一步推进，你方便补充一下必须满足的约束或截止时间吗？",
      "为了下一步推进，你方便说明一下谁来负责关键决策和验收吗？",
      "为了下一步推进，你方便告诉我最需要先补的证据或数据是什么吗？"
    ];
  }
  return [
    "To move forward, could you share the top outcome you want first?",
    "To move forward, could you share any hard constraints or deadlines?",
    "To move forward, could you share who owns key decisions and acceptance?",
    "To move forward, could you share which evidence or data we should fill first?"
  ];
}

function hasCjk(input: string): boolean {
  return /[\u3400-\u9fff]/.test(input);
}

function lowerFirst(input: string): string {
  if (input.length === 0) return input;
  return `${input[0]!.toLowerCase()}${input.slice(1)}`;
}

function resolveProactiveQuestioningControl(
  events: MemoryEvent[]
): { enabled: boolean; reason?: string; updatedAt?: number } | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!event?.metadata) continue;
    if (event.metadata.tool !== PROACTIVE_QUESTIONING_TOOL_NAME) continue;
    const enabled = parseOptionalBoolean(event.metadata.questioningEnabled ?? event.metadata.enabled);
    if (enabled === undefined) continue;
    const reason =
      typeof event.metadata.reason === "string" && event.metadata.reason.trim().length > 0
        ? event.metadata.reason.trim()
        : undefined;
    const updatedAt =
      typeof event.metadata.updatedAt === "number" && Number.isFinite(event.metadata.updatedAt)
        ? event.metadata.updatedAt
        : event.timestamp;
    return { enabled, reason, updatedAt };
  }
  return undefined;
}

function parseOptionalBoolean(input: unknown): boolean | undefined {
  if (typeof input === "boolean") return input;
  if (typeof input === "string") {
    const normalized = input.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
    if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  }
  return undefined;
}

const PROACTIVE_FOLLOWUP_MAX_ITEMS = 8;
const PROACTIVE_FOLLOWUP_MIN_ITEMS = 4;
const PROACTIVE_FOLLOWUP_MAX_CHARS = 1600;
const PROACTIVE_QUESTIONING_TOOL_NAME = "agent.proactive.questioning";
const OFFENSIVE_PROACTIVE_PATTERN =
  /(stupid|idiot|shut up|what'?s wrong with you|你怎么还|你怎么就|蠢|笨|废物|闭嘴)/i;
