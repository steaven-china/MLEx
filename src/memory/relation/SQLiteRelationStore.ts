import type { BlockId } from "../../types.js";
import type { SQLiteDatabase } from "../sqlite/SQLiteDatabase.js";
import type { IRelationStore, StoredRelation } from "./IRelationStore.js";

type RelationRow = {
  src: string;
  dst: string;
  type: StoredRelation["type"];
  timestamp: number;
  confidence: number | null;
};

export class SQLiteRelationStore implements IRelationStore {
  constructor(private readonly sqlite: SQLiteDatabase) {}

  add(relation: StoredRelation): void {
    const statement = this.sqlite.handle.prepare(`
      INSERT INTO relations (src, dst, type, timestamp, confidence)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(src, dst, type) DO UPDATE SET
        timestamp=excluded.timestamp,
        confidence=excluded.confidence
    `);
    statement.run(
      relation.src,
      relation.dst,
      relation.type,
      relation.timestamp,
      relation.confidence ?? null
    );
  }

  listOutgoing(src: BlockId): StoredRelation[] {
    const statement = this.sqlite.handle.prepare(`
      SELECT src, dst, type, timestamp, confidence
      FROM relations WHERE src = ?
      ORDER BY timestamp DESC
    `);
    const rows = statement.all(src) as RelationRow[];
    return rows.map(toStoredRelation);
  }

  listIncoming(dst: BlockId): StoredRelation[] {
    const statement = this.sqlite.handle.prepare(`
      SELECT src, dst, type, timestamp, confidence
      FROM relations WHERE dst = ?
      ORDER BY timestamp DESC
    `);
    const rows = statement.all(dst) as RelationRow[];
    return rows.map(toStoredRelation);
  }

  listAll(): StoredRelation[] {
    const statement = this.sqlite.handle.prepare(`
      SELECT src, dst, type, timestamp, confidence
      FROM relations ORDER BY timestamp ASC
    `);
    const rows = statement.all() as RelationRow[];
    return rows.map(toStoredRelation);
  }
}

function toStoredRelation(row: RelationRow): StoredRelation {
  return {
    src: row.src,
    dst: row.dst,
    type: row.type,
    timestamp: row.timestamp,
    confidence: row.confidence ?? undefined
  };
}
