/**
 * eval.crud_rag.bench.ts  —  CRUD-RAG dataset benchmark
 *
 * Loads cases from test/fixtures/eval.crud_rag.cases.json and runs
 * retrieval evaluation with hash and hybrid embedders.
 *
 * Run:
 *   # hash:
 *   npx vitest run --config vitest.bench.config.ts test/eval.crud_rag.bench.ts --reporter=verbose
 *
 *   # hybrid:
 *   MLEX_EMBEDDER=hybrid MLEX_EMBEDDING_MIRROR=https://hf-mirror.com/ \
 *     npx vitest run --config vitest.bench.config.ts test/eval.crud_rag.bench.ts --reporter=verbose
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";

import { createRuntime, type Runtime } from "../src/container.js";
import { createId } from "../src/utils/id.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(__dirname, "fixtures/eval.crud_rag.cases.json");

// ─── Types ───────────────────────────────────────────────────────────────────

interface SemanticCase {
  id: string;
  category: "noise" | "multi-hop" | "temporal";
  blocks: string[][];
  query: string;
  groundTruth: string;
  topN?: number;
  note: string;
}

interface CaseResult {
  id: string;
  category: SemanticCase["category"];
  passed: boolean;
  groundTruth: string;
  topHits: string[];
  note: string;
}

// ─── Load ────────────────────────────────────────────────────────────────────

function loadCases(): SemanticCase[] {
  if (!existsSync(FIXTURE_PATH)) {
    console.warn(`[crud-bench] fixture not found. Run: npx tsx scripts/convert-crud-rag.ts`);
    return [];
  }
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SemanticCase[];
}

// ─── Runner ──────────────────────────────────────────────────────────────────

async function runCase(c: SemanticCase): Promise<CaseResult> {
  const now = Date.now();
  let runtime: Runtime | undefined;
  try {
    const semanticTopK = Math.max(15, c.blocks.length + 4);
    runtime = createRuntime({
      manager: { enableRelationExpansion: true, relationDepth: 2,
                 graphExpansionTopK: 4, finalTopK: 10, semanticTopK }
    });

    const total = c.blocks.length;
    for (let bi = 0; bi < total; bi++) {
      const offset = (total - 1 - bi) * 3000;
      for (const text of c.blocks[bi]!) {
        await runtime.memoryManager.addEvent({
          id: createId("event"), role: "user", text,
          timestamp: now - offset
        });
      }
      await runtime.memoryManager.sealCurrentBlock();
    }

    const topN = c.topN ?? 3;
    const context = await runtime.memoryManager.getContext(c.query);
    const topBlocks = context.blocks.slice(0, topN);

    const passed = topBlocks.some(b => {
      const content = [b.summary ?? "", ...(b.rawEvents ?? []).map(e => e.text)].join(" ");
      return content.includes(c.groundTruth);
    });

    const topHits = topBlocks.slice(0, 2).map(b =>
      [b.summary ?? "", ...(b.rawEvents ?? []).map(e => e.text)]
        .join(" ").replace(/\s+/g, " ").slice(0, 80)
    );

    return { id: c.id, category: c.category, passed, groundTruth: c.groundTruth, topHits, note: c.note };
  } finally {
    await runtime?.close();
  }
}

// ─── Bench ───────────────────────────────────────────────────────────────────

const CASES = loadCases();
const CONCURRENCY = 4;

describe(`CRUD-RAG bench — ${CASES.length} cases`, () => {
  const runtimes: Runtime[] = [];
  afterEach(async () => { for (const rt of runtimes.splice(0)) await rt.close(); });

  if (CASES.length === 0) {
    test("fixture missing", () => {
      console.info("Run: npx tsx scripts/convert-crud-rag.ts");
    });
    return;
  }

  const cats = ["noise", "multi-hop", "temporal"] as const;

  for (const cat of cats) {
    const catCases = CASES.filter(c => c.category === cat);
    if (catCases.length === 0) continue;

    test(
      `category: ${cat}  (${catCases.length} cases)`,
      async () => {
        const results: CaseResult[] = [];
        for (let i = 0; i < catCases.length; i += CONCURRENCY) {
          const batch = catCases.slice(i, i + CONCURRENCY);
          results.push(...await Promise.all(batch.map(c => runCase(c))));
        }

        const embedder = process.env.MLEX_EMBEDDER ?? "hash";
        const passed = results.filter(r => r.passed).length;
        const rate = passed / results.length;

        for (const r of results.filter(r => !r.passed).slice(0, 5)) {
          console.info(`  FAIL [${r.id}] gt="${r.groundTruth}"`);
          for (const h of r.topHits) console.info(`    → "${h}"`);
        }
        console.info(`[${cat}] ${passed}/${results.length} (${(rate * 100).toFixed(1)}%)  embedder=${embedder}`);

        const thresholds: Record<typeof cat, number> = {
          "noise":     embedder === "hash" ? 0.25 : 0.60,
          "multi-hop": embedder === "hash" ? 0.40 : 0.60,
          "temporal":  0.60,
        };

        expect(rate, `${cat} ${rate.toFixed(2)} < ${thresholds[cat]}`).toBeGreaterThanOrEqual(thresholds[cat]);
      },
      { timeout: catCases.length * 10_000 + 30_000 }
    );
  }

  test(
    "overall summary",
    async () => {
      const results: CaseResult[] = [];
      for (let i = 0; i < CASES.length; i += CONCURRENCY) {
        results.push(...await Promise.all(CASES.slice(i, i + CONCURRENCY).map(c => runCase(c))));
      }
      const embedder = process.env.MLEX_EMBEDDER ?? "hash";
      const total = results.length;
      const totalPassed = results.filter(r => r.passed).length;
      console.info(`\n[crud-bench]  embedder=${embedder}  n=${total}`);
      for (const cat of cats) {
        const sub = results.filter(r => r.category === cat);
        const p = sub.filter(r => r.passed).length;
        console.info(`  ${cat.padEnd(10)} ${p}/${sub.length}  (${((p/sub.length)*100).toFixed(1)}%)`);
      }
      console.info(`  overall    ${totalPassed}/${total}  (${((totalPassed/total)*100).toFixed(1)}%)\n`);
    },
    { timeout: CASES.length * 10_000 + 60_000 }
  );
});
