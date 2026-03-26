import type { RetentionMode } from "../../types.js";
import type { MemoryBlock } from "../MemoryBlock.js";
import type { IRawEventStore } from "../raw/IRawEventStore.js";

export interface IRetentionAction {
  mode: RetentionMode;
  apply(block: MemoryBlock, rawStore: IRawEventStore): Promise<void>;
}

export class CompressAction implements IRetentionAction {
  readonly mode: RetentionMode = "compressed";

  async apply(block: MemoryBlock, rawStore: IRawEventStore): Promise<void> {
    await rawStore.put(block.id, block.rawEvents);
    block.rawEvents = [];
    block.retentionMode = this.mode;
    block.conflict = false;
  }
}

export class KeepRawAction implements IRetentionAction {
  readonly mode: RetentionMode = "raw";

  async apply(block: MemoryBlock, rawStore: IRawEventStore): Promise<void> {
    await rawStore.put(block.id, block.rawEvents);
    block.retentionMode = this.mode;
    block.conflict = false;
  }
}

export class ConflictAction implements IRetentionAction {
  readonly mode: RetentionMode = "conflict";

  async apply(block: MemoryBlock, rawStore: IRawEventStore): Promise<void> {
    await rawStore.put(block.id, block.rawEvents);
    block.retentionMode = this.mode;
    block.conflict = true;
  }
}
