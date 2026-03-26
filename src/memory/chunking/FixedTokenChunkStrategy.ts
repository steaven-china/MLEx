import type { MemoryEvent } from "../../types.js";
import { estimateTokens } from "../../utils/text.js";
import type { MemoryBlock } from "../MemoryBlock.js";
import type { IChunkStrategy } from "./IChunkStrategy.js";

export class FixedTokenChunkStrategy implements IChunkStrategy {
  constructor(private readonly maxTokensPerBlock: number) {}

  shouldSeal(block: MemoryBlock, nextEvent: MemoryEvent): boolean {
    const nextTokens = estimateTokens(nextEvent.text);
    return block.tokenCount > 0 && block.tokenCount + nextTokens > this.maxTokensPerBlock;
  }
}
