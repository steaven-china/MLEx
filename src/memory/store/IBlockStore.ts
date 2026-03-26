import type { MemoryBlock } from "../MemoryBlock.js";

export interface IBlockStore {
  upsert(block: MemoryBlock): Promise<void> | void;
  get(blockId: string): Promise<MemoryBlock | undefined> | MemoryBlock | undefined;
  getMany(blockIds: string[]): Promise<MemoryBlock[]> | MemoryBlock[];
  list(): Promise<MemoryBlock[]> | MemoryBlock[];
}
