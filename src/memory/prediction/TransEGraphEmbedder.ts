import { RelationType, type RelationLabel } from "../../types.js";
import type { RelationGraph } from "../RelationGraph.js";
import type { MemoryBlock } from "../MemoryBlock.js";
import type { GraphEmbeddingResult, IGraphEmbedder } from "./GraphEmbedder.js";

export interface TransEGraphEmbedderConfig {
  selfWeight: number;
  translatedWeight: number;
}

export class TransEGraphEmbedder implements IGraphEmbedder {
  constructor(
    private readonly config: TransEGraphEmbedderConfig = {
      selfWeight: 0.6,
      translatedWeight: 0.4
    }
  ) {}

  train(blocks: MemoryBlock[], graph: RelationGraph): GraphEmbeddingResult {
    const dimension = resolveDimension(blocks);
    const blockById = new Map(blocks.map((block) => [block.id, block]));
    const nodeEmbeddings = new Map<string, number[]>();

    for (const block of blocks) {
      const self = fitVector(block.embedding, dimension);
      const translatedCandidates: number[][] = [];

      for (const edge of graph.getOutgoingTyped(block.id)) {
        const neighbor = blockById.get(edge.blockId);
        if (!neighbor) continue;
        const relationVector = relationTypeVector(edge.type, dimension);
        const neighborVector = fitVector(neighbor.embedding, dimension);
        translatedCandidates.push(subtract(neighborVector, relationVector));
      }

      for (const edge of graph.getIncomingTyped(block.id)) {
        const neighbor = blockById.get(edge.blockId);
        if (!neighbor) continue;
        const relationVector = relationTypeVector(edge.type, dimension);
        const neighborVector = fitVector(neighbor.embedding, dimension);
        translatedCandidates.push(add(neighborVector, relationVector));
      }

      const translatedMean =
        translatedCandidates.length > 0
          ? meanVector(translatedCandidates, dimension)
          : new Array(dimension).fill(0);
      const merged = new Array(dimension).fill(0).map((_, index) => {
        return (
          self[index] * this.config.selfWeight +
          translatedMean[index] * this.config.translatedWeight
        );
      });

      nodeEmbeddings.set(block.id, normalize(merged));
    }

    return {
      dimension,
      nodeEmbeddings
    };
  }
}

function relationTypeVector(type: RelationLabel, dimension: number): number[] {
  const seed = relationTypeSeed(type);
  const vector = new Array(dimension).fill(0);
  for (let index = 0; index < dimension; index += 1) {
    const value = Math.sin((seed * (index + 1)) / 17) * 0.1;
    vector[index] = value;
  }
  return normalize(vector);
}

function relationTypeSeed(type: RelationLabel): number {
  const knownSeed = Object.values(RelationType).indexOf(type as RelationType) + 1;
  if (knownSeed > 0) return knownSeed;
  const raw = String(type);
  if (raw.length === 0) return 1;
  let hash = 0;
  for (let index = 0; index < raw.length; index += 1) {
    hash = (hash * 31 + raw.charCodeAt(index)) >>> 0;
  }
  return (hash % 10_000) + 1;
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

function add(left: number[], right: number[]): number[] {
  return left.map((value, index) => value + (right[index] ?? 0));
}

function subtract(left: number[], right: number[]): number[] {
  return left.map((value, index) => value - (right[index] ?? 0));
}
