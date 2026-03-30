import { strict as assert } from "node:assert";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { MemoryBlock } from "../memory/MemoryBlock.js";
import { SQLiteRawEventStore } from "../memory/raw/SQLiteRawEventStore.js";
import { SQLiteDatabase } from "../memory/sqlite/SQLiteDatabase.js";
import { SQLiteBlockStore } from "../memory/store/SQLiteBlockStore.js";
import type { MemoryEvent } from "../types.js";

interface BenchmarkOptions {
  totalRecords: number;
  mixedOps: number;
  readPercent: number;
  batchSize: number;
  seed: number;
  silent?: boolean;
}

interface PhaseSummary {
  phase: string;
  ops: number;
  success: number;
  errors: number;
  errorRate: number;
  durationMs: number;
  throughputPerSec: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
  latencyP99Ms: number;
  readOps?: number;
  writeOps?: number;
  readP95Ms?: number;
  writeP95Ms?: number;
  readMiss?: number;
  readMissRate?: number;
}

export interface BenchmarkResult {
  runDir: string;
  sqliteFile: string;
  csvFile: string;
  write: PhaseSummary;
  mixed: PhaseSummary;
}

function withDefaults(input: Partial<BenchmarkOptions> = {}): BenchmarkOptions {
  return {
    totalRecords: input.totalRecords ?? 1_000_000,
    mixedOps: input.mixedOps ?? 200_000,
    readPercent: input.readPercent ?? 80,
    batchSize: input.batchSize ?? 1_000,
    seed: input.seed ?? 42,
    silent: input.silent ?? false
  };
}

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * ratio)));
  return sorted[index] ?? 0;
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : "0.00";
}

function blockIdFor(index: number): string {
  return `bench-block-${index}`;
}

function buildRecord(index: number, seed: number): { block: MemoryBlock; events: MemoryEvent[] } {
  const now = Date.now() + index;
  const event: MemoryEvent = {
    id: `bench-event-${index}`,
    role: "user",
    text: `benchmark payload index=${index} seed=${seed} key=${index % 97}`,
    timestamp: now
  };

  const block = new MemoryBlock(blockIdFor(index), now);
  block.endTime = now + 1;
  block.summary = `summary-${index}`;
  block.tokenCount = 12;
  block.keywords = ["benchmark", `k${index % 13}`, `seed${seed % 11}`];
  block.embedding = [seed % 1000, index % 1000, (index * 7) % 997].map((v) => v / 1000);
  block.rawEvents = [event];
  block.retentionMode = "raw";
  block.matchScore = 1;
  block.conflict = false;
  block.tags = ["normal"];

  return { block, events: [event] };
}

async function createRunDir(): Promise<{ runDir: string; sqliteFile: string; csvFile: string }> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = resolve(process.cwd(), ".mlex", "bench", "sqlite", timestamp);
  await mkdir(runDir, { recursive: true });
  return {
    runDir,
    sqliteFile: join(runDir, "memory.db"),
    csvFile: join(runDir, "sqlite-benchmark.csv")
  };
}

function summarizePhase(
  phase: string,
  ops: number,
  success: number,
  errors: number,
  durationMs: number,
  latencies: number[],
  extra: Partial<PhaseSummary> = {}
): PhaseSummary {
  const safeDuration = Math.max(durationMs, 1);
  return {
    phase,
    ops,
    success,
    errors,
    errorRate: ops > 0 ? errors / ops : 0,
    durationMs,
    throughputPerSec: success / (safeDuration / 1000),
    latencyP50Ms: percentile(latencies, 0.5),
    latencyP95Ms: percentile(latencies, 0.95),
    latencyP99Ms: percentile(latencies, 0.99),
    ...extra
  };
}

function toCsvRow(summary: PhaseSummary, sqliteFile: string, timestamp: string): string {
  const fields = [
    timestamp,
    summary.phase,
    String(summary.ops),
    String(summary.success),
    String(summary.errors),
    formatNumber(summary.errorRate),
    formatNumber(summary.durationMs),
    formatNumber(summary.throughputPerSec),
    formatNumber(summary.latencyP50Ms),
    formatNumber(summary.latencyP95Ms),
    formatNumber(summary.latencyP99Ms),
    String(summary.readOps ?? 0),
    String(summary.writeOps ?? 0),
    formatNumber(summary.readP95Ms ?? 0),
    formatNumber(summary.writeP95Ms ?? 0),
    String(summary.readMiss ?? 0),
    formatNumber(summary.readMissRate ?? 0),
    sqliteFile
  ];
  return fields.map(escapeCsv).join(",");
}

function escapeCsv(value: string): string {
  if (!/[",\n]/.test(value)) return value;
  return `"${value.replaceAll("\"", "\"\"")}"`;
}

function log(message: string, silent = false): void {
  if (!silent) {
    console.log(`[sqlite-benchmark] ${message}`);
  }
}

export async function runSqliteBenchmark(options: Partial<BenchmarkOptions> = {}): Promise<BenchmarkResult> {
  const cfg = withDefaults(options);
  assert(cfg.totalRecords > 0, "totalRecords must be > 0");
  assert(cfg.mixedOps > 0, "mixedOps must be > 0");
  assert(cfg.batchSize > 0, "batchSize must be > 0");
  assert(cfg.readPercent >= 0 && cfg.readPercent <= 100, "readPercent must be in [0, 100]");

  const { runDir, sqliteFile, csvFile } = await createRunDir();
  const rng = createSeededRandom(cfg.seed);

  const sqlite = new SQLiteDatabase({ filePath: sqliteFile });
  const blockStore = new SQLiteBlockStore(sqlite);
  const rawStore = new SQLiteRawEventStore(sqlite);

  let currentIndex = 0;
  let writtenCount = 0;

  try {
    log(
      `start totalRecords=${cfg.totalRecords} mixedOps=${cfg.mixedOps} readPercent=${cfg.readPercent} batchSize=${cfg.batchSize} seed=${cfg.seed}`,
      cfg.silent
    );

    const writeLatencies: number[] = [];
    let writeSuccess = 0;
    let writeErrors = 0;
    const writeStart = performance.now();

    for (let batchStart = 0; batchStart < cfg.totalRecords; batchStart += cfg.batchSize) {
      const batchEnd = Math.min(cfg.totalRecords, batchStart + cfg.batchSize);
      for (let i = batchStart; i < batchEnd; i += 1) {
        const index = currentIndex;
        const { block, events } = buildRecord(index, cfg.seed);
        currentIndex += 1;

        const t0 = performance.now();
        try {
          blockStore.upsert(block);
          rawStore.put(block.id, events);
          writeSuccess += 1;
          writtenCount += 1;
        } catch {
          writeErrors += 1;
        }
        writeLatencies.push(performance.now() - t0);
      }

      if (!cfg.silent && batchEnd % Math.max(cfg.batchSize * 20, 100_000) === 0) {
        log(`write progress ${batchEnd}/${cfg.totalRecords}`, cfg.silent);
      }
    }

    const writeDurationMs = performance.now() - writeStart;
    const writeSummary = summarizePhase(
      "write",
      cfg.totalRecords,
      writeSuccess,
      writeErrors,
      writeDurationMs,
      writeLatencies
    );

    const mixedLatencies: number[] = [];
    const readLatencies: number[] = [];
    const writePhaseLatencies: number[] = [];
    let mixedSuccess = 0;
    let mixedErrors = 0;
    let mixedReadOps = 0;
    let mixedWriteOps = 0;
    let readMiss = 0;

    const mixedStart = performance.now();
    for (let op = 0; op < cfg.mixedOps; op += 1) {
      const doRead = writtenCount > 0 && rng() * 100 < cfg.readPercent;
      const t0 = performance.now();

      if (doRead) {
        mixedReadOps += 1;
        try {
          const index = Math.floor(rng() * writtenCount);
          const id = blockIdFor(index);
          const block = blockStore.get(id);
          const events = rawStore.get(id);
          if (!block || !events) {
            readMiss += 1;
          }
          mixedSuccess += 1;
        } catch {
          mixedErrors += 1;
        }
        const latency = performance.now() - t0;
        mixedLatencies.push(latency);
        readLatencies.push(latency);
      } else {
        mixedWriteOps += 1;
        const index = currentIndex;
        const { block, events } = buildRecord(index, cfg.seed + 1);
        currentIndex += 1;
        try {
          blockStore.upsert(block);
          rawStore.put(block.id, events);
          mixedSuccess += 1;
          writtenCount += 1;
        } catch {
          mixedErrors += 1;
        }
        const latency = performance.now() - t0;
        mixedLatencies.push(latency);
        writePhaseLatencies.push(latency);
      }
    }

    const mixedDurationMs = performance.now() - mixedStart;
    const mixedSummary = summarizePhase(
      `mixed_${cfg.readPercent}_${100 - cfg.readPercent}`,
      cfg.mixedOps,
      mixedSuccess,
      mixedErrors,
      mixedDurationMs,
      mixedLatencies,
      {
        readOps: mixedReadOps,
        writeOps: mixedWriteOps,
        readP95Ms: percentile(readLatencies, 0.95),
        writeP95Ms: percentile(writePhaseLatencies, 0.95),
        readMiss,
        readMissRate: mixedReadOps > 0 ? readMiss / mixedReadOps : 0
      }
    );

    const timestamp = new Date().toISOString();
    const header = [
      "timestamp",
      "phase",
      "ops",
      "success",
      "errors",
      "error_rate",
      "duration_ms",
      "throughput_per_sec",
      "latency_p50_ms",
      "latency_p95_ms",
      "latency_p99_ms",
      "read_ops",
      "write_ops",
      "read_p95_ms",
      "write_p95_ms",
      "read_miss",
      "read_miss_rate",
      "sqlite_file"
    ].join(",");
    const csvText = [
      header,
      toCsvRow(writeSummary, sqliteFile, timestamp),
      toCsvRow(mixedSummary, sqliteFile, timestamp)
    ].join("\n");
    await writeFile(csvFile, csvText, "utf8");

    log(
      `write throughput=${formatNumber(writeSummary.throughputPerSec)} rec/s duration=${formatNumber(writeSummary.durationMs)}ms p95=${formatNumber(writeSummary.latencyP95Ms)}ms`,
      cfg.silent
    );
    log(
      `mixed throughput=${formatNumber(mixedSummary.throughputPerSec)} ops/s readOps=${mixedReadOps} writeOps=${mixedWriteOps} readMissRate=${formatNumber((mixedSummary.readMissRate ?? 0) * 100)}%`,
      cfg.silent
    );
    log(`csv=${csvFile}`, cfg.silent);

    return {
      runDir,
      sqliteFile,
      csvFile,
      write: writeSummary,
      mixed: mixedSummary
    };
  } finally {
    sqlite.close();
  }
}

async function main(): Promise<void> {
  const result = await runSqliteBenchmark({
    totalRecords: parseEnvInt("BENCH_TOTAL_RECORDS", 1_000_000),
    mixedOps: parseEnvInt("BENCH_MIXED_OPS", 200_000),
    readPercent: parseEnvInt("BENCH_READ_PERCENT", 80),
    batchSize: parseEnvInt("BENCH_BATCH_SIZE", 1_000),
    seed: parseEnvInt("BENCH_SEED", 42)
  });
  log(`runDir=${result.runDir}`);
}

function parseEnvInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const isDirectRun = (() => {
  const script = process.argv[1];
  if (!script) return false;
  return resolve(script) === fileURLToPath(import.meta.url);
})();

if (isDirectRun) {
  void main().catch((error) => {
    console.error("[sqlite-benchmark] FAIL");
    console.error(error);
    process.exitCode = 1;
  });
}
