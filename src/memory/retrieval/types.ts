import type { RelationType, TraverseDirection } from "../../types.js";
import type { MemoryBlock } from "../MemoryBlock.js";

export type RetrievalSource = "keyword" | "vector" | "graph";

export interface RetrievalInput {
  query: string;
  keywords: string[];
  embedding: number[];
  topK: number;
  seedBlockIds?: string[];
  direction?: TraverseDirection;
  relationTypes?: RelationType[];
  depth?: number;
}

export interface RetrievalHit {
  blockId: string;
  score: number;
  source: RetrievalSource;
  block?: MemoryBlock;
}
