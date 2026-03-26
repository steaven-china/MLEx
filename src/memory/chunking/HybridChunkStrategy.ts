import type { MemoryEvent } from "../../types.js";
import type { MemoryBlock } from "../MemoryBlock.js";
import type { IChunkStrategy } from "./IChunkStrategy.js";

export class HybridChunkStrategy implements IChunkStrategy {
  constructor(
    private readonly fixedTokenStrategy: IChunkStrategy,
    private readonly semanticBoundaryStrategy: IChunkStrategy
  ) {}

  shouldSeal(block: MemoryBlock, nextEvent: MemoryEvent): boolean {
    return (
      this.fixedTokenStrategy.shouldSeal(block, nextEvent) ||
      this.semanticBoundaryStrategy.shouldSeal(block, nextEvent)
    );
  }
}
