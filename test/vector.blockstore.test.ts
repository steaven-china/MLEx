import { describe, expect, test } from "vitest";

import { MemoryBlock } from "../src/memory/MemoryBlock.js";
import { InMemoryBlockStore } from "../src/memory/store/InMemoryBlockStore.js";
import { BlockStoreVectorStore } from "../src/memory/vector/BlockStoreVectorStore.js";

describe("BlockStoreVectorStore", () => {
  test("searches embeddings directly from block store", async () => {
    const blockStore = new InMemoryBlockStore();
    const vectorStore = new BlockStoreVectorStore(blockStore);

    const a = new MemoryBlock("a");
    a.embedding = [1, 0, 0];
    a.summary = "A";
    blockStore.upsert(a);

    const b = new MemoryBlock("b");
    b.embedding = [0, 1, 0];
    b.summary = "B";
    blockStore.upsert(b);

    const hits = await vectorStore.search([0.9, 0.1, 0], 2);
    expect(hits.map((item) => item.id)).toEqual(["a", "b"]);
    expect((hits[0]?.score ?? 0)).toBeGreaterThan(hits[1]?.score ?? 0);
  });
});
