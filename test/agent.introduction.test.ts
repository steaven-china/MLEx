import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { Agent } from "../src/agent/Agent.js";
import type { ChatMessage, ILLMProvider } from "../src/agent/LLMProvider.js";
import type { IMemoryManager } from "../src/memory/IMemoryManager.js";
import type { BlockRef, Context, ConversationStats, MemoryEvent } from "../src/types.js";

class CaptureProvider implements ILLMProvider {
  public lastMessages: ChatMessage[] = [];

  async generate(messages: ChatMessage[]): Promise<string> {
    this.lastMessages = messages;
    return "ok";
  }
}

class MemoryManagerStub implements IMemoryManager {
  constructor(
    private readonly context: Context,
    private readonly stats?: ConversationStats
  ) {}

  async addEvent(_event: MemoryEvent): Promise<void> {}
  async sealCurrentBlock(): Promise<void> {}
  createNewBlock(): void {}
  async retrieveBlocks(_query: string): Promise<BlockRef[]> {
    return this.context.blocks;
  }
  async getContext(_query: string): Promise<Context> {
    return this.context;
  }

  async tickProactiveWakeup(): Promise<void> {}

  getConversationStats(): ConversationStats | undefined {
    return this.stats;
  }
}

describe("Agent introduction injection", () => {
  test("injects Introduction when no memory blocks are available", async () => {
    const folder = await fs.mkdtemp(join(tmpdir(), "mlex-intro-on-"));
    const docsDir = join(folder, "AgentDocs");
    await fs.mkdir(docsDir, { recursive: true });
    await fs.writeFile(join(docsDir, "Introduction.md"), "INTRO_MARKER_TEXT", "utf8");

    const provider = new CaptureProvider();
    const memory = new MemoryManagerStub({
      blocks: [],
      recentEvents: [],
      formatted: "CTX_EMPTY"
    });
    const agent = new Agent(memory, provider, {
      workspaceRoot: folder,
      includeAgentsMd: false
    });

    await agent.respond("hello");
    const systemMessage = provider.lastMessages.find((message) => message.role === "system");
    expect(systemMessage?.content).toContain("INTRODUCTION (NO MEMORY BLOCKS AVAILABLE)");
    expect(systemMessage?.content).toContain("INTRO_MARKER_TEXT");
  });

  test("injects Introduction on first turn even when memory blocks exist", async () => {
    const folder = await fs.mkdtemp(join(tmpdir(), "mlex-intro-off-"));
    const docsDir = join(folder, "AgentDocs");
    await fs.mkdir(docsDir, { recursive: true });
    await fs.writeFile(join(docsDir, "Introduction.md"), "INTRO_FIRST_TURN", "utf8");

    const provider = new CaptureProvider();
    const memory = new MemoryManagerStub({
      blocks: [
        {
          id: "b1",
          score: 0.9,
          source: "fusion",
          summary: "summary",
          startTime: 1,
          endTime: 2,
          keywords: ["k1"]
        }
      ],
      recentEvents: [],
      formatted: "CTX_HAS_BLOCKS"
    });
    const agent = new Agent(memory, provider, {
      workspaceRoot: folder,
      includeAgentsMd: false
    });

    await agent.respond("hello");
    const systemMessage = provider.lastMessages.find((message) => message.role === "system");
    expect(systemMessage?.content).toContain("=== INTRODUCTION ===");
    expect(systemMessage?.content).toContain("INTRO_FIRST_TURN");

    await agent.respond("hello again");
    const nextSystemMessage = provider.lastMessages.find((message) => message.role === "system");
    expect(nextSystemMessage?.content).not.toContain("INTRO_FIRST_TURN");
  });

  test("injects runtime time and dialogue counters", async () => {
    const provider = new CaptureProvider();
    const memory = new MemoryManagerStub(
      {
        blocks: [],
        recentEvents: [],
        formatted: "CTX_COUNTERS"
      },
      {
        totalEvents: 42,
        userEvents: 18,
        assistantEvents: 16,
        toolEvents: 8,
        systemEvents: 0,
        dialogueTurns: 18
      }
    );
    const agent = new Agent(memory, provider, {
      includeAgentsMd: false
    });

    await agent.respond("hello");
    const systemMessage = provider.lastMessages.find((message) => message.role === "system");
    expect(systemMessage?.content).toContain("=== RUNTIME CONTEXT ===");
    expect(systemMessage?.content).toContain("current_time_iso:");
    expect(systemMessage?.content).toContain("dialogue_turns: 18");
    expect(systemMessage?.content).toContain("events_total: 42");
  });
});
