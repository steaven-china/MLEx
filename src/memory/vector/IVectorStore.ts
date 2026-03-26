import type { BlockRef } from "../../types.js";
import type { MemoryBlock } from "../MemoryBlock.js";

export interface IVectorStore {
  add(block: MemoryBlock): Promise<void> | void;
  remove(blockId: string): Promise<void> | void;
  search(vector: number[], topK: number): Promise<BlockRef[]>;
}
