import type { BlockRef } from "../../types.js";
import { cosineSimilarity } from "../../utils/text.js";
import type { MemoryBlock } from "../MemoryBlock.js";
import type { IVectorStore } from "./IVectorStore.js";

export class InMemoryVectorStore implements IVectorStore {
  private blocks = new Map<string, MemoryBlock>();

  add(block: MemoryBlock): void {
    this.blocks.set(block.id, block);
  }

  remove(blockId: string): void {
    this.blocks.delete(blockId);
  }

  async search(vector: number[], topK: number): Promise<BlockRef[]> {
    const scored: BlockRef[] = [];
    for (const block of this.blocks.values()) {
      if (block.embedding.length === 0) continue;
      const score = cosineSimilarity(vector, block.embedding);
      scored.push({
        id: block.id,
        score,
        source: "vector",
        summary: block.summary,
        startTime: block.startTime,
        endTime: block.endTime,
        keywords: block.keywords,
        rawEvents: block.rawEvents,
        retentionMode: block.retentionMode,
        matchScore: block.matchScore,
        conflict: block.conflict
      });
    }

    return scored.sort((a, b) => b.score - a.score).slice(0, topK);
  }
}
