import { MemoryBlock } from "../MemoryBlock.js";
import type { IBlockStore } from "./IBlockStore.js";
import { SQLiteWorkerClient } from "../sqlite-worker/SQLiteWorkerClient.js";
import type { MemoryEvent } from "../../types.js";

interface BlockShape {
  id: string;
  startTime: number;
  endTime: number;
  tokenCount: number;
  summary: string;
  keywords: string[];
  embedding: number[];
  rawEvents: MemoryEvent[];
  retentionMode: "compressed" | "raw" | "conflict";
  matchScore: number;
  conflict: boolean;
  tags: string[];
}

export class SQLiteWorkerBlockStore implements IBlockStore {
  constructor(private readonly worker: SQLiteWorkerClient) {}

  async upsert(block: MemoryBlock): Promise<void> {
    await this.worker.request("block.upsert", toBlockShape(block));
  }

  async get(blockId: string): Promise<MemoryBlock | undefined> {
    const result = await this.worker.request<BlockShape | undefined>("block.get", blockId);
    return result ? toMemoryBlock(result) : undefined;
  }

  async getMany(blockIds: string[]): Promise<MemoryBlock[]> {
    const rows = await this.worker.request<BlockShape[]>("block.getMany", blockIds);
    return rows.map((row) => toMemoryBlock(row));
  }

  async list(): Promise<MemoryBlock[]> {
    const rows = await this.worker.request<BlockShape[]>("block.list");
    return rows.map((row) => toMemoryBlock(row));
  }
}

function toMemoryBlock(input: BlockShape): MemoryBlock {
  const block = new MemoryBlock(input.id, input.startTime);
  block.endTime = input.endTime;
  block.tokenCount = input.tokenCount;
  block.summary = input.summary;
  block.keywords = input.keywords;
  block.embedding = input.embedding;
  block.rawEvents = input.rawEvents;
  block.retentionMode = input.retentionMode;
  block.matchScore = input.matchScore;
  block.conflict = input.conflict;
  block.tags = input.tags;
  return block;
}

function toBlockShape(block: MemoryBlock): BlockShape {
  return {
    id: block.id,
    startTime: block.startTime,
    endTime: block.endTime,
    tokenCount: block.tokenCount,
    summary: block.summary,
    keywords: block.keywords,
    embedding: block.embedding,
    rawEvents: block.rawEvents,
    retentionMode: block.retentionMode,
    matchScore: block.matchScore,
    conflict: block.conflict,
    tags: block.tags
  };
}
