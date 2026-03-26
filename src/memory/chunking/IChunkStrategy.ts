import type { MemoryEvent } from "../../types.js";
import type { MemoryBlock } from "../MemoryBlock.js";

export interface IChunkStrategy {
  shouldSeal(block: MemoryBlock, nextEvent: MemoryEvent): boolean;
}
