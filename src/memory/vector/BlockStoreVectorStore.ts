import type { BlockRef } from "../../types.js";
import { cosineSimilarity } from "../../utils/text.js";
import type { IBlockStore } from "../store/IBlockStore.js";
import type { MemoryBlock } from "../MemoryBlock.js";
import type { IVectorStore } from "./IVectorStore.js";

export class BlockStoreVectorStore implements IVectorStore {
  constructor(private readonly blockStore: IBlockStore) {}

  async add(_block: MemoryBlock): Promise<void> {
    return;
  }

  async remove(_blockId: string): Promise<void> {
    return;
  }

  async search(vector: number[], topK: number): Promise<BlockRef[]> {
    const blocks = await this.blockStore.list();
    const scored: BlockRef[] = [];
    for (const block of blocks) {
      if (block.embedding.length === 0 || block.embedding.length !== vector.length) continue;
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

    return scored.sort((left, right) => right.score - left.score).slice(0, topK);
  }
}
