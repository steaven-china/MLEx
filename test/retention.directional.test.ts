import { describe, expect, test } from "vitest";

import { MemoryBlock } from "../src/memory/MemoryBlock.js";
import { RetentionPolicyEngine } from "../src/memory/management/RetentionPolicyEngine.js";
import type { IRetentionAction } from "../src/memory/management/RetentionActions.js";
import { RelationGraph } from "../src/memory/RelationGraph.js";
import { HistoryMatchCalculator } from "../src/memory/management/HistoryMatchCalculator.js";
import type { RetentionMode } from "../src/types.js";

function mockAction(mode: RetentionMode): IRetentionAction {
  return {
    mode,
    async apply() {
      return;
    }
  };
}

describe("Directional retention", () => {
  test("keeps high-match block when directional progression is strong", () => {
    const engine = new RetentionPolicyEngine(
      {
        highMatchThreshold: 0.8,
        lowMatchThreshold: 0.3,
        conflictMarkerEnabled: true
      },
      {
        compress: mockAction("compressed"),
        keepRaw: mockAction("raw"),
        conflict: mockAction("conflict")
      }
    );

    const block = new MemoryBlock("block-1");
    block.summary = "当前阶段进入下一步执行";
    const decision = engine.decide({
      block,
      matchScore: 0.92,
      directionalAffinity: 0.8,
      noveltyScore: 0.32
    });

    expect(decision.action.mode).toBe("raw");
    expect(decision.reason).toBe("high_match_directional_progress");
  });

  test("still compresses high-match block when directionality is weak", () => {
    const engine = new RetentionPolicyEngine(
      {
        highMatchThreshold: 0.8,
        lowMatchThreshold: 0.3,
        conflictMarkerEnabled: true
      },
      {
        compress: mockAction("compressed"),
        keepRaw: mockAction("raw"),
        conflict: mockAction("conflict")
      }
    );

    const block = new MemoryBlock("block-2");
    block.summary = "重复问题记录";
    const decision = engine.decide({
      block,
      matchScore: 0.92,
      directionalAffinity: 0.2,
      noveltyScore: 0.1
    });

    expect(decision.action.mode).toBe("compressed");
    expect(decision.reason).toBe("high_match_redundant");
  });

  test("history match emits directional affinity for forward-progress text", () => {
    const calculator = new HistoryMatchCalculator(new RelationGraph());
    const previous = new MemoryBlock("prev", 1000);
    previous.endTime = 2000;
    previous.summary = "支付问题定位";
    previous.keywords = ["支付", "问题", "定位"];
    previous.embedding = [1, 0, 0];

    const current = new MemoryBlock("curr", 3000);
    current.endTime = 4000;
    current.summary = "然后进入下一步回滚执行";
    current.keywords = ["支付", "回滚", "下一步"];
    current.embedding = [1, 0, 0];

    const result = calculator.calculate(current, [previous]);
    expect(result.directionalAffinity).toBeGreaterThan(0.6);
    expect(result.noveltyScore).toBeGreaterThan(0.4);
  });

  test("uses adaptive soft zone to compress near threshold", () => {
    const engine = new RetentionPolicyEngine(
      {
        highMatchThreshold: 0.8,
        lowMatchThreshold: 0.3,
        softBand: 0.1,
        preserveWeight: 0.7,
        minRawTokens: 32,
        conflictMarkerEnabled: true
      },
      {
        compress: mockAction("compressed"),
        keepRaw: mockAction("raw"),
        conflict: mockAction("conflict")
      }
    );

    const block = new MemoryBlock("block-3");
    block.summary = "重复执行记录";
    block.tokenCount = 120;
    const decision = engine.decide({
      block,
      matchScore: 0.78,
      directionalAffinity: 0.1,
      noveltyScore: 0.05
    });

    expect(decision.action.mode).toBe("compressed");
    expect(decision.reason).toBe("adaptive_soft_compress");
  });

  test("uses adaptive soft zone to preserve directional progress", () => {
    const engine = new RetentionPolicyEngine(
      {
        highMatchThreshold: 0.8,
        lowMatchThreshold: 0.3,
        softBand: 0.1,
        preserveWeight: 0.7,
        minRawTokens: 32,
        conflictMarkerEnabled: true
      },
      {
        compress: mockAction("compressed"),
        keepRaw: mockAction("raw"),
        conflict: mockAction("conflict")
      }
    );

    const block = new MemoryBlock("block-4");
    block.summary = "然后进入下一步验证";
    block.tokenCount = 120;
    const decision = engine.decide({
      block,
      matchScore: 0.78,
      directionalAffinity: 0.78,
      noveltyScore: 0.42
    });

    expect(decision.action.mode).toBe("raw");
    expect(decision.reason).toBe("adaptive_soft_keep");
  });
});
