import { afterEach, describe, expect, test, vi } from "vitest";

import { MemoryBlock } from "../src/memory/MemoryBlock.js";
import { OpenAITagger } from "../src/memory/tagger/OpenAITagger.js";

describe("OpenAITagger", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test("returns important when model emits important tag", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: '{"tags":["important"],"importantScore":0.92}'
            }
          }
        ]
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    const tagger = new OpenAITagger({
      apiKey: "test-key",
      model: "gpt-4.1-nano",
      importantThreshold: 0.6
    });
    const block = buildBlock("block_1", "生产事故导致紧急回滚");

    const tags = await tagger.tag(block);
    expect(tags).toEqual(["important"]);
  });

  test("returns configured custom tag", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: '{"tags":["critical"],"importantScore":0.41}'
            }
          }
        ]
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    const tagger = new OpenAITagger({
      apiKey: "test-key",
      model: "gpt-4.1-nano",
      importantThreshold: 0.6,
      allowedAiTags: ["critical", "normal"]
    });
    const block = buildBlock("block_3", "一般信息");

    const tags = await tagger.tag(block);
    expect(tags).toEqual(["critical"]);
  });

  test("ignores unknown tags from model output", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: '{"tags":["unknown","critical"],"importantScore":0.35}'
            }
          }
        ]
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    const tagger = new OpenAITagger({
      apiKey: "test-key",
      model: "gpt-4.1-nano",
      importantThreshold: 0.6,
      allowedAiTags: ["critical", "normal"]
    });
    const block = buildBlock("block_4", "一般信息");

    const tags = await tagger.tag(block);
    expect(tags).toEqual(["critical"]);
  });

  test("falls back to heuristic on request failure", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network fail"));
    vi.stubGlobal("fetch", fetchMock);

    const tagger = new OpenAITagger({
      apiKey: "test-key",
      model: "gpt-4.1-nano",
      importantThreshold: 0.6
    });
    const block = buildBlock("block_2", "线上 incident blocked, need rollback");

    const tags = await tagger.tag(block);
    expect(tags).toEqual(["important"]);
  });
});

function buildBlock(id: string, summary: string): MemoryBlock {
  const block = new MemoryBlock(id, Date.now());
  block.summary = summary;
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
