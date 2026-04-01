import type { BlockRef } from "../../types.js";
import type { MemoryBlock } from "../MemoryBlock.js";
import type { IVectorStore } from "./IVectorStore.js";
import type { HybridEmbedder } from "../embedder/HybridEmbedder.js";
import type { IBlockStore } from "../store/IBlockStore.js";

/**
 * HybridVectorStore: 粗推算 + 按需向量筛选
 *
 * 架构：
 * - 封块时：只存 hash 向量（极快，无 local 推理）
 * - 查询时：
 *   1. hash 全量扫描 → top-prescreenK（粗推算，毫秒级）
 *   2. 取这些块的原文 → 批量 local.embed（向量筛选，一次批推理）
 *   3. query.local vs 候选.local → 重排 → top-K
 *
 * 效果：
 * - 封块速度：等同于纯 hash（不再有 local 推理开销）
 * - 查询精度：等同于 local（语义检索）
 * - 查询延迟：prescreenK 次文本的一次批推理，通常 100-300ms
 */
export class HybridVectorStore implements IVectorStore {
  // 内存中只存 hash 向量（256 维），不存 local
  private readonly hashVecs = new Map<string, number[]>();
  private readonly hashDim: number;

  constructor(
    private readonly embedder: HybridEmbedder,
    private readonly blockStore: IBlockStore
  ) {
    this.hashDim = embedder.dimension - 768; // dimension = hashDim + localDim
  }

  async add(block: MemoryBlock): Promise<void> {
    if (block.embedding.length > 0) {
      // 只保留 hash 部分（前 hashDim 维）
      this.hashVecs.set(block.id, block.embedding.slice(0, this.hashDim));
    }
  }

  async remove(blockId: string): Promise<void> {
    this.hashVecs.delete(blockId);
  }

  async search(queryVec: number[], topK: number): Promise<BlockRef[]> {
    if (topK <= 0 || this.hashVecs.size === 0) return [];

    const total = this.hashVecs.size;
    const prescreenK = Math.min(Math.max(Math.floor(total * 0.05), 20), 100);

    // ── Stage 1: hash 粗推算 ──────────────────────────────────────────────
    const queryHash = queryVec.slice(0, this.hashDim);
    const queryLocal = queryVec.slice(this.hashDim);
    const queryLocalNonZero = queryLocal.some(v => v !== 0);

    const hashScores = Array.from(this.hashVecs.entries()).map(([id, hash]) => ({
      id,
      hashScore: cosineSimilarity(queryHash, hash)
    }));
    hashScores.sort((a, b) => b.hashScore - a.hashScore);
    const prescreened = hashScores.slice(0, prescreenK);

    // ── Stage 2: 按需 local 向量筛选 ─────────────────────────────────────
    if (queryLocalNonZero) {
      // 取原文（summary + rawEvents）
      const prescreenedIds = prescreened.map(p => p.id);
      const blocks = await this.blockStore.getMany(prescreenedIds);
      const blockMap = new Map(blocks.map(b => [b.id, b]));

      // 只对 topK*3 个做 local 重排（节省推理量）
      const rerankCount = Math.min(prescreenK, topK * 3);
      const toRerank = prescreened.slice(0, rerankCount);

      const texts = toRerank.map(({ id }) => {
        const b = blockMap.get(id);
        if (!b) return "";
        const parts = [b.summary ?? ""];
        for (const e of b.rawEvents ?? []) parts.push(e.text);
        return parts.join(" ").trim();
      });

      // 一次批推理
      const localVecs = await this.embedder.embedLocalBatch(texts);

      // local 重排
      const localScores = toRerank.map(({ id, hashScore }, i) => {
        const lv = localVecs[i];
        const score = lv && lv.some(v => v !== 0)
          ? cosineSimilarity(queryLocal, lv)
          : hashScore;
        const block = blockMap.get(id);
        return { id, score, block };
      });

      localScores.sort((a, b) => b.score - a.score);

      return localScores.slice(0, topK).map(({ id, score, block }) => ({
        id,
        score,
        source: "vector" as const,
        summary: block?.summary ?? "",
        startTime: block?.startTime ?? 0,
        endTime: block?.endTime ?? 0,
        keywords: block?.keywords ?? [],
        rawEvents: block?.rawEvents ?? [],
        retentionMode: block?.retentionMode ?? "raw",
        matchScore: block?.matchScore ?? 0,
        conflict: block?.conflict ?? false
      }));
    }

    // ── 无 local 查询：直接返回 hash 结果 ───────────────────────────────
    const ids = prescreened.slice(0, topK).map(p => p.id);
    const blocks = await this.blockStore.getMany(ids);
    const blockMap = new Map(blocks.map(b => [b.id, b]));

    return prescreened.slice(0, topK).map(({ id, hashScore }) => {
      const block = blockMap.get(id);
      return {
        id,
        score: hashScore,
        source: "vector" as const,
        summary: block?.summary ?? "",
        startTime: block?.startTime ?? 0,
        endTime: block?.endTime ?? 0,
        keywords: block?.keywords ?? [],
        rawEvents: block?.rawEvents ?? [],
        retentionMode: block?.retentionMode ?? "raw",
        matchScore: block?.matchScore ?? 0,
        conflict: block?.conflict ?? false
      };
    });
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}
