import type { BlockId } from "../../types.js";
import type { RelationGraph } from "../RelationGraph.js";

export interface RandomWalkConfig {
  depth: number;
  transitionDecay: number;
}

export class WeightedRandomWalk {
  constructor(private readonly config: RandomWalkConfig) {}

  walk(seedIds: BlockId[], graph: RelationGraph): Map<BlockId, number> {
    const seeds = [...new Set(seedIds)];
    if (seeds.length === 0) return new Map();

    let frontier = new Map<BlockId, number>();
    for (const seed of seeds) {
      frontier.set(seed, 1 / seeds.length);
    }

    const accumulated = new Map<BlockId, number>();

    for (let step = 1; step <= this.config.depth; step += 1) {
      const nextFrontier = new Map<BlockId, number>();
      for (const [nodeId, probability] of frontier.entries()) {
        const outgoing = [...graph.getOutgoing(nodeId)];
        if (outgoing.length === 0) continue;
        const share = (probability / outgoing.length) * Math.pow(this.config.transitionDecay, step - 1);
        for (const neighbor of outgoing) {
          nextFrontier.set(neighbor, (nextFrontier.get(neighbor) ?? 0) + share);
          accumulated.set(neighbor, (accumulated.get(neighbor) ?? 0) + share);
        }
      }
      frontier = nextFrontier;
      if (frontier.size === 0) break;
    }

    const total = [...accumulated.values()].reduce((sum, value) => sum + value, 0);
    if (total === 0) return accumulated;

    const normalized = new Map<BlockId, number>();
    for (const [blockId, probability] of accumulated.entries()) {
      normalized.set(blockId, probability / total);
    }
    return normalized;
  }
}
