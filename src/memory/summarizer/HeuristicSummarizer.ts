import type { MemoryEvent } from "../../types.js";
import { extractKeywords } from "../../utils/text.js";
import type { ISummarizer } from "./ISummarizer.js";

export class HeuristicSummarizer implements ISummarizer {
  summarize(events: MemoryEvent[]): string {
    if (events.length === 0) return "";

    const joined = events.map((event) => `${event.role}: ${event.text}`).join(" ");
    const keywords = extractKeywords(joined, 6);
    const first = events[0]?.text ?? "";
    const last = events[events.length - 1]?.text ?? "";

    const preview = [first, last]
      .filter(Boolean)
      .map((text) => text.slice(0, 80).replace(/\s+/g, " ").trim())
      .join(" | ");

    if (keywords.length === 0) return preview;
    return `${preview} | keywords: ${keywords.join(", ")}`;
  }
}
