import { createId } from "../utils/id.js";
import type { IMemoryManager } from "../memory/IMemoryManager.js";
import type { ISearchProvider } from "./ISearchProvider.js";

interface SearchIngestSchedulerConfig {
  memoryManager: IMemoryManager;
  searchProvider: ISearchProvider;
  enabled: boolean;
  intervalMinutes: number;
  seeds: string[];
  topK: number;
}

export class SearchIngestScheduler {
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly config: SearchIngestSchedulerConfig) {}

  start(): void {
    if (!this.config.enabled) return;
    const intervalMs = Math.max(1, this.config.intervalMinutes) * 60 * 1000;
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
    void this.tick();
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (const query of this.config.seeds) {
        const trimmed = query.trim();
        if (!trimmed) continue;
        const results = await this.config.searchProvider.search({
          query: trimmed,
          limit: this.config.topK
        });
        if (results.length === 0) continue;

        const summary = results
          .map((item) => `${item.rank}. ${item.title} | ${item.url} | ${item.snippet}`)
          .join("\n");

        await this.config.memoryManager.addEvent({
          id: createId("event"),
          role: "tool",
          text: `scheduled search: ${trimmed}\n${summary}`,
          timestamp: Date.now(),
          metadata: {
            tool: "web.search.record",
            mode: "scheduled",
            query: trimmed,
            count: results.length,
            results
          }
        });
      }
      await this.config.memoryManager.sealCurrentBlock();
    } finally {
      this.running = false;
    }
  }
}
