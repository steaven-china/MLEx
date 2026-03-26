import type { BlockRef, Context, MemoryEvent } from "../types.js";

export interface IMemoryManager {
  addEvent(event: MemoryEvent): Promise<void>;
  getContext(query: string): Promise<Context>;
  sealCurrentBlock(): Promise<void>;
  createNewBlock(): void;
  retrieveBlocks(query: string): Promise<BlockRef[]>;
}
