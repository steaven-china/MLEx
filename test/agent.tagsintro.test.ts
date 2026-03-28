import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { Agent } from "../src/agent/Agent.js";
import type { ChatMessage, ILLMProvider } from "../src/agent/LLMProvider.js";
import { createRuntime } from "../src/container.js";
import type { IMemoryManager } from "../src/memory/IMemoryManager.js";
import type { BlockRef, Context, MemoryEvent } from "../src/types.js";

class CaptureProvider implements ILLMProvider {
  public lastMessages: ChatMessage[] = [];

  async generate(messages: ChatMessage[]): Promise<string> {
    this.lastMessages = messages;
    return "ok";
  }
}

class MemoryManagerStub implements IMemoryManager {
  async addEvent(_event: MemoryEvent): Promise<void> {}
  async sealCurrentBlock(): Promise<void> {}
  createNewBlock(): void {}
  async retrieveBlocks(_query: string): Promise<BlockRef[]> {
    return [];
  }
  async getContext(_query: string): Promise<Context> {
    return {
      blocks: [],
      recentEvents: [],
      formatted: "CTX"
    };
  }

  async tickProactiveWakeup(): Promise<void> {}
}

describe("Agent tags introduction injection", () => {
  test("injects AgentDocs/TagsIntro.md with template vars", async () => {
    const folder = await fs.mkdtemp(join(tmpdir(), "mlex-tags-intro-"));
    const docsDir = join(folder, "AgentDocs");
    await fs.mkdir(docsDir, { recursive: true });
    await fs.writeFile(
      join(docsDir, "TagsIntro.md"),
      "Tag policy for {{team}}. Literal: \\{{not_var}}. Unknown={{unknown}}",
      "utf8"
    );

    const provider = new CaptureProvider();
    const agent = new Agent(new MemoryManagerStub(), provider, {
      workspaceRoot: folder,
      includeAgentsMd: false,
      tagsTemplateVars: { team: "search" }
    });

    await agent.respond("hello");
    const systemMessage = provider.lastMessages.find((message) => message.role === "system");
    expect(systemMessage?.content).toContain("=== TAGS INTRODUCTION ===");
    expect(systemMessage?.content).toContain("Tag policy for search.");
    expect(systemMessage?.content).toContain("Literal: {{not_var}}.");
    expect(systemMessage?.content).toContain("Unknown=");
  });

  test("loads docs and vars from tags.toml", async () => {
    const folder = await fs.mkdtemp(join(tmpdir(), "mlex-tags-toml-"));
    const tagsTomlPath = join(folder, "tags.toml");
    await fs.writeFile(
      tagsTomlPath,
      [
        "[docs]",
        'intro = "Follow {{priority}} policy"',
        'item = ["tag: {{tag_name}}", "owner: {{owner}}"]',
        "",
        "[vars]",
        'priority = "P0"',
        'tag_name = "critical"',
        'owner = "ops"'
      ].join("\n"),
      "utf8"
    );

    const provider = new CaptureProvider();
    const agent = new Agent(new MemoryManagerStub(), provider, {
      workspaceRoot: folder,
      includeAgentsMd: false,
      tagsTomlPath
    });

    await agent.respond("hello");
    const systemMessage = provider.lastMessages.find((message) => message.role === "system");
    expect(systemMessage?.content).toContain("=== TAGS INTRODUCTION ===");
    expect(systemMessage?.content).toContain("Follow P0 policy");
    expect(systemMessage?.content).toContain("- tag: critical");
    expect(systemMessage?.content).toContain("- owner: ops");
  });

  test("can disable tags intro injection", async () => {
    const folder = await fs.mkdtemp(join(tmpdir(), "mlex-tags-off-"));
    const docsDir = join(folder, "AgentDocs");
    await fs.mkdir(docsDir, { recursive: true });
    await fs.writeFile(join(docsDir, "TagsIntro.md"), "SHOULD_NOT_APPEAR", "utf8");

    const provider = new CaptureProvider();
    const agent = new Agent(new MemoryManagerStub(), provider, {
      workspaceRoot: folder,
      includeAgentsMd: false,
      includeTagsIntro: false
    });

    await agent.respond("hello");
    const systemMessage = provider.lastMessages.find((message) => message.role === "system");
    expect(systemMessage?.content).not.toContain("SHOULD_NOT_APPEAR");
    expect(systemMessage?.content).not.toContain("=== TAGS INTRODUCTION ===");
  });

  test("maps tags intro options from runtime config overrides", async () => {
    const runtime = createRuntime({
      service: { provider: "rule-based" },
      component: {
        includeTagsIntro: false,
        tagsIntroPath: "AgentDocs/TagsIntro.md",
        tagsTomlPath: "~/.mlex/tags.toml",
        tagsTemplateVars: { team: "search" }
      }
    });

    try {
      const agentInternal = runtime.agent as unknown as {
        tagsIntroduction?: string;
      };
      expect(agentInternal.tagsIntroduction).toBeUndefined();
      expect(runtime.config.component.includeTagsIntro).toBe(false);
      expect(runtime.config.component.tagsIntroPath).toBe("AgentDocs/TagsIntro.md");
      expect(runtime.config.component.tagsTomlPath).toBe("~/.mlex/tags.toml");
      expect(runtime.config.component.tagsTemplateVars).toEqual({ team: "search" });
    } finally {
      await runtime.close();
    }
  });

});
