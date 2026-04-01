/**
 * scripts/convert-crud-rag.ts
 *
 * Converts CRUD-RAG dataset to MLEX SemanticCase bench format.
 *
 * Sources:
 *   1doc_QA.json   → category: noise     (1 relevant + 9 random distractors)
 *   2docs_QA.json  → category: multi-hop  (2 documents, answer in news2)
 *   hallu_modified → category: temporal   (real vs hallucinated continuation)
 *
 * Usage:
 *   npx tsx scripts/convert-crud-rag.ts [--crud-dir <path>] [--out <path>] [--limit <n>]
 *
 * Defaults:
 *   --crud-dir  D:/Struc/train/CRUD_RAG/data/crud
 *   --out       test/fixtures/eval.crud_rag.cases.json
 *   --limit     300   (100 per category)
 */

import { execSync } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── CLI args ────────────────────────────────────────────────────────────────

const argCrudDir = process.argv.find(a => a.startsWith("--crud-dir="))?.split("=")[1]
  ?? "D:/Struc/train/CRUD_RAG/data/crud";
const argOut = process.argv.find(a => a.startsWith("--out="))?.split("=")[1]
  ?? join(__dirname, "../test/fixtures/eval.crud_rag.cases.json");
const argLimit = parseInt(process.argv.find(a => a.startsWith("--limit="))?.split("=")[1] ?? "300");
const PER_CAT = Math.floor(argLimit / 3);

// ─── Types ───────────────────────────────────────────────────────────────────

interface SemanticCase {
  id: string;
  category: "noise" | "multi-hop" | "temporal";
  blocks: string[][];
  query: string;
  groundTruth: string;
  topN: number;
  note: string;
}

// ─── Unzip helper ─────────────────────────────────────────────────────────────

function unzipToString(zipPath: string, filename: string): string {
  return execSync(`unzip -p "${zipPath}" "${filename}"`, { maxBuffer: 200 * 1024 * 1024 }).toString("utf8");
}

// ─── JSON parse (array format) ───────────────────────────────────────────────

function parseJsonArray<T>(raw: string): T[] {
  // Some files have control chars — strip them
  const cleaned = raw.replace(/[\x00-\x08\x0b-\x0c\x0e-\x1f]/g, "");
  try {
    return JSON.parse(cleaned) as T[];
  } catch {
    // fallback: parse line by line (JSONL)
    return cleaned.split("\n")
      .map(l => l.trim())
      .filter(l => l.startsWith("{"))
      .map(l => {
        try { return JSON.parse(l) as T; } catch { return null; }
      })
      .filter((x): x is T => x !== null);
  }
}

// ─── groundTruth extractor ────────────────────────────────────────────────────

/**
 * Find a short distinctive phrase from `source` that:
 * - appears in `inBlock` (relevant block)
 * - does NOT appear in any of `notInBlocks`
 * - is at least minLen chars long
 */
function extractGroundTruth(
  source: string,
  inBlock: string,
  notInBlocks: string[],
  minLen = 4
): string | null {
  // Split source into candidate phrases by punctuation
  const candidates = source
    .split(/[，。！？、；：\s]+/)
    .map(s => s.replace(/[""''《》【】（）]/g, "").trim())
    .filter(s => s.length >= minLen && s.length <= 20)
    .sort((a, b) => b.length - a.length); // prefer longer phrases

  for (const candidate of candidates) {
    if (!inBlock.includes(candidate)) continue;
    if (notInBlocks.some(b => b.includes(candidate))) continue;
    return candidate;
  }
  return null;
}

// ─── Noise cases from 1doc_QA ─────────────────────────────────────────────────

interface OneDocItem {
  id: string;
  event: string;
  news1: string;
  questions: string;
  answers: string;
}

function convertNoiseCases(items: OneDocItem[], limit: number): SemanticCase[] {
  const cases: SemanticCase[] = [];
  // Use other items' news1 as noise pool
  const noisePool = items.map(i => i.news1).filter(n => n && n.length > 50);

  for (let i = 0; i < items.length && cases.length < limit; i++) {
    const item = items[i]!;
    if (!item.news1 || !item.questions || !item.answers) continue;

    // Pick 9 random noise blocks (different from current item)
    const noiseBlocks: string[] = [];
    for (let j = 0; j < noisePool.length && noiseBlocks.length < 9; j++) {
      const idx = (i + j + 1) % noisePool.length;
      if (noisePool[idx] !== item.news1) {
        noiseBlocks.push(noisePool[idx]!);
      }
    }
    if (noiseBlocks.length < 5) continue;

    // Extract groundTruth from answers (check it appears in news1)
    const gt = extractGroundTruth(item.answers, item.news1, noiseBlocks)
      ?? extractGroundTruth(item.event, item.news1, noiseBlocks);
    if (!gt) continue;

    cases.push({
      id: `crud-noise-${String(cases.length + 1).padStart(4, "0")}`,
      category: "noise",
      blocks: [
        [item.news1],
        ...noiseBlocks.map(n => [n])
      ],
      query: item.questions,
      groundTruth: gt,
      topN: 3,
      note: `CRUD-RAG 1doc QA: ${item.event.slice(0, 40)}`
    });
  }
  return cases;
}

// ─── Multi-hop cases from 2docs_QA ────────────────────────────────────────────

interface TwoDocItem {
  id: string;
  event: string;
  news1: string;
  news2: string;
  questions: string;
  answers: string;
}

function convertMultiHopCases(items: TwoDocItem[], limit: number): SemanticCase[] {
  const cases: SemanticCase[] = [];

  for (let i = 0; i < items.length && cases.length < limit; i++) {
    const item = items[i]!;
    if (!item.news1 || !item.news2 || !item.questions) continue;

    // multi-hop: query → news1 (Block A, connects to entity) → news2 (Block B, answer)
    // groundTruth must be in news2 (blocks[1])
    const gt = extractGroundTruth(item.answers, item.news2, [item.news1])
      ?? extractGroundTruth(item.event, item.news2, [item.news1]);
    if (!gt) continue;

    cases.push({
      id: `crud-multihop-${String(cases.length + 1).padStart(4, "0")}`,
      category: "multi-hop",
      blocks: [
        [item.news1],
        [item.news2]
      ],
      query: item.questions,
      groundTruth: gt,
      topN: 5,
      note: `CRUD-RAG 2docs QA: ${item.event.slice(0, 40)}`
    });
  }
  return cases;
}

// ─── Temporal cases from hallu_modified ───────────────────────────────────────

interface HalluItem {
  ID: string;
  headLine: string;
  broadcastDate: string;
  newsBeginning: string;
  hallucinatedContinuation: string;
  realContinuation: string;
  newsRemainder?: string;
}

function convertTemporalCases(items: HalluItem[], limit: number): SemanticCase[] {
  const cases: SemanticCase[] = [];

  for (let i = 0; i < items.length && cases.length < limit; i++) {
    const item = items[i]!;
    if (!item.newsBeginning || !item.realContinuation || !item.hallucinatedContinuation) continue;

    const realBlock = item.newsBeginning + item.realContinuation + (item.newsRemainder ?? "");
    const halluBlock = item.newsBeginning + item.hallucinatedContinuation;

    // groundTruth: a phrase that's in realContinuation but NOT in hallucinatedContinuation
    const gt = extractGroundTruth(item.realContinuation, realBlock, [halluBlock]);
    if (!gt) continue;

    // Query from headline
    const query = item.headLine.replace(/[（）\n]/g, "").trim() + "，发生了什么？";

    cases.push({
      id: `crud-temporal-${String(cases.length + 1).padStart(4, "0")}`,
      category: "temporal",
      blocks: [
        [realBlock],         // newer (correct)
        [halluBlock],        // older (hallucinated/wrong)
      ],
      query,
      groundTruth: gt,
      topN: 4,
      note: `CRUD-RAG hallu: ${item.headLine.slice(0, 40)}`
    });
  }
  return cases;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const zipPath = join(argCrudDir, "CRUD_Data.zip");
  if (!existsSync(zipPath)) {
    console.error(`Not found: ${zipPath}`);
    process.exit(1);
  }

  console.log("Loading 1doc_QA.json ...");
  const oneDocs = parseJsonArray<OneDocItem>(unzipToString(zipPath, "1doc_QA.json"));
  console.log(`  ${oneDocs.length} items`);

  console.log("Loading 2docs_QA.json ...");
  const twoDocs = parseJsonArray<TwoDocItem>(unzipToString(zipPath, "2docs_QA.json"));
  console.log(`  ${twoDocs.length} items`);

  console.log("Loading hallu_modified.json ...");
  const hallus = parseJsonArray<HalluItem>(unzipToString(zipPath, "hallu_modified.json"));
  console.log(`  ${hallus.length} items`);

  console.log(`\nConverting (${PER_CAT} per category) ...`);

  const noiseCases = convertNoiseCases(oneDocs, PER_CAT);
  console.log(`  noise:     ${noiseCases.length}`);

  const multiHopCases = convertMultiHopCases(twoDocs, PER_CAT);
  console.log(`  multi-hop: ${multiHopCases.length}`);

  const temporalCases = convertTemporalCases(hallus, PER_CAT);
  console.log(`  temporal:  ${temporalCases.length}`);

  const all = [...noiseCases, ...multiHopCases, ...temporalCases];
  console.log(`\nTotal: ${all.length} cases`);

  await fs.mkdir(dirname(argOut), { recursive: true });
  await fs.writeFile(argOut, JSON.stringify(all, null, 2) + "\n", "utf8");
  console.log(`Saved → ${argOut}`);
}

main().catch(e => { console.error(e); process.exit(1); });
