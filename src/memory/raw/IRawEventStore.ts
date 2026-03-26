import type { BlockId, MemoryEvent } from "../../types.js";

export interface IRawEventStore {
  put(blockId: BlockId, events: MemoryEvent[]): Promise<void> | void;
  get(blockId: BlockId): Promise<MemoryEvent[] | undefined> | MemoryEvent[] | undefined;
  remove(blockId: BlockId): Promise<void> | void;
  listBlockIds(): Promise<BlockId[]> | BlockId[];
}
