import { cosineSimilarity } from "../../utils/text.js";

export interface ProactiveRetrieveInput {
  predProbs: number[];
  queryVec: number[];
  topSummaryVec?: number[];
}

export interface ProactiveRetrieveThresholds {
  entropyRejectThreshold?: number;
  entropyAcceptThreshold?: number;
  marginThreshold?: number;
  semanticThreshold?: number;
}

export function shouldProactiveRetrieve(
  input: ProactiveRetrieveInput,
  thresholds: ProactiveRetrieveThresholds = {}
): boolean {
  const entropyRejectThreshold = thresholds.entropyRejectThreshold ?? 0.6;
  const entropyAcceptThreshold = thresholds.entropyAcceptThreshold ?? 0.3;
  const marginThreshold = thresholds.marginThreshold ?? 0.2;
  const semanticThreshold = thresholds.semanticThreshold ?? 0.6;

  const probs = normalizeProbs(input.predProbs);
  const topSummaryVec = input.topSummaryVec;
  if (probs.length === 0 || !topSummaryVec) return false;
  if (input.queryVec.length === 0 || topSummaryVec.length === 0) return false;

  const entropy = -probs.reduce((sum, p) => sum + p * Math.log(p + 1e-9), 0);
  const normalizedEntropy = probs.length <= 1 ? 0 : entropy / Math.log(probs.length);

  const p1 = probs[0] ?? 0;
  const p2 = probs[1] ?? 0;
  const margin = p1 - p2;

  if (normalizedEntropy > entropyRejectThreshold) return false;
  if (normalizedEntropy <= entropyAcceptThreshold && margin >= marginThreshold) {
    const sim = cosineSimilarity(input.queryVec, topSummaryVec);
    return sim >= semanticThreshold;
  }
  return false;
}

function normalizeProbs(raw: number[]): number[] {
  const sorted = raw
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((left, right) => right - left);
  if (sorted.length === 0) return [];
  const total = sorted.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return [];
  return sorted.map((value) => value / total);
}
