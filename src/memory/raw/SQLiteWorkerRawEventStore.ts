import type { BlockId, MemoryEvent } from "../../types.js";
import { SQLiteWorkerClient } from "../sqlite-worker/SQLiteWorkerClient.js";
import type { IRawEventStore } from "./IRawEventStore.js";

export class SQLiteWorkerRawEventStore implements IRawEventStore {
  constructor(private readonly worker: SQLiteWorkerClient) {}

  async put(blockId: BlockId, events: MemoryEvent[]): Promise<void> {
    await this.worker.request("raw.put", { blockId, events });
  }

  async get(blockId: BlockId): Promise<MemoryEvent[] | undefined> {
    return this.worker.request<MemoryEvent[] | undefined>("raw.get", blockId);
  }

  async remove(blockId: BlockId): Promise<void> {
    await this.worker.request("raw.remove", blockId);
  }

  async listBlockIds(): Promise<BlockId[]> {
    return this.worker.request<BlockId[]>("raw.listBlockIds");
  }
}
