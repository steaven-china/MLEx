import { afterEach, describe, expect, test, vi } from "vitest";

import { MemoryBlock } from "../src/memory/MemoryBlock.js";
import { DeepSeekRelationExtractor } from "../src/memory/relation/DeepSeekRelationExtractor.js";

describe("DeepSeekRelationExtractor", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test("parses model JSON response into relations", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content:
                '{"relations":[{"src":"block_n1","dst":"block_c1","type":"FOLLOWS","confidence":0.81}]}'
            }
          }
        ]
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    const extractor = new DeepSeekRelationExtractor({
      apiKey: "test-key",
      model: "deepseek-reasoner"
    });
    const current = buildBlock("block_c1", "当前：修复支付链路");
    const neighbors = [buildBlock("block_n1", "上一阶段：需求分析")];

    const relations = await extractor.extract(current, neighbors);
    expect(relations.length).toBe(1);
    expect(relations[0]?.src).toBe("block_n1");
    expect(relations[0]?.dst).toBe("block_c1");
    expect(relations[0]?.type).toBe("FOLLOWS");
  });

  test("falls back to heuristic extractor on API failure", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network fail"));
    vi.stubGlobal("fetch", fetchMock);

    const extractor = new DeepSeekRelationExtractor({
      apiKey: "test-key",
      model: "deepseek-reasoner"
    });
    const current = buildBlock("block_c2", "因为依赖失败导致任务中断");
    const neighbors = [buildBlock("block_n2", "之前出现依赖故障问题")];

    const relations = await extractor.extract(current, neighbors);
    expect(relations.length).toBeGreaterThan(0);
  });
});

function buildBlock(id: string, summary: string): MemoryBlock {
  const block = new MemoryBlock(id, Date.now());
  block.summary = summary;
  block.keywords = summary.split(/\s+/);
  block.rawEvents = [
    {
      id: `${id}_event`,
      role: "user",
      text: summary,
      timestamp: Date.now()
    }
  ];
  return block;
}
