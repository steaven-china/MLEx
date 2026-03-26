import type { BlockId, MemoryEvent } from "../../types.js";
import type { SQLiteDatabase } from "../sqlite/SQLiteDatabase.js";
import type { IRawEventStore } from "./IRawEventStore.js";

type RawEventRow = {
  block_id: string;
  events_json: string;
};

export class SQLiteRawEventStore implements IRawEventStore {
  constructor(private readonly sqlite: SQLiteDatabase) {}

  put(blockId: BlockId, events: MemoryEvent[]): void {
    const statement = this.sqlite.handle.prepare(`
      INSERT INTO raw_events (block_id, events_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(block_id) DO UPDATE SET
        events_json=excluded.events_json,
        updated_at=excluded.updated_at
    `);
    statement.run(blockId, JSON.stringify(events), Date.now());
  }

  get(blockId: BlockId): MemoryEvent[] | undefined {
    const statement = this.sqlite.handle.prepare(`
      SELECT block_id, events_json FROM raw_events WHERE block_id = ?
    `);
    const row = statement.get(blockId) as RawEventRow | undefined;
    if (!row) return undefined;
    return parseJson<MemoryEvent[]>(row.events_json, []);
  }

  remove(blockId: BlockId): void {
    const statement = this.sqlite.handle.prepare(`DELETE FROM raw_events WHERE block_id = ?`);
    statement.run(blockId);
  }

  listBlockIds(): BlockId[] {
    const statement = this.sqlite.handle.prepare(`SELECT block_id FROM raw_events ORDER BY block_id ASC`);
    const rows = statement.all() as Array<{ block_id: string }>;
    return rows.map((row) => row.block_id);
  }
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
