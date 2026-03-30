import { readFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";

import { runSqliteBenchmark } from "../src/tools/sqlite-benchmark.js";

describe("sqlite benchmark runner", () => {
  test("generates terminal metrics and csv output in smoke scale", async () => {
    const result = await runSqliteBenchmark({
      totalRecords: 1000,
      mixedOps: 200,
      readPercent: 80,
      batchSize: 200,
      seed: 7,
      silent: true
    });

    expect(result.write.phase).toBe("write");
    expect(result.write.ops).toBe(1000);
    expect(result.write.success + result.write.errors).toBe(1000);
    expect(result.write.throughputPerSec).toBeGreaterThan(0);

    expect(result.mixed.phase).toBe("mixed_80_20");
    expect(result.mixed.ops).toBe(200);
    expect(result.mixed.success + result.mixed.errors).toBe(200);
    expect(result.mixed.throughputPerSec).toBeGreaterThan(0);

    const csvText = await readFile(result.csvFile, "utf8");
    const lines = csvText.trim().split("\n");
    expect(lines.length).toBe(3);

    const header = lines[0] ?? "";
    expect(header).toContain("timestamp,phase,ops,success,errors,error_rate");
    expect(header).toContain("read_ops,write_ops,read_p95_ms,write_p95_ms");

    const writeRow = lines[1] ?? "";
    const mixedRow = lines[2] ?? "";
    expect(writeRow).toContain(",write,");
    expect(mixedRow).toContain(",mixed_80_20,");
  });
});
