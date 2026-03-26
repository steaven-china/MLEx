import { describe, expect, test } from "vitest";

import { FusionRetriever } from "../src/memory/retrieval/FusionRetriever.js";
import type { IBlockRetriever } from "../src/memory/retrieval/IBlockRetriever.js";
import type { RetrievalHit, RetrievalInput } from "../src/memory/retrieval/types.js";

class StaticRetriever implements IBlockRetriever {
  constructor(private readonly hits: RetrievalHit[]) {}

  async retrieve(_input: RetrievalInput): Promise<RetrievalHit[]> {
    return this.hits;
  }
}

describe("FusionRetriever", () => {
  test("reranks by weighted score plus rank consensus", async () => {
    const retriever = new FusionRetriever([
      {
        source: "keyword",
        weight: 0.5,
        retriever: new StaticRetriever([
          { blockId: "a", score: 1, source: "keyword" },
          { blockId: "b", score: 0.8, source: "keyword" }
        ])
      },
      {
        source: "vector",
        weight: 0.5,
        retriever: new StaticRetriever([
          { blockId: "b", score: 1, source: "vector" },
          { blockId: "c", score: 0.95, source: "vector" }
        ])
      }
    ]);

    const output = await retriever.retrieve({
      query: "q",
      keywords: [],
      embedding: [],
      topK: 3
    });

    expect(output[0]?.blockId).toBe("b");
    expect(output.map((item) => item.blockId)).toEqual(["b", "a", "c"]);
  });
});
