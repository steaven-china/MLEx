import { InvertedIndex } from "../InvertedIndex.js";
import type { IBlockStore } from "../store/IBlockStore.js";
import type { IBlockRetriever } from "./IBlockRetriever.js";
import type { RetrievalHit, RetrievalInput } from "./types.js";

export class KeywordRetriever implements IBlockRetriever {
  constructor(
    private readonly index: InvertedIndex,
    private readonly blockStore: IBlockStore
  ) {}

  async retrieve(input: RetrievalInput): Promise<RetrievalHit[]> {
    const candidates = this.index.lookup(input.keywords);
    const result: RetrievalHit[] = [];
    for (const blockId of candidates) {
      const block = await this.blockStore.get(blockId);
      if (!block) continue;
      const overlap = countOverlap(input.keywords, block.keywords);
      const score = overlap / Math.max(input.keywords.length, 1);
      result.push({ blockId, score, source: "keyword", block });
    }
    return result.sort((a, b) => b.score - a.score).slice(0, input.topK);
  }
}

function countOverlap(left: string[], right: string[]): number {
  const rightSet = new Set(right.map((item) => item.toLowerCase()));
  return left.reduce((sum, item) => sum + Number(rightSet.has(item.toLowerCase())), 0);
}
