import { parentPort, workerData } from "node:worker_threads";
import type { StatementSync } from "node:sqlite";

import type { SQLiteDatabase as SQLiteDatabaseType } from "../sqlite/SQLiteDatabase.js";
import type { MemoryEvent, RetentionMode } from "../../types.js";
import type { StoredRelation } from "../relation/IRelationStore.js";
import type {
  SQLiteWorkerInitMessage,
  SQLiteWorkerRequestMessage,
  SQLiteWorkerResponseMessage
} from "./protocol.js";

interface BlockShape {
  id: string;
  startTime: number;
  endTime: number;
  tokenCount: number;
  summary: string;
  keywords: string[];
  embedding: number[];
  rawEvents: MemoryEvent[];
  retentionMode: RetentionMode;
  matchScore: number;
  conflict: boolean;
  tags: string[];
}

type BlockRow = {
  id: string;
  start_time: number;
  end_time: number;
  token_count: number;
  summary: string;
  keywords_json: string;
  embedding_json: string;
  raw_events_json: string;
  retention_mode: RetentionMode;
  match_score: number;
  conflict: number;
  tags_json: string;
};

type RawEventRow = {
  events_json: string;
};

type RelationRow = {
  src: string;
  dst: string;
  type: StoredRelation["type"];
  timestamp: number;
  confidence: number | null;
};

type BlockStatements = {
  upsert: StatementSync;
  get: StatementSync;
  list: StatementSync;
  getMany: (arity: number) => StatementSync;
};

type RawStatements = {
  put: StatementSync;
  get: StatementSync;
  remove: StatementSync;
  listBlockIds: StatementSync;
};

type RelationStatements = {
  add: StatementSync;
  listOutgoing: StatementSync;
  listIncoming: StatementSync;
  listAll: StatementSync;
};

type RuntimeState = {
  sqlite: SQLiteDatabaseType;
  allowedAiTags: string[];
  blockStatements: BlockStatements;
  rawStatements: RawStatements;
  relationStatements: RelationStatements;
};

const port = parentPort;
if (!port) {
  throw new Error("SQLite worker must run in worker thread context");
}
const workerPort = port;

const init = workerData as SQLiteWorkerInitMessage;
let runtimeState: RuntimeState | undefined;

void initializeWorker();

async function initializeWorker(): Promise<void> {
  try {
    runtimeState = await createRuntime(init);
    workerPort.postMessage({ type: "ready" });

    workerPort.on("message", (message: SQLiteWorkerRequestMessage) => {
      void handleRequest(message);
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    workerPort.postMessage({
      type: "fatal",
      error: {
        code: "SQLITE_WORKER_INIT_FAILED",
        message: err.message
      }
    });
  }
}

async function createRuntime(initMessage: SQLiteWorkerInitMessage): Promise<RuntimeState> {
  const ext = import.meta.url.endsWith(".ts") ? ".ts" : ".js";
  const toModulePath = (modulePath: string) => modulePath.replace(/\.js$/, ext);
  const { SQLiteDatabase } = await import(toModulePath("../sqlite/SQLiteDatabase.js"));

  const sqlite = new SQLiteDatabase({ filePath: initMessage.filePath });
  const allowedAiTags = normalizeAllowedAiTags(initMessage.allowedAiTags);

  return {
    sqlite,
    allowedAiTags,
    blockStatements: createBlockStatements(sqlite),
    rawStatements: createRawStatements(sqlite),
    relationStatements: createRelationStatements(sqlite)
  };
}

function requireRuntime(): RuntimeState {
  if (!runtimeState) {
    throw new Error("SQLite worker is not initialized");
  }
  return runtimeState;
}

async function handleRequest(message: SQLiteWorkerRequestMessage): Promise<void> {
  if (message.type !== "request") return;

  const responseBase = {
    type: "response" as const,
    requestId: message.requestId
  };

  try {
    const payload = executeOperation(message.op, message.payload);
    const response: SQLiteWorkerResponseMessage = {
      ...responseBase,
      ok: true,
      payload
    };
    workerPort.postMessage(response);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    const response: SQLiteWorkerResponseMessage = {
      ...responseBase,
      ok: false,
      error: {
        code: "SQLITE_WORKER_OP_FAILED",
        message: err.message
      }
    };
    workerPort.postMessage(response);
  }
}

function executeOperation(op: SQLiteWorkerRequestMessage["op"], payload: unknown): unknown {
  const runtime = requireRuntime();

  switch (op) {
    case "block.upsert": {
      const input = payload as BlockShape;
      runtime.blockStatements.upsert.run(
        input.id,
        input.startTime,
        input.endTime,
        input.tokenCount,
        input.summary,
        JSON.stringify(Array.isArray(input.keywords) ? input.keywords : []),
        JSON.stringify(Array.isArray(input.embedding) ? input.embedding : []),
        JSON.stringify(Array.isArray(input.rawEvents) ? input.rawEvents : []),
        input.retentionMode ?? "raw",
        input.matchScore ?? 0,
        input.conflict ? 1 : 0,
        JSON.stringify(normalizeBlockTags(input.tags, runtime.allowedAiTags))
      );
      return { ok: true };
    }
    case "block.get": {
      const row = runtime.blockStatements.get.get(String(payload ?? "")) as BlockRow | undefined;
      return row ? toBlockShape(row, runtime.allowedAiTags) : undefined;
    }
    case "block.getMany": {
      const blockIds = Array.isArray(payload) ? payload.map((item) => String(item)) : [];
      if (blockIds.length === 0) return [];

      const uniqueIds = [...new Set(blockIds)];
      const statement = runtime.blockStatements.getMany(uniqueIds.length);
      const rows = statement.all(...uniqueIds) as BlockRow[];
      const byId = new Map(rows.map((row) => [row.id, toBlockShape(row, runtime.allowedAiTags)]));
      return blockIds.map((blockId) => byId.get(blockId)).filter((item): item is BlockShape => Boolean(item));
    }
    case "block.list": {
      const rows = runtime.blockStatements.list.all() as BlockRow[];
      return rows.map((row) => toBlockShape(row, runtime.allowedAiTags));
    }
    case "raw.put": {
      const input = payload as { blockId: string; events: MemoryEvent[] };
      runtime.rawStatements.put.run(input.blockId, JSON.stringify(input.events ?? []), Date.now());
      return { ok: true };
    }
    case "raw.get": {
      const row = runtime.rawStatements.get.get(String(payload ?? "")) as RawEventRow | undefined;
      if (!row) return undefined;
      return parseJson<MemoryEvent[]>(row.events_json, []);
    }
    case "raw.remove": {
      runtime.rawStatements.remove.run(String(payload ?? ""));
      return { ok: true };
    }
    case "raw.listBlockIds": {
      const rows = runtime.rawStatements.listBlockIds.all() as Array<{ block_id: string }>;
      return rows.map((row) => row.block_id);
    }
    case "relation.add": {
      const relation = payload as StoredRelation;
      runtime.relationStatements.add.run(
        relation.src,
        relation.dst,
        relation.type,
        relation.timestamp,
        relation.confidence ?? null
      );
      return { ok: true };
    }
    case "relation.listOutgoing": {
      const rows = runtime.relationStatements.listOutgoing.all(String(payload ?? "")) as RelationRow[];
      return rows.map(toStoredRelation);
    }
    case "relation.listIncoming": {
      const rows = runtime.relationStatements.listIncoming.all(String(payload ?? "")) as RelationRow[];
      return rows.map(toStoredRelation);
    }
    case "relation.listAll": {
      const rows = runtime.relationStatements.listAll.all() as RelationRow[];
      return rows.map(toStoredRelation);
    }
    case "meta.close": {
      runtime.sqlite.close();
      runtimeState = undefined;
      return { closed: true };
    }
    default:
      throw new Error(`Unsupported SQLite worker op: ${op as string}`);
  }
}

function createBlockStatements(sqlite: SQLiteDatabaseType): BlockStatements {
  const upsert = sqlite.handle.prepare(`
    INSERT INTO blocks (
      id, start_time, end_time, token_count, summary,
      keywords_json, embedding_json, raw_events_json,
      retention_mode, match_score, conflict, tags_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      conflict=excluded.conflict,
      tags_json=excluded.tags_json
  `);
  const get = sqlite.handle.prepare(`
    SELECT
      id, start_time, end_time, token_count, summary,
      keywords_json, embedding_json, raw_events_json,
      retention_mode, match_score, conflict, tags_json
    FROM blocks WHERE id = ?
  `);
  const list = sqlite.handle.prepare(`
    SELECT
      id, start_time, end_time, token_count, summary,
      keywords_json, embedding_json, raw_events_json,
      retention_mode, match_score, conflict, tags_json
    FROM blocks ORDER BY start_time ASC
  `);

  const getManyStatements = new Map<number, StatementSync>();
  const getMany = (arity: number): StatementSync => {
    const cached = getManyStatements.get(arity);
    if (cached) return cached;

    const placeholders = new Array(arity).fill("?").join(", ");
    const statement = sqlite.handle.prepare(`
      SELECT
        id, start_time, end_time, token_count, summary,
        keywords_json, embedding_json, raw_events_json,
        retention_mode, match_score, conflict, tags_json
      FROM blocks
      WHERE id IN (${placeholders})
    `);
    getManyStatements.set(arity, statement);
    return statement;
  };

  return { upsert, get, list, getMany };
}

function createRawStatements(sqlite: SQLiteDatabaseType): RawStatements {
  return {
    put: sqlite.handle.prepare(`
      INSERT INTO raw_events (block_id, events_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(block_id) DO UPDATE SET
        events_json=excluded.events_json,
        updated_at=excluded.updated_at
    `),
    get: sqlite.handle.prepare(`SELECT events_json FROM raw_events WHERE block_id = ?`),
    remove: sqlite.handle.prepare(`DELETE FROM raw_events WHERE block_id = ?`),
    listBlockIds: sqlite.handle.prepare(`SELECT block_id FROM raw_events ORDER BY block_id ASC`)
  };
}

function createRelationStatements(sqlite: SQLiteDatabaseType): RelationStatements {
  return {
    add: sqlite.handle.prepare(`
      INSERT INTO relations (src, dst, type, timestamp, confidence)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(src, dst, type) DO UPDATE SET
        timestamp=excluded.timestamp,
        confidence=excluded.confidence
    `),
    listOutgoing: sqlite.handle.prepare(`
      SELECT src, dst, type, timestamp, confidence
      FROM relations WHERE src = ?
      ORDER BY timestamp DESC
    `),
    listIncoming: sqlite.handle.prepare(`
      SELECT src, dst, type, timestamp, confidence
      FROM relations WHERE dst = ?
      ORDER BY timestamp DESC
    `),
    listAll: sqlite.handle.prepare(`
      SELECT src, dst, type, timestamp, confidence
      FROM relations ORDER BY timestamp ASC
    `)
  };
}

function toBlockShape(row: BlockRow, allowedAiTags: string[]): BlockShape {
  return {
    id: row.id,
    startTime: row.start_time,
    endTime: row.end_time,
    tokenCount: row.token_count,
    summary: row.summary,
    keywords: parseJson<string[]>(row.keywords_json, []),
    embedding: parseJson<number[]>(row.embedding_json, []),
    rawEvents: parseJson<MemoryEvent[]>(row.raw_events_json, []),
    retentionMode: row.retention_mode ?? "raw",
    matchScore: typeof row.match_score === "number" ? row.match_score : 0,
    conflict: row.conflict === 1,
    tags: normalizeBlockTags(parseJson<string[]>(row.tags_json, ["normal"]), allowedAiTags)
  };
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

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function normalizeAllowedAiTags(tags: readonly string[] | undefined): string[] {
  const normalized = (tags ?? ["important", "normal"])
    .map((tag) => tag.trim().toLowerCase())
    .filter((tag): tag is string => tag.length > 0);
  const deduped = [...new Set(normalized)];
  return deduped.length > 0 ? deduped : ["normal"];
}

function normalizeBlockTags(tags: unknown, allowedTags: readonly string[]): string[] {
  const allowed = new Set(allowedTags);
  const output: string[] = [];

  if (Array.isArray(tags)) {
    for (const rawTag of tags) {
      if (typeof rawTag !== "string") continue;
      const tag = rawTag.trim().toLowerCase();
      if (!tag || !allowed.has(tag) || output.includes(tag)) continue;
      output.push(tag);
    }
  }

  if (output.length > 0) return output;
  if (allowed.has("normal")) return ["normal"];
  const first = allowed.values().next().value;
  return typeof first === "string" && first.length > 0 ? [first] : ["normal"];
}
