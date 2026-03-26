import { describe, expect, test } from "vitest";

import { Agent } from "../src/agent/Agent.js";
import type {
  AgentToolCall,
  AgentToolResult,
  IAgentToolExecutor
} from "../src/agent/AgentToolExecutor.js";
import type { ChatMessage, ILLMProvider } from "../src/agent/LLMProvider.js";
import { createRuntime } from "../src/container.js";

class ToolFlowProvider implements ILLMProvider {
  public rounds = 0;
  public seen: ChatMessage[][] = [];

  async generate(messages: ChatMessage[]): Promise<string> {
    this.rounds += 1;
    this.seen.push(messages.map((message) => ({ ...message })));
    if (this.rounds === 1) {
      return `<tool_call>{"name":"readonly.list","args":{"path":"."}}</tool_call>`;
    }
    return "工具结果已收到，继续回答。";
  }
}

class MockToolExecutor implements IAgentToolExecutor {
  public calls: AgentToolCall[] = [];

  instructions(): string {
    return "mock tools";
  }

  async execute(call: AgentToolCall): Promise<AgentToolResult> {
    this.calls.push(call);
    return {
      ok: true,
      content: "{\"entries\":[{\"path\":\"README.md\",\"type\":\"file\"}]}"
    };
  }
}

describe("Agent tool orchestration", () => {
  test("executes tool calls requested by model", async () => {
    const runtime = createRuntime();
    const provider = new ToolFlowProvider();
    const toolExecutor = new MockToolExecutor();
    const agent = new Agent(runtime.memoryManager, provider, { toolExecutor });

    const response = await agent.respond("列一下当前目录文件");

    expect(response.text).toContain("工具结果已收到");
    expect(provider.rounds).toBe(2);
    expect(toolExecutor.calls).toHaveLength(1);
    expect(toolExecutor.calls[0]?.name).toBe("readonly.list");

    const secondRound = provider.seen[1] ?? [];
    const lastUserMessage = [...secondRound].reverse().find((message) => message.role === "user");
    expect(lastUserMessage?.content).toContain("TOOL_RESULT");
  });
});
