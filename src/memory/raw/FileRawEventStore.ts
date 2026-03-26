import { promises as fs } from "node:fs";

import type { BlockId, MemoryEvent } from "../../types.js";
import { writeJsonAtomic } from "../../utils/fs.js";
import type { IRawEventStore } from "./IRawEventStore.js";

export interface FileRawEventStoreConfig {
  filePath: string;
}

type Payload = Record<BlockId, MemoryEvent[]>;

export class FileRawEventStore implements IRawEventStore {
  private readonly table = new Map<BlockId, MemoryEvent[]>();
  private initialized = false;

  constructor(private readonly config: FileRawEventStoreConfig) {}

  async put(blockId: BlockId, events: MemoryEvent[]): Promise<void> {
    await this.ensureLoaded();
    this.table.set(blockId, events.map((event) => ({ ...event })));
    await this.flush();
  }

  async get(blockId: BlockId): Promise<MemoryEvent[] | undefined> {
    await this.ensureLoaded();
    const events = this.table.get(blockId);
    return events ? events.map((event) => ({ ...event })) : undefined;
  }

  async remove(blockId: BlockId): Promise<void> {
    await this.ensureLoaded();
    this.table.delete(blockId);
    await this.flush();
  }

  async listBlockIds(): Promise<BlockId[]> {
    await this.ensureLoaded();
    return [...this.table.keys()];
  }

  private async ensureLoaded(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    try {
      const raw = await fs.readFile(this.config.filePath, "utf8");
      const parsed = JSON.parse(raw) as Payload;
      for (const [blockId, events] of Object.entries(parsed)) {
        this.table.set(blockId, events.map((event) => ({ ...event })));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("ENOENT")) {
        throw error;
      }
    }
  }

  private async flush(): Promise<void> {
    const payload: Payload = {};
    for (const [blockId, events] of this.table.entries()) {
      payload[blockId] = events.map((event) => ({ ...event }));
    }
    await writeJsonAtomic(this.config.filePath, payload);
  }
}
