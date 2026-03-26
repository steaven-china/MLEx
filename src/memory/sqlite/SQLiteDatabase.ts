import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import type { DatabaseSync } from "node:sqlite";

export interface SQLiteDatabaseConfig {
  filePath: string;
}

export class SQLiteDatabase {
  private readonly db: DatabaseSync;

  constructor(config: SQLiteDatabaseConfig) {
    const filePath = normalizeFilePath(config.filePath);
    if (filePath !== ":memory:") {
      mkdirSync(dirname(filePath), { recursive: true });
    }
    const DatabaseSyncCtor = loadDatabaseSync();
    this.db = new DatabaseSyncCtor(filePath);
    this.initialize();
  }

  get handle(): DatabaseSync {
    return this.db;
  }

  close(): void {
    this.db.close();
  }

  private initialize(): void {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS blocks (
        id TEXT PRIMARY KEY,
        start_time INTEGER NOT NULL,
        end_time INTEGER NOT NULL,
        token_count INTEGER NOT NULL,
        summary TEXT NOT NULL,
        keywords_json TEXT NOT NULL,
        embedding_json TEXT NOT NULL,
        raw_events_json TEXT NOT NULL,
        retention_mode TEXT NOT NULL,
        match_score REAL NOT NULL,
        conflict INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS raw_events (
        block_id TEXT PRIMARY KEY,
        events_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS relations (
        src TEXT NOT NULL,
        dst TEXT NOT NULL,
        type TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        confidence REAL,
        PRIMARY KEY (src, dst, type)
      );

      CREATE INDEX IF NOT EXISTS idx_blocks_start_time ON blocks(start_time);
      CREATE INDEX IF NOT EXISTS idx_blocks_end_time ON blocks(end_time);
      CREATE INDEX IF NOT EXISTS idx_raw_events_updated_at ON raw_events(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_relations_src_timestamp ON relations(src, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_relations_dst_timestamp ON relations(dst, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_relations_type_timestamp ON relations(type, timestamp DESC);
    `);
  }
}

function loadDatabaseSync(): new (location: string) => DatabaseSync {
  const require = createRequire(import.meta.url);
  try {
    const loaded = require("node:sqlite") as { DatabaseSync?: new (location: string) => DatabaseSync };
    if (!loaded.DatabaseSync) {
      throw new Error("DatabaseSync export is unavailable from node:sqlite");
    }
    return loaded.DatabaseSync;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `SQLite backend requires Node.js runtime support for node:sqlite. Current load failed: ${message}`
    );
  }
}

function normalizeFilePath(filePath: string): string {
  const trimmed = filePath.trim();
  return trimmed.length > 0 ? trimmed : ":memory:";
}
