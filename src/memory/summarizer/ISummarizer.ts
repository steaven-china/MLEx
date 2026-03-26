import type { MemoryEvent } from "../../types.js";

export interface ISummarizer {
  summarize(events: MemoryEvent[]): string;
}
