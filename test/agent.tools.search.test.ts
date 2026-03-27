import { describe, expect, test } from "vitest";

import { BuiltinAgentToolExecutor } from "../src/agent/AgentToolExecutor.js";
import type { IMemoryManager } from "../src/memory/IMemoryManager.js";
import type { ISearchProvider, SearchQuery, SearchRecord } from "../src/search/ISearchProvider.js";
import type { IWebPageFetcher, WebPageFetchResult } from "../src/search/IWebPageFetcher.js";
import type { BlockRef, Context, MemoryEvent } from "../src/types.js";

class FakeMemoryManager implements IMemoryManager {
  public events: MemoryEvent[] = [];
  public context: Context = {
    blocks: [],
    recentEvents: [],
    formatted: ""
  };

  async addEvent(event: MemoryEvent): Promise<void> {
    this.events.push(event);
  }

  async getContext(): Promise<Context> {
    return this.context;
  }

  async sealCurrentBlock(): Promise<void> {}

  createNewBlock(): void {}

  async retrieveBlocks(): Promise<BlockRef[]> {
    return [];
  }
}

class MockSearchProvider implements ISearchProvider {
  public calls: SearchQuery[] = [];

  constructor(private readonly records: SearchRecord[]) {}

  async search(input: SearchQuery): Promise<SearchRecord[]> {
    this.calls.push(input);
    return this.records;
  }
}

class MockWebPageFetcher implements IWebPageFetcher {
  constructor(private readonly result: WebPageFetchResult) {}

  async fetch(): Promise<WebPageFetchResult> {
    return this.result;
  }
}

describe("BuiltinAgentToolExecutor search tools", () => {
  test("records web search results into memory", async () => {
    const memory = new FakeMemoryManager();
    const searchProvider = new MockSearchProvider([
      {
        title: "Retry Pattern",
        url: "https://example.com/retry",
        snippet: "Use idempotency key",
        source: "mock",
        rank: 1,
        fetchedAt: Date.now()
      }
    ]);
    const tool = new BuiltinAgentToolExecutor({
      workspaceRoot: process.cwd(),
      memoryManager: memory,
      searchProvider,
      searchTopK: 5
    });

    const result = await tool.execute({
      name: "web.search.record",
      args: {
        query: "payment retry",
        limit: 3
      }
    });

    expect(result.ok).toBe(true);
    expect(searchProvider.calls[0]).toEqual({ query: "payment retry", limit: 3 });
    expect(memory.events).toHaveLength(1);
    expect(memory.events[0]?.text).toContain("web search: payment retry");
    expect(memory.events[0]?.metadata?.tool).toBe("web.search.record");

    const payload = JSON.parse(result.content) as { count?: number };
    expect(payload.count).toBe(1);
  });

  test("triggers search ingest in auto mode before history query", async () => {
    const memory = new FakeMemoryManager();
    const searchProvider = new MockSearchProvider([
      {
        title: "Webhook Guide",
        url: "https://example.com/webhook",
        snippet: "idempotency and retries",
        source: "mock",
        rank: 1,
        fetchedAt: Date.now()
      }
    ]);
    const tool = new BuiltinAgentToolExecutor({
      workspaceRoot: process.cwd(),
      memoryManager: memory,
      searchProvider,
      searchAugmentMode: "auto",
      searchTopK: 4
    });

    const result = await tool.execute({
      name: "history.query",
      args: {
        query: "payment webhook",
        includePrediction: false
      }
    });

    expect(result.ok).toBe(true);
    expect(searchProvider.calls[0]).toEqual({ query: "payment webhook", limit: 4 });
    expect(memory.events).toHaveLength(1);
    expect(memory.events[0]?.metadata?.mode).toBe("auto");
  });

  test("fetches page content and appends truncated record", async () => {
    const memory = new FakeMemoryManager();
    const pageFetcher = new MockWebPageFetcher({
      url: "https://example.com/doc",
      title: "Doc",
      content: "abcdef".repeat(60),
      fetchedAt: Date.now()
    });
    const tool = new BuiltinAgentToolExecutor({
      workspaceRoot: process.cwd(),
      memoryManager: memory,
      webPageFetcher: pageFetcher
    });

    const result = await tool.execute({
      name: "web.fetch.record",
      args: {
        url: "https://example.com/doc",
        maxChars: 20
      }
    });

    expect(result.ok).toBe(true);
    expect(memory.events).toHaveLength(1);
    expect(memory.events[0]?.metadata?.tool).toBe("web.fetch.record");
    expect(memory.events[0]?.metadata?.truncated).toBe(true);

    const payload = JSON.parse(result.content) as { truncated?: boolean; content?: string };
    expect(payload.truncated).toBe(true);
    expect(payload.content).toContain("...[truncated]");
  });
});
