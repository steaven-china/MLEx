import { afterEach, describe, expect, test, vi } from "vitest";

import { ChromaBlockStore } from "../src/memory/store/ChromaBlockStore.js";

describe("ChromaBlockStore", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test("hydrates missing block on get", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ids: ["block-1"],
        documents: ["summary-1"],
        metadatas: [
          {
            startTime: 100,
            endTime: 120,
            tokenCount: 12,
            keywords: ["alpha"],
            rawEvents: [
              {
                id: "event-1",
                role: "user",
                text: "hello",
                timestamp: 100
              }
            ],
            retentionMode: "raw",
            matchScore: 0.2,
            conflict: false,
            tags: ["critical"]
          }
        ],
        embeddings: [[0.1, 0.2]]
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    const store = new ChromaBlockStore(
      {
        baseUrl: "http://localhost:8000",
        collectionId: "mlex"
      },
      ["critical", "normal"]
    );

    const block = await store.get("block-1");
    expect(block?.id).toBe("block-1");
    expect(block?.summary).toBe("summary-1");
    expect(block?.keywords).toEqual(["alpha"]);
    expect(block?.embedding).toEqual([0.1, 0.2]);
    expect(block?.tags).toEqual(["critical"]);

    await store.get("block-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("hydrates list remotely and sorts by startTime", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ids: ["b", "a"],
        documents: ["summary-b", "summary-a"],
        metadatas: [
          { startTime: 300, endTime: 320, tokenCount: 10, keywords: ["b"] },
          { startTime: 100, endTime: 130, tokenCount: 8, keywords: ["a"] }
        ],
        embeddings: [[0.2, 0.8], [0.9, 0.1]]
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    const store = new ChromaBlockStore(
      {
        baseUrl: "http://localhost:8000",
        collectionId: "mlex"
      },
      ["critical", "normal"]
    );

    const blocks = await store.list();
    expect(blocks.map((block) => block.id)).toEqual(["a", "b"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
