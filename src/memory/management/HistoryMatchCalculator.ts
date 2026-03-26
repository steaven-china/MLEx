import { RelationType } from "../../types.js";
import { cosineSimilarity, normalizeText } from "../../utils/text.js";
import type { MemoryBlock } from "../MemoryBlock.js";
import type { RelationGraph } from "../RelationGraph.js";

export interface HistoryMatchResult {
  score: number;
  bestMatchId?: string;
  relationBoost: number;
  directionalAffinity: number;
  noveltyScore: number;
}

export interface IHistoryMatchCalculator {
  calculate(current: MemoryBlock, history: MemoryBlock[]): HistoryMatchResult;
}

export class HistoryMatchCalculator implements IHistoryMatchCalculator {
  constructor(private readonly relationGraph: RelationGraph) {}

  calculate(current: MemoryBlock, history: MemoryBlock[]): HistoryMatchResult {
    if (history.length === 0) {
      return { score: 0, relationBoost: 0, directionalAffinity: 0, noveltyScore: 0 };
    }

    let bestScore = 0;
    let bestMatchId: string | undefined;
    let bestRelationBoost = 0;
    let bestDirectionalAffinity = 0;
    let bestNoveltyScore = 0;
    const currentText = normalizeText(
      `${current.summary} ${current.rawEvents.map((event) => event.text).join(" ")}`
    );

    for (const candidate of history) {
      if (candidate.id === current.id) continue;
      const summaryScore = cosineSimilarity(current.embedding, candidate.embedding);
      const keywordScore = overlapScore(current.keywords, candidate.keywords);
      const recencyScore = recencyBoost(current.endTime, candidate.endTime);
      const directionalAffinity = computeDirectionalAffinity(current, candidate, currentText);
      const noveltyScore = keywordNovelty(current.keywords, candidate.keywords);
      const relationBoost = relationDirectionalBoost(this.relationGraph, candidate.id, current.id);

      const baseScore = summaryScore * 0.63 + keywordScore * 0.27 + recencyScore * 0.1;
      const directionalDecay = 1 - directionalAffinity * 0.22;
      const score = Math.min(1, baseScore * directionalDecay + relationBoost);
      if (score > bestScore) {
        bestScore = score;
        bestMatchId = candidate.id;
        bestRelationBoost = relationBoost;
        bestDirectionalAffinity = directionalAffinity;
        bestNoveltyScore = noveltyScore;
      }
    }

    return {
      score: Math.min(1, bestScore),
      bestMatchId,
      relationBoost: bestRelationBoost,
      directionalAffinity: bestDirectionalAffinity,
      noveltyScore: bestNoveltyScore
    };
  }
}

function overlapScore(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  const rightSet = new Set(right.map((item) => normalizeText(item)));
  let overlap = 0;
  for (const token of left) {
    if (rightSet.has(normalizeText(token))) overlap += 1;
  }
  return overlap / Math.max(left.length, right.length, 1);
}

function recencyBoost(leftTs: number, rightTs: number): number {
  const diff = Math.abs(leftTs - rightTs);
  const oneHour = 60 * 60 * 1000;
  if (diff <= oneHour) return 1;
  if (diff <= oneHour * 6) return 0.6;
  if (diff <= oneHour * 24) return 0.3;
  return 0;
}

function computeDirectionalAffinity(
  current: MemoryBlock,
  candidate: MemoryBlock,
  currentText: string
): number {
  const directionScore = candidate.endTime <= current.startTime ? 1 : 0.45;
  const recencyScore = recencyBoost(current.startTime, candidate.endTime);
  const novelty = keywordNovelty(current.keywords, candidate.keywords);
  const transitionScore = hasTransitionSignal(currentText) ? 1 : 0;

  const affinity = (transitionScore * 0.45 + novelty * 0.35 + recencyScore * 0.2) * directionScore;
  return Math.max(0, Math.min(1, affinity));
}

function keywordNovelty(currentKeywords: string[], candidateKeywords: string[]): number {
  if (currentKeywords.length === 0) return 0;
  const candidateSet = new Set(candidateKeywords.map((item) => normalizeText(item)));
  let uncovered = 0;
  for (const token of currentKeywords) {
    if (!candidateSet.has(normalizeText(token))) uncovered += 1;
  }
  return uncovered / Math.max(currentKeywords.length, 1);
}

function relationDirectionalBoost(graph: RelationGraph, candidateId: string, currentId: string): number {
  const forward = graph
    .getOutgoingTyped(candidateId)
    .filter((edge) => edge.blockId === currentId)
    .reduce((max, edge) => Math.max(max, relationTypeWeight(edge.type)), 0);

  const backward = graph
    .getOutgoingTyped(currentId)
    .filter((edge) => edge.blockId === candidateId)
    .reduce((max, edge) => Math.max(max, relationTypeWeight(edge.type) * 0.6), 0);

  return Math.max(forward, backward);
}

function relationTypeWeight(type: RelationType): number {
  if (type === RelationType.FOLLOWS) return 0.08;
  if (type === RelationType.CAUSES) return 0.07;
  if (type === RelationType.PARENT_TASK || type === RelationType.CHILD_TASK) return 0.06;
  if (type === RelationType.CONTEXT) return 0.05;
  return 0.04;
}

function hasTransitionSignal(text: string): boolean {
  const markers = [
    "然后",
    "接着",
    "后续",
    "下一步",
    "阶段",
    "phase",
    "then",
    "next",
    "after that",
    "follow-up"
  ];
  return markers.some((marker) => text.includes(marker));
}
