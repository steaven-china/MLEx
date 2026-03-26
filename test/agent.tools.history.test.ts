import { describe, expect, test } from "vitest";

import { BuiltinAgentToolExecutor } from "../src/agent/AgentToolExecutor.js";
import { createRuntime } from "../src/container.js";
import { createId } from "../src/utils/id.js";

describe("BuiltinAgentToolExecutor history.query", () => {
  test("returns queried conversation records", async () => {
    const runtime = createRuntime({
      manager: {
        maxTokensPerBlock: 120,
        minTokensPerBlock: 40
      }
    });

    const now = Date.now();
    await runtime.memoryManager.addEvent({
      id: createId("event"),
      role: "user",
      text: "支付 webhook 重试导致重复扣费，需要排查幂等键。",
      timestamp: now
    });
    await runtime.memoryManager.addEvent({
      id: createId("event"),
      role: "assistant",
      text: "建议先看幂等键和重试队列。",
      timestamp: now + 1
    });
    await runtime.memoryManager.sealCurrentBlock();

    const tool = new BuiltinAgentToolExecutor({
      workspaceRoot: process.cwd(),
      memoryManager: runtime.memoryManager
    });
    const result = await tool.execute({
      name: "history.query",
      args: {
        query: "支付 webhook 幂等",
        topBlocks: 3,
        includeRaw: true,
        includeRecent: true
      }
    });

    expect(result.ok).toBe(true);
    const payload = JSON.parse(result.content) as {
      blockCount?: number;
      blocks?: Array<{ id?: string; rawEvents?: unknown[] }>;
      recentEvents?: unknown[];
    };
    expect((payload.blockCount ?? 0)).toBeGreaterThan(0);
    expect((payload.blocks?.length ?? 0)).toBeGreaterThan(0);
    expect(Array.isArray(payload.blocks?.[0]?.rawEvents)).toBe(true);
    expect(Array.isArray(payload.recentEvents)).toBe(true);
  });
});
