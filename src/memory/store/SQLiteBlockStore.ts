import { MemoryBlock } from "../MemoryBlock.js";
import type { IBlockStore } from "./IBlockStore.js";
import type { SQLiteDatabase } from "../sqlite/SQLiteDatabase.js";

type Row = {
  id: string;
  start_time: number;
  end_time: number;
  token_count: number;
  summary: string;
  keywords_json: string;
  embedding_json: string;
  raw_events_json: string;
  retention_mode: MemoryBlock["retentionMode"];
  match_score: number;
  conflict: number;
};

export class SQLiteBlockStore implements IBlockStore {
  constructor(private readonly sqlite: SQLiteDatabase) {}

  upsert(block: MemoryBlock): void {
    const statement = this.sqlite.handle.prepare(`
      INSERT INTO blocks (
        id, start_time, end_time, token_count, summary,
        keywords_json, embedding_json, raw_events_json,
        retention_mode, match_score, conflict
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        start_time=excluded.start_time,
        end_time=excluded.end_time,
        token_count=excluded.token_count,
        summary=excluded.summary,
        keywords_json=excluded.keywords_json,
        embedding_json=excluded.embedding_json,
        raw_events_json=excluded.raw_events_json,
        retention_mode=excluded.retention_mode,
        match_score=excluded.match_score,
        conflict=excluded.conflict
    `);
    statement.run(
      block.id,
      block.startTime,
      block.endTime,
      block.tokenCount,
      block.summary,
      JSON.stringify(block.keywords),
      JSON.stringify(block.embedding),
      JSON.stringify(block.rawEvents),
      block.retentionMode,
      block.matchScore,
      block.conflict ? 1 : 0
    );
  }

  get(blockId: string): MemoryBlock | undefined {
    const statement = this.sqlite.handle.prepare(`
      SELECT
        id, start_time, end_time, token_count, summary,
        keywords_json, embedding_json, raw_events_json,
        retention_mode, match_score, conflict
      FROM blocks WHERE id = ?
    `);
    const row = statement.get(blockId) as Row | undefined;
    return row ? toMemoryBlock(row) : undefined;
  }

  getMany(blockIds: string[]): MemoryBlock[] {
    if (blockIds.length === 0) return [];

    const uniqueIds = [...new Set(blockIds)];
    const placeholders = uniqueIds.map(() => "?").join(", ");
    const statement = this.sqlite.handle.prepare(`
      SELECT
        id, start_time, end_time, token_count, summary,
        keywords_json, embedding_json, raw_events_json,
        retention_mode, match_score, conflict
      FROM blocks
      WHERE id IN (${placeholders})
    `);
    const rows = statement.all(...uniqueIds) as Row[];
    const byId = new Map(rows.map((row) => {
      const block = toMemoryBlock(row);
      return [block.id, block];
    }));

    return blockIds
      .map((blockId) => byId.get(blockId))
      .filter((item): item is MemoryBlock => Boolean(item));
  }

  list(): MemoryBlock[] {
    const statement = this.sqlite.handle.prepare(`
      SELECT
        id, start_time, end_time, token_count, summary,
        keywords_json, embedding_json, raw_events_json,
        retention_mode, match_score, conflict
      FROM blocks ORDER BY start_time ASC
    `);
    const rows = statement.all() as Row[];
    return rows.map(toMemoryBlock);
  }
}

function toMemoryBlock(row: Row): MemoryBlock {
  const block = new MemoryBlock(row.id, row.start_time);
  block.endTime = row.end_time;
  block.tokenCount = row.token_count;
  block.summary = row.summary;
  block.keywords = parseJson<string[]>(row.keywords_json, []);
  block.embedding = parseJson<number[]>(row.embedding_json, []);
  block.rawEvents = parseJson(row.raw_events_json, []);
  block.retentionMode = row.retention_mode ?? "raw";
  block.matchScore = typeof row.match_score === "number" ? row.match_score : 0;
  block.conflict = row.conflict === 1;
  return block;
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
