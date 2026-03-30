import type { MemoryEvent } from "../../types.js";
import { extractKeywords } from "../../utils/text.js";
import type { ISummarizer } from "./ISummarizer.js";

export class HeuristicSummarizer implements ISummarizer {
  summarize(events: MemoryEvent[]): string {
    if (events.length === 0) return "";

    const joined = events.map((event) => `${event.role}: ${event.text}`).join(" ");
    const keywords = extractKeywords(joined, 6);

    // Prioritise user messages — they carry the original intent and topic.
    // Take up to 3 lines: user events first, then other roles, each clipped to
    // 120 chars so the summary stays readable without growing unbounded.
    const userEvents = events.filter((e) => e.role === "user");
    const otherEvents = events.filter((e) => e.role !== "user");
    const selected = [...userEvents, ...otherEvents].slice(0, 3);

    const lines = selected.map((e) => {
      const text = e.text.replace(/\s+/g, " ").trim();
      const clipped = text.length > 120 ? `${text.slice(0, 120)}…` : text;
      return `[${e.role}] ${clipped}`;
    });

    const preview = lines.join("\n");
    if (keywords.length === 0) return preview;
    return `${preview}\nkeywords: ${keywords.join(", ")}`;
  }
}
