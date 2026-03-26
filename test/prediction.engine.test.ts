import { describe, expect, test } from "vitest";

import { MemoryBlock } from "../src/memory/MemoryBlock.js";
import { RelationGraph } from "../src/memory/RelationGraph.js";
import { TransEGraphEmbedder } from "../src/memory/prediction/TransEGraphEmbedder.js";
import { createRuntime } from "../src/container.js";
import { RelationType } from "../src/types.js";
import { createId } from "../src/utils/id.js";

describe("Prediction engine", () => {
  test("produces prediction result in runtime context", async () => {
    const runtime = createRuntime({
      manager: {
        predictionEnabled: true,
        predictionTopK: 3,
        predictionWalkDepth: 2,
        predictionActiveThreshold: 0.1
      },
      component: {
        graphEmbeddingMethod: "node2vec"
      }
    });

    const now = Date.now();
    await runtime.memoryManager.addEvent({
      id: createId("event"),
      role: "user",
      text: "步骤一：采集需求。",
      timestamp: now
    });
    await runtime.memoryManager.sealCurrentBlock();
    await runtime.memoryManager.addEvent({
      id: createId("event"),
      role: "assistant",
      text: "步骤二：设计模块接口。",
      timestamp: now + 10
    });
    await runtime.memoryManager.sealCurrentBlock();
    await runtime.memoryManager.addEvent({
      id: createId("event"),
      role: "user",
      text: "步骤三：开始开发与联调。",
      timestamp: now + 20
    });
    await runtime.memoryManager.sealCurrentBlock();
    await runtime.memoryManager.flushAsyncRelations();

    const context = await runtime.memoryManager.getContext("下一步该做什么");
    expect(context.prediction).toBeDefined();
    expect((context.prediction?.intents.length ?? 0)).toBeGreaterThan(0);
    expect((context.prediction?.transitionProbabilities.length ?? 0)).toBeGreaterThan(0);
    expect((context.prediction?.vector.length ?? 0)).toBeGreaterThan(0);
  });

  test("supports transe graph embedding mode", () => {
    const graph = new RelationGraph();
    graph.addRelation("a", "b", RelationType.FOLLOWS);

    const a = new MemoryBlock("a");
    a.embedding = [1, 0, 0, 0];
    a.summary = "task a";

    const b = new MemoryBlock("b");
    b.embedding = [0, 1, 0, 0];
    b.summary = "task b";

    const embedder = new TransEGraphEmbedder();
    const result = embedder.train([a, b], graph);
    expect(result.dimension).toBe(4);
    expect(result.nodeEmbeddings.size).toBe(2);
  });
});
