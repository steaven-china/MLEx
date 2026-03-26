import type { BlockRef } from "../../types.js";
import type { IRawEventStore } from "../raw/IRawEventStore.js";

export class RawBacktracker {
  constructor(private readonly rawStore: IRawEventStore) {}

  async fillRawEvents(blocks: BlockRef[]): Promise<BlockRef[]> {
    const output: BlockRef[] = [];
    for (const block of blocks) {
      if (block.rawEvents && block.rawEvents.length > 0) {
        output.push(block);
        continue;
      }
      const rawEvents = await this.rawStore.get(block.id);
      output.push({
        ...block,
        rawEvents: rawEvents ?? []
      });
    }
    return output;
  }
}
