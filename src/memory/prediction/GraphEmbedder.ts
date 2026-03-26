import type { RelationGraph } from "../RelationGraph.js";
import type { MemoryBlock } from "../MemoryBlock.js";

export interface GraphEmbeddingResult {
  dimension: number;
  nodeEmbeddings: Map<string, number[]>;
}

export interface IGraphEmbedder {
  train(blocks: MemoryBlock[], graph: RelationGraph): GraphEmbeddingResult;
}

export interface GraphEmbedderConfig {
  selfWeight: number;
  neighborWeight: number;
}

export class GraphEmbedder implements IGraphEmbedder {
  constructor(private readonly config: GraphEmbedderConfig = { selfWeight: 0.65, neighborWeight: 0.35 }) {}

  train(blocks: MemoryBlock[], graph: RelationGraph): GraphEmbeddingResult {
    const dimension = resolveDimension(blocks);
    const blockById = new Map(blocks.map((block) => [block.id, block]));
    const nodeEmbeddings = new Map<string, number[]>();

    for (const block of blocks) {
      const base = fitVector(block.embedding, dimension);
      const neighbors = new Set<string>();
      for (const id of graph.getOutgoing(block.id)) neighbors.add(id);
      for (const id of graph.getIncoming(block.id)) neighbors.add(id);

      const neighborVectors: number[][] = [];
      for (const neighborId of neighbors) {
        const neighbor = blockById.get(neighborId);
        if (!neighbor) continue;
        neighborVectors.push(fitVector(neighbor.embedding, dimension));
      }

      const neighborMean =
        neighborVectors.length > 0 ? meanVector(neighborVectors, dimension) : new Array(dimension).fill(0);
      const merged = new Array(dimension).fill(0).map((_, index) => {
        return (
          base[index] * this.config.selfWeight +
          neighborMean[index] * this.config.neighborWeight
        );
      });
      nodeEmbeddings.set(block.id, normalize(merged));
    }

    return { dimension, nodeEmbeddings };
  }
}

function resolveDimension(blocks: MemoryBlock[]): number {
  for (const block of blocks) {
    if (block.embedding.length > 0) return block.embedding.length;
  }
  return 256;
}

function fitVector(vector: number[], dimension: number): number[] {
  if (vector.length === dimension) return [...vector];
  const output = new Array(dimension).fill(0);
  for (let index = 0; index < Math.min(vector.length, dimension); index += 1) {
    output[index] = vector[index];
  }
  return output;
}

function meanVector(vectors: number[][], dimension: number): number[] {
  const output = new Array(dimension).fill(0);
  for (const vector of vectors) {
    for (let index = 0; index < dimension; index += 1) {
      output[index] += vector[index] ?? 0;
    }
  }
  return output.map((value) => value / vectors.length);
}

function normalize(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) return vector;
  return vector.map((value) => value / norm);
}
