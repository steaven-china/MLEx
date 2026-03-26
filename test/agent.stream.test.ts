import { describe, expect, test } from "vitest";

import { Agent } from "../src/agent/Agent.js";
import type { ChatMessage, ILLMProvider } from "../src/agent/LLMProvider.js";
import { createRuntime } from "../src/container.js";

class StreamingProvider implements ILLMProvider {
  async generate(_messages: ChatMessage[]): Promise<string> {
    return "fallback";
  }

  async generateStream(_messages: ChatMessage[], onToken: (token: string) => void): Promise<string> {
    const tokens = ["hello", " ", "stream"];
    for (const token of tokens) {
      onToken(token);
    }
    return tokens.join("");
  }
}

class NonStreamingProvider implements ILLMProvider {
  async generate(_messages: ChatMessage[]): Promise<string> {
    return "single-shot";
  }
}

describe("Agent stream mode", () => {
  test("uses provider streaming when available", async () => {
    const runtime = createRuntime();
    const agent = new Agent(runtime.memoryManager, new StreamingProvider());
    let output = "";

    const response = await agent.respondStream("请流式回答", (token) => {
      output += token;
    });

    expect(response.text).toBe("hello stream");
    expect(output).toBe("hello stream");
  });

  test("falls back to single generate when stream unavailable", async () => {
    const runtime = createRuntime();
    const agent = new Agent(runtime.memoryManager, new NonStreamingProvider());
    const chunks: string[] = [];

    const response = await agent.respondStream("测试回退", (token) => {
      chunks.push(token);
    });

    expect(response.text).toBe("single-shot");
    expect(chunks.join("")).toBe("single-shot");
  });
});
