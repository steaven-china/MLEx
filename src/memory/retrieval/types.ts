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
  /**
   * Relation types to filter graph traversal.
   * - `undefined` (default): uses the retriever's built-in default types (CONTEXT, FOLLOWS).
   * - `[]` (empty array): **no filter — all relation types are traversed**.
   * - Non-empty array: only the listed types are traversed.
   */
  relationTypes?: RelationType[];
  depth?: number;
}

export interface RetrievalHit {
  blockId: string;
  score: number;
  source: RetrievalSource;
  block?: MemoryBlock;
}
