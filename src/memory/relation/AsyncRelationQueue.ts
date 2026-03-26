import type { RelationGraph } from "../RelationGraph.js";
import type { MemoryBlock } from "../MemoryBlock.js";
import type { IRelationExtractor } from "./RelationExtractor.js";
import type { ExtractedRelation } from "./RelationExtractor.js";
import type { IRelationStore } from "./IRelationStore.js";

export interface AsyncRelationQueueOptions {
  maxNeighbors: number;
  relationStore?: IRelationStore;
  relationTimestampResolver?: (block: MemoryBlock, relation: ExtractedRelation) => number;
  onError?: (error: unknown) => void;
}

export class AsyncRelationQueue {
  private readonly queue: MemoryBlock[] = [];
  private running = false;
  private processingPromise?: Promise<void>;
  private drainResolvers: Array<() => void> = [];

  constructor(
    private readonly extractor: IRelationExtractor,
    private readonly graph: RelationGraph,
    private readonly getNeighbors: (block: MemoryBlock, limit: number) => Promise<MemoryBlock[]>,
    private readonly options: AsyncRelationQueueOptions
  ) {}

  enqueue(block: MemoryBlock): void {
    this.queue.push(block);
    void this.process();
  }

  async drain(): Promise<void> {
    if (!this.running && this.queue.length === 0) {
      return;
    }
    await new Promise<void>((resolve) => {
      this.drainResolvers.push(resolve);
    });
  }

  private async process(): Promise<void> {
    if (this.processingPromise) return;

    this.processingPromise = (async () => {
      if (this.running) return;
      this.running = true;

      while (this.queue.length > 0) {
        const block = this.queue.shift();
        if (!block) continue;
        try {
          const neighbors = await this.getNeighbors(block, this.options.maxNeighbors);
          const relations = await this.extractor.extract(block, neighbors);
          for (const relation of relations) {
            this.graph.addRelation(relation.src, relation.dst, relation.type);
            const timestamp =
              this.options.relationTimestampResolver?.(block, relation) ?? Date.now();
            await this.options.relationStore?.add({
              src: relation.src,
              dst: relation.dst,
              type: relation.type,
              confidence: relation.confidence,
              timestamp
            });
          }
        } catch (error) {
          this.options.onError?.(error);
        }
      }

      this.running = false;
      this.resolveDrainIfIdle();
    })()
      .finally(() => {
        this.processingPromise = undefined;
        if (this.queue.length > 0) {
          void this.process();
        } else {
          this.resolveDrainIfIdle();
        }
      });

    await this.processingPromise;
  }

  private resolveDrainIfIdle(): void {
    if (this.running || this.queue.length > 0) return;
    if (this.drainResolvers.length === 0) return;
    const resolvers = [...this.drainResolvers];
    this.drainResolvers = [];
    for (const resolve of resolvers) {
      resolve();
    }
  }
}
