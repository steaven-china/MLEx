import { describe, expect, test } from "vitest";

import { Agent } from "../src/agent/Agent.js";
import type { IAgentToolExecutor } from "../src/agent/AgentToolExecutor.js";
import type { ChatMessage, ILLMProvider } from "../src/agent/LLMProvider.js";
import { createRuntime } from "../src/container.js";

class MalformedThenValidProvider implements ILLMProvider {
  private round = 0;

  async generate(messages: ChatMessage[]): Promise<string> {
    this.round += 1;
    if (this.round === 1) {
      return "<tool_call>{not json}</tool_call>";
    }
    if (this.round === 2) {
      const lastUser = [...messages].reverse().find((message) => message.role === "user");
      if (!(lastUser?.content ?? "").includes("Invalid <tool_call> payload")) {
        throw new Error("parser feedback message missing");
      }
      return '<tool_call>{"name":"readonly.list","args":{"path":"."}}</tool_call>';
    }
    return "done";
  }
}

class CountingToolExecutor implements IAgentToolExecutor {
  public callCount = 0;

  instructions(): string {
    return "mock tools";
  }

  async execute(): Promise<{ ok: boolean; content: string }> {
    this.callCount += 1;
    return { ok: true, content: "{}" };
  }
}

describe("Agent tool parsing resilience", () => {
  test("retries when tool_call payload is malformed", async () => {
    const runtime = createRuntime();
    const provider = new MalformedThenValidProvider();
    const toolExecutor = new CountingToolExecutor();
    const agent = new Agent(runtime.memoryManager, provider, { toolExecutor });

    const result = await agent.respond("list files");
    expect(result.text).toBe("done");
    expect(toolExecutor.callCount).toBe(1);
  });
});
