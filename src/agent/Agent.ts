import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type { IMemoryManager } from "../memory/IMemoryManager.js";
import { createId } from "../utils/id.js";
import type { Context, MemoryEvent } from "../types.js";
import type { IDebugTraceRecorder } from "../debug/DebugTraceRecorder.js";
import {
  formatToolResult,
  parseToolCall,
  type IAgentToolExecutor
} from "./AgentToolExecutor.js";
import type { ChatMessage, ILLMProvider, TokenCallback } from "./LLMProvider.js";

export interface AgentResponse {
  text: string;
  context: Context;
}

export interface AgentOptions {
  systemPrompt?: string;
  includeAgentsMd?: boolean;
  agentsMdPath?: string;
  workspaceRoot?: string;
  includeIntroductionWhenNoMemory?: boolean;
  introductionPath?: string;
  toolExecutor?: IAgentToolExecutor;
  traceRecorder?: IDebugTraceRecorder;
}

export class Agent {
  private readonly systemPrompt: string;
  private readonly toolExecutor?: IAgentToolExecutor;
  private readonly introduction?: string;
  private readonly includeIntroductionWhenNoMemory: boolean;
  private readonly traceRecorder?: IDebugTraceRecorder;

  constructor(
    private readonly memoryManager: IMemoryManager,
    private readonly provider: ILLMProvider,
    options: AgentOptions = {}
  ) {
    const basePrompt =
      options.systemPrompt ??
      "You are a practical AI assistant. Use provided memory context as high-priority factual grounding.";
    const agentsGuidelines =
      options.includeAgentsMd === false
        ? undefined
        : loadAgentsGuidelines(options.agentsMdPath, options.workspaceRoot);
    this.introduction = loadIntroduction(options.introductionPath, options.workspaceRoot);
    this.includeIntroductionWhenNoMemory = options.includeIntroductionWhenNoMemory !== false;
    this.toolExecutor = options.toolExecutor;
    this.traceRecorder = options.traceRecorder;
    const toolGuidelines = this.toolExecutor?.instructions();

    const parts = [basePrompt];
    if (agentsGuidelines) {
      parts.push(`=== WORKSPACE AGENTS GUIDELINES ===\n${agentsGuidelines}`);
    }
    if (toolGuidelines) {
      parts.push(`=== TOOL USE PROTOCOL ===\n${toolGuidelines}`);
    }
    this.systemPrompt = parts.join("\n\n");
  }

  async respond(input: string): Promise<AgentResponse> {
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
    const baseMessages = this.composeMessages(input, context);
    const text = await this.generateWithTools(baseMessages);

    const assistantEvent = this.createEvent("assistant", text);
    await this.memoryManager.addEvent(assistantEvent);
    this.trace("respond.done", {
      stream: false,
      text
    });

    return { text, context };
  }

  async respondStream(input: string, onToken: TokenCallback): Promise<AgentResponse> {
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
    const baseMessages = this.composeMessages(input, context);
    const text = await this.generateWithTools(baseMessages, onToken);

    const assistantEvent = this.createEvent("assistant", text);
    await this.memoryManager.addEvent(assistantEvent);
    this.trace("respond.done", {
      stream: true,
      text
    });

    return { text, context };
  }

  async sealMemory(): Promise<void> {
    await this.memoryManager.sealCurrentBlock();
  }

  async getContext(query: string): Promise<Context> {
    return this.memoryManager.getContext(query);
  }

  private composeMessages(input: string, context: Context): ChatMessage[] {
    const systemParts = [this.systemPrompt];
    if (this.shouldInjectIntroduction(context)) {
      systemParts.push(
        `=== INTRODUCTION (NO MEMORY BLOCKS AVAILABLE) ===\n${this.introduction}`
      );
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
    onToken: TokenCallback
  ): Promise<string> {
    const text = await this.provider.generate(messages);
    onToken(text);
    return text;
  }

  private async generateWithTools(
    baseMessages: ChatMessage[],
    onToken?: TokenCallback
  ): Promise<string> {
    this.trace("model.round.start", {
      toolMode: Boolean(this.toolExecutor),
      stream: Boolean(onToken)
    });
    if (!this.toolExecutor) {
      if (onToken && this.provider.generateStream) {
        return this.provider.generateStream(baseMessages, onToken);
      }
      if (onToken) {
        return this.generateFallbackStream(baseMessages, onToken);
      }
      return this.provider.generate(baseMessages);
    }

    const messages: ChatMessage[] = [...baseMessages];
    const maxToolRounds = 4;
    for (let round = 0; round < maxToolRounds; round += 1) {
      const candidate = await this.provider.generate(messages);
      this.trace("model.round.candidate", {
        round,
        candidate
      });
      const call = parseToolCall(candidate);
      if (!call) {
        if (candidate.includes("<tool_call>")) {
          this.trace("tool.parse.invalid", {
            round,
            candidate
          });
          messages.push({ role: "assistant", content: candidate });
          messages.push({
            role: "user",
            content:
              'TOOL_RESULT {"tool":"tool_call.parser","ok":false,"content":"Invalid <tool_call> payload. Please return strict JSON with name and args."}'
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

    const fallback = "工具调用轮次已达上限，请缩小问题范围后重试。";
    if (onToken) onToken(fallback);
    return fallback;
  }

  private shouldInjectIntroduction(context: Context): boolean {
    if (!this.includeIntroductionWhenNoMemory) return false;
    if (!this.introduction) return false;
    return context.blocks.length === 0;
  }

  private trace(event: string, payload: unknown): void {
    this.traceRecorder?.record("agent", event, payload);
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

function readFirstNonEmpty(paths: Iterable<string>, maxLength: number): string | undefined {
  for (const path of paths) {
    if (!existsSync(path)) continue;
    const content = readFileSync(path, "utf8").trim();
    if (!content) continue;
    return content.length <= maxLength ? content : `${content.slice(0, maxLength)}\n...[truncated]`;
  }

  return undefined;
}
