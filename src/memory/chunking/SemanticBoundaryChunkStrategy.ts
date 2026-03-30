import type { MemoryEvent } from "../../types.js";
import { estimateTokens } from "../../utils/text.js";
import type { MemoryBlock } from "../MemoryBlock.js";
import type { IChunkStrategy } from "./IChunkStrategy.js";

export interface SemanticBoundaryConfig {
  maxTokens: number;
  minTokens: number;
}

export class SemanticBoundaryChunkStrategy implements IChunkStrategy {
  constructor(private readonly config: SemanticBoundaryConfig) {}

  shouldSeal(block: MemoryBlock, nextEvent: MemoryEvent): boolean {
    if (block.tokenCount === 0) return false;

    const nextTokens = estimateTokens(nextEvent.text);
    const hardCut = block.tokenCount + nextTokens > this.config.maxTokens * 1.35;
    if (hardCut) return true;

    if (block.tokenCount + nextTokens < this.config.maxTokens) return false;
    if (block.tokenCount < this.config.minTokens) return false;

    return isBoundary(block, nextEvent);
  }
}

/**
 * Detects a semantic boundary between the last event in `block` and `nextEvent`.
 *
 * Signals (any one is sufficient):
 * 1. Role switch (e.g. assistant → user) — conversation turn boundary.
 * 2. Last event ends with sentence-final punctuation and next event starts a new topic marker.
 * 3. Double newline in either the last event or the next event (explicit paragraph break).
 * 4. Next event starts with a topic-shift phrase in Chinese or English.
 */
function isBoundary(block: MemoryBlock, nextEvent: MemoryEvent): boolean {
  const lastEvent = block.rawEvents[block.rawEvents.length - 1];
  if (!lastEvent) return false;

  // Signal 1: role switch (assistant → user is the strongest natural boundary)
  if (lastEvent.role !== nextEvent.role) return true;

  const lastText = lastEvent.text.trimEnd();
  const nextText = nextEvent.text.trimStart();

  // Signal 2: last event ends with terminal punctuation
  const terminalPunct = /[。！？.!?]["'」』]?$/.test(lastText);
  if (terminalPunct) return true;

  // Signal 3: explicit paragraph break in either event
  if (lastText.includes("\n\n") || nextText.includes("\n\n")) return true;

  // Signal 4: next event starts with a known topic-shift phrase
  const topicShiftPrefixes = [
    // Chinese
    "另外", "另一方面", "还有", "接下来", "下面", "那么", "好了", "换个话题",
    "顺便", "对了", "说起", "问一下", "再问",
    // English
    "by the way", "anyway", "moving on", "next,", "now,", "ok,", "alright,",
    "let me ask", "one more thing", "also,"
  ];
  const lower = nextText.toLowerCase();
  if (topicShiftPrefixes.some((p) => lower.startsWith(p))) return true;

  return false;
}
