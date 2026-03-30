import { afterEach, describe, expect, test, vi } from "vitest";

import { MemoryBlock } from "../src/memory/MemoryBlock.js";
import { OpenAIRelationExtractor } from "../src/memory/relation/OpenAIRelationExtractor.js";

describe("OpenAIRelationExtractor", () => {
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
                '{"relations":[{"src":"block_n1","dst":"block_c1","type":"CONTEXT","confidence":0.82}]}'
            }
          }
        ]
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    const extractor = new OpenAIRelationExtractor({
      apiKey: "test-key",
      model: "gpt-4.1-nano"
    });
    const current = buildBlock("block_c1", "当前任务：支付模块问题复盘");
    const neighbors = [buildBlock("block_n1", "历史背景：支付重试与幂等配置")];

    const relations = await extractor.extract(current, neighbors);
    expect(relations.length).toBe(1);
    expect(relations[0]?.src).toBe("block_n1");
    expect(relations[0]?.dst).toBe("block_c1");
    expect(relations[0]?.type).toBe("CONTEXT");
  });

  test("accepts empty endpoint and keyword relation type", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content:
                '{"relations":[{"src":"","dst":"block_c1","type":"name","confidence":0.82},{"src":"block_n1","dst":"","type":"events","confidence":0.61}]}'
            }
          }
        ]
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    const extractor = new OpenAIRelationExtractor({
      apiKey: "test-key",
      model: "gpt-4.1-nano"
    });
    const current = buildBlock("block_c1", "当前任务：支付模块问题复盘");
    const neighbors = [buildBlock("block_n1", "历史背景：支付重试与幂等配置")];

    const relations = await extractor.extract(current, neighbors);
    expect(relations).toHaveLength(2);
    expect(relations.some((relation) => relation.src === "" && relation.dst === "block_c1" && relation.type === "name")).toBe(true);
    expect(relations.some((relation) => relation.src === "block_n1" && relation.dst === "" && relation.type === "events")).toBe(true);
  });

  test("falls back to heuristic extractor on API failure", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network fail"));
    vi.stubGlobal("fetch", fetchMock);

    const extractor = new OpenAIRelationExtractor({
      apiKey: "test-key",
      model: "gpt-4.1-nano"
    });
    const current = buildBlock("block_c2", "因为 webhook 失败导致任务回滚");
    const neighbors = [buildBlock("block_n2", "之前发生 webhook 重复消费问题")];

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
