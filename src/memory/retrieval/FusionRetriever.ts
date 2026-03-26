import type { IBlockRetriever } from "./IBlockRetriever.js";
import type { RetrievalHit, RetrievalInput, RetrievalSource } from "./types.js";

export interface WeightedRetriever {
  source: RetrievalSource;
  retriever: IBlockRetriever;
  weight: number;
}

export class FusionRetriever implements IBlockRetriever {
  constructor(private readonly retrievers: WeightedRetriever[]) {}

  async retrieve(input: RetrievalInput): Promise<RetrievalHit[]> {
    const merged = new Map<
      string,
      {
        hit: RetrievalHit;
        baseScore: number;
        rankScore: number;
        sourceCount: number;
      }
    >();
    const rankK = 10;
    const rankWeight = 0.35;

    for (const item of this.retrievers) {
      const hits = await item.retriever.retrieve(input);
      for (let index = 0; index < hits.length; index += 1) {
        const hit = hits[index];
        const weightedScore = hit.score * item.weight;
        const rankScore = item.weight / (rankK + index + 1);
        const existing = merged.get(hit.blockId);
        if (!existing) {
          merged.set(hit.blockId, {
            hit: {
              ...hit,
              source: hit.source,
              score: weightedScore + rankScore * rankWeight
            },
            baseScore: weightedScore,
            rankScore,
            sourceCount: 1
          });
          continue;
        }
        existing.baseScore += weightedScore;
        existing.rankScore += rankScore;
        existing.sourceCount += 1;
        existing.hit.score = existing.baseScore + existing.rankScore * rankWeight;
        if (!existing.hit.block && hit.block) existing.hit.block = hit.block;
      }
    }

    return [...merged.values()]
      .sort((left, right) => {
        if (right.hit.score !== left.hit.score) {
          return right.hit.score - left.hit.score;
        }
        return right.sourceCount - left.sourceCount;
      })
      .map((entry) => entry.hit)
      .slice(0, input.topK);
  }
}
