import { describe, expect, test } from "vitest";

import { createRuntime } from "../src/container.js";
import { createId } from "../src/utils/id.js";

describe("PartitionMemoryManager", () => {
  test("seals blocks and retrieves semantic context", async () => {
    const runtime = createRuntime({
      manager: {
        maxTokensPerBlock: 60,
        minTokensPerBlock: 20,
        semanticTopK: 5,
        finalTopK: 5
      },
      component: {
        chunkStrategy: "fixed"
      }
    });

    const now = Date.now();
    await runtime.memoryManager.addEvent({
      id: createId("event"),
      role: "user",
      text: "我们在支付模块遇到了订单状态不一致的问题，需要排查 webhook 重试。",
      timestamp: now
    });
    await runtime.memoryManager.addEvent({
      id: createId("event"),
      role: "assistant",
      text: "建议先检查幂等键是否生效，以及重试队列是否重复消费。",
      timestamp: now + 10
    });
    await runtime.memoryManager.sealCurrentBlock();

    await runtime.memoryManager.addEvent({
      id: createId("event"),
      role: "user",
      text: "最终修复是在 webhook handler 增加幂等锁，并修复了延迟任务配置。",
      timestamp: now + 20
    });
    await runtime.memoryManager.sealCurrentBlock();
    await runtime.memoryManager.flushAsyncRelations();

    const context = await runtime.memoryManager.getContext("支付 webhook 幂等 问题");
    expect(context.blocks.length).toBeGreaterThan(0);
    expect(context.formatted).toContain("RETRIEVED BLOCKS");
  });

  test("supports relation graph traversal for directional query", async () => {
    const runtime = createRuntime({
      manager: {
        relationDepth: 1,
        graphExpansionTopK: 3
      }
    });

    const now = Date.now();
    await runtime.memoryManager.addEvent({
      id: createId("event"),
      role: "user",
      text: "任务A：先完成需求分析并拆分子任务。",
      timestamp: now
    });
    await runtime.memoryManager.sealCurrentBlock();

    await runtime.memoryManager.addEvent({
      id: createId("event"),
      role: "assistant",
      text: "任务B：根据分析结果开始编码实现。",
      timestamp: now + 10
    });
    await runtime.memoryManager.sealCurrentBlock();
    await runtime.memoryManager.flushAsyncRelations();

    const context = await runtime.memoryManager.getContext("下一步是什么");
    expect(context.blocks.length).toBeGreaterThan(0);
  });
});
