import type { IBlockStore } from "../store/IBlockStore.js";
import type { IVectorStore } from "../vector/IVectorStore.js";
import type { IBlockRetriever } from "./IBlockRetriever.js";
import type { RetrievalHit, RetrievalInput } from "./types.js";

export class VectorRetriever implements IBlockRetriever {
  constructor(
    private readonly vectorStore: IVectorStore,
    private readonly blockStore: IBlockStore
  ) {}

  async retrieve(input: RetrievalInput): Promise<RetrievalHit[]> {
    const refs = await this.vectorStore.search(input.embedding, input.topK);
    const hits: RetrievalHit[] = [];
    for (const ref of refs) {
      const block = await this.blockStore.get(ref.id);
      hits.push({
        blockId: ref.id,
        score: ref.score,
        source: "vector",
        block
      });
    }
    return hits;
  }
}
