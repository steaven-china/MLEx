import type { IBlockStore } from "../store/IBlockStore.js";
import type { IVectorStore } from "../vector/IVectorStore.js";
import type { IBlockRetriever } from "./IBlockRetriever.js";
import type { RetrievalHit, RetrievalInput } from "./types.js";

export class VectorRetriever implements IBlockRetriever {
  constructor(
    private readonly vectorStore: IVectorStore,
    private readonly blockStore: IBlockStore,
    private readonly minScore = 0
  ) {}

  async retrieve(input: RetrievalInput): Promise<RetrievalHit[]> {
    const refs = await this.vectorStore.search(input.embedding, input.topK);
    // Only return results that clear the minimum similarity threshold.
    // Do NOT fall back to unfiltered results when nothing passes — returning
    // low-quality vectors inflates noise in the fusion layer more than
    // returning nothing does.
    const selectedRefs = refs.filter((ref) => ref.score >= this.minScore);
    const blockIds = selectedRefs.map((ref) => ref.id);
    const blocks = await this.blockStore.getMany(blockIds);
    const blockMap = new Map(blocks.map((block) => [block.id, block]));
    return selectedRefs.map((ref) => ({
      blockId: ref.id,
      score: ref.score,
      source: "vector",
      block: blockMap.get(ref.id)
    }));
  }
}
