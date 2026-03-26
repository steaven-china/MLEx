import type { MemoryBlock } from "../MemoryBlock.js";
import type { IBlockStore } from "./IBlockStore.js";

export class InMemoryBlockStore implements IBlockStore {
  private readonly table = new Map<string, MemoryBlock>();

  upsert(block: MemoryBlock): void {
    this.table.set(block.id, block);
  }

  get(blockId: string): MemoryBlock | undefined {
    return this.table.get(blockId);
  }

  getMany(blockIds: string[]): MemoryBlock[] {
    return blockIds
      .map((blockId) => this.table.get(blockId))
      .filter((item): item is MemoryBlock => Boolean(item));
  }

  list(): MemoryBlock[] {
    return [...this.table.values()].sort((a, b) => a.startTime - b.startTime);
  }
}
