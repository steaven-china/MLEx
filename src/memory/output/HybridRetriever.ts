import type { DirectionalIntent, ManagerConfig, RelationType } from "../../types.js";
import type { FusionRetriever } from "../retrieval/FusionRetriever.js";
import type { GraphRetriever } from "../retrieval/GraphRetriever.js";

export interface HybridRetrieveInput {
  query: string;
  keywords: string[];
  embedding: number[];
  activeBlockId?: string;
  directionalIntent?: DirectionalIntent;
  predictedIntents?: Array<{ blockId: string; confidence: number }>;
}

export interface HybridRetrieveOutput {
  scores: Map<string, number>;
  semanticSeedIds: string[];
  graphHitIds?: string[];
  graphHitConfidenceAvg?: number;
}

export class HybridRetriever {
  constructor(
    private readonly config: ManagerConfig,
    private readonly semanticRetriever: FusionRetriever,
    private readonly graphRetriever: GraphRetriever
  ) {}

  async retrieve(input: HybridRetrieveInput): Promise<HybridRetrieveOutput> {
    const semanticHits = await this.semanticRetriever.retrieve({
      query: input.query,
      keywords: input.keywords,
      embedding: input.embedding,
      topK: this.config.semanticTopK
    });

    const scores = new Map<string, number>();
    for (const hit of semanticHits) {
      scores.set(hit.blockId, hit.score);
    }

    const semanticSeedIds = semanticHits.map((hit) => hit.blockId);
    let graphHitIds: string[] = [];
    let graphHitConfidenceAvg = 0;

    if (this.config.enableRelationExpansion) {
      const seedIds = [...semanticSeedIds];
      if (input.activeBlockId) {
        seedIds.push(input.activeBlockId);
      }

      // When a directional intent is present, honour its direction/types/depth.
      // For all other queries do a shallow bidirectional expansion on the two
      // most common relation types (FOLLOWS + CONTEXT) so the graph always
      // participates in retrieval, not only on explicitly relational queries.
      const direction = input.directionalIntent?.direction ?? "both";
      const relationTypes: RelationType[] =
        input.directionalIntent?.relationTypes ??
        ([] as RelationType[]); // empty = all types accepted by GraphRetriever
      const depth = input.directionalIntent?.depth ?? 1;

      const graphHits = await this.graphRetriever.retrieve({
        query: input.query,
        keywords: input.keywords,
        embedding: input.embedding,
        topK: this.config.graphExpansionTopK,
        seedBlockIds: seedIds,
        direction,
        relationTypes,
        depth
      });
      graphHitIds = graphHits.map((hit) => hit.blockId);
      graphHitConfidenceAvg =
        graphHits.length > 0
          ? graphHits.reduce((sum, hit) => sum + hit.score, 0) / graphHits.length
          : 0;

      for (const hit of graphHits) {
        const base = scores.get(hit.blockId) ?? 0;
        scores.set(hit.blockId, base + hit.score * this.config.graphWeight);
      }
    }

    return {
      scores,
      semanticSeedIds,
      graphHitIds,
      graphHitConfidenceAvg
    };
  }
}
