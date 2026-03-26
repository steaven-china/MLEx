import type { BlockId, MemoryEvent } from "../../types.js";
import type { IRawEventStore } from "./IRawEventStore.js";

export class InMemoryRawEventStore implements IRawEventStore {
  private readonly table = new Map<BlockId, MemoryEvent[]>();

  put(blockId: BlockId, events: MemoryEvent[]): void {
    this.table.set(blockId, events.map((event) => ({ ...event })));
  }

  get(blockId: BlockId): MemoryEvent[] | undefined {
    const events = this.table.get(blockId);
    return events ? events.map((event) => ({ ...event })) : undefined;
  }

  remove(blockId: BlockId): void {
    this.table.delete(blockId);
  }

  listBlockIds(): BlockId[] {
    return [...this.table.keys()];
  }
}
