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

    const text = nextEvent.text.trim();
    const boundarySignals = /[。！？.!?]\s*$/.test(text) || text.includes("\n\n");
    return boundarySignals;
  }
}
