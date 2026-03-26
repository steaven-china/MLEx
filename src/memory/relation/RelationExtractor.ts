import { RelationType } from "../../types.js";
import { extractKeywords, normalizeText } from "../../utils/text.js";
import type { MemoryBlock } from "../MemoryBlock.js";

export interface ExtractedRelation {
  src: string;
  dst: string;
  type: RelationType;
  confidence: number;
}

export interface IRelationExtractor {
  extract(current: MemoryBlock, neighbors: MemoryBlock[]): Promise<ExtractedRelation[]>;
}

export class HeuristicRelationExtractor implements IRelationExtractor {
  async extract(current: MemoryBlock, neighbors: MemoryBlock[]): Promise<ExtractedRelation[]> {
    const relations: ExtractedRelation[] = [];
    const contextCandidates: ExtractedRelation[] = [];
    const currentText = normalizeText(
      `${current.summary} ${current.rawEvents.map((event) => event.text).join(" ")}`
    );
    const currentKeywords = new Set(extractKeywords(currentText, 12));

    const previous = [...neighbors]
      .filter((neighbor) => neighbor.id !== current.id && neighbor.endTime <= current.endTime)
      .sort((a, b) => b.endTime - a.endTime)
      .at(0);
    if (previous && previous.id !== current.id) {
      const followsConfidence = estimateFollowsConfidence(previous.endTime, current.startTime);
      relations.push({
        src: previous.id,
        dst: current.id,
        type: RelationType.FOLLOWS,
        confidence: followsConfidence
      });
    }

    for (const neighbor of neighbors) {
      if (neighbor.id === current.id) continue;
      const neighborText = normalizeText(
        `${neighbor.summary} ${neighbor.rawEvents.map((event) => event.text).join(" ")}`
      );
      const neighborKeywords = new Set(extractKeywords(neighborText, 12));

      let overlap = 0;
      for (const keyword of currentKeywords) {
        if (neighborKeywords.has(keyword)) overlap += 1;
      }
      const lexicalScore = overlapScore(currentKeywords.size, neighborKeywords.size, overlap);
      const recencyScore = recencyAffinity(neighbor.endTime, current.startTime);
      const semanticScore = lexicalScore * 0.75 + recencyScore * 0.25;

      if (semanticScore >= 0.18) {
        contextCandidates.push({
          src: neighbor.id,
          dst: current.id,
          type: RelationType.CONTEXT,
          confidence: clampConfidence(semanticScore)
        });
      }

      const currentHasCauseHint = hasAny(currentText, [
        "because",
        "cause",
        "reason",
        "导致",
        "因为",
        "原因",
        "由于",
        "root cause"
      ]);
      const currentHasOutcomeHint = hasAny(currentText, [
        "issue",
        "problem",
        "bug",
        "error",
        "failure",
        "incident",
        "故障",
        "问题",
        "失败",
        "异常",
        "中断",
        "回滚"
      ]);
      const neighborHasTriggerHint = hasAny(neighborText, [
        "issue",
        "problem",
        "bug",
        "error",
        "failure",
        "incident",
        "timeout",
        "retry",
        "依赖",
        "超时",
        "重试",
        "故障",
        "问题",
        "失败",
        "异常"
      ]);
      if (currentHasCauseHint && currentHasOutcomeHint && (neighborHasTriggerHint || lexicalScore >= 0.2)) {
        const causeConfidence = clampConfidence(0.45 + lexicalScore * 0.35 + recencyScore * 0.2);
        relations.push({
          src: neighbor.id,
          dst: current.id,
          type: RelationType.CAUSES,
          confidence: causeConfidence
        });
      }

      if (
        hasAny(currentText, ["子任务", "subtask", "拆分", "步骤"]) &&
        hasAny(neighborText, ["任务", "task", "目标", "milestone"])
      ) {
        relations.push({
          src: neighbor.id,
          dst: current.id,
          type: RelationType.PARENT_TASK,
          confidence: clampConfidence(0.5 + lexicalScore * 0.3 + recencyScore * 0.2)
        });
      }

      if (
        hasAny(currentText, ["任务", "task", "目标", "milestone"]) &&
        hasAny(neighborText, ["子任务", "subtask", "拆分", "步骤"])
      ) {
        relations.push({
          src: neighbor.id,
          dst: current.id,
          type: RelationType.CHILD_TASK,
          confidence: clampConfidence(0.45 + lexicalScore * 0.35 + recencyScore * 0.2)
        });
      }

      if (
        hasAny(currentText, ["备选", "替代", "回滚", "plan b", "option", "alternative"]) &&
        lexicalScore >= 0.15
      ) {
        relations.push({
          src: neighbor.id,
          dst: current.id,
          type: RelationType.ALTERNATIVE,
          confidence: clampConfidence(0.4 + lexicalScore * 0.4 + recencyScore * 0.2)
        });
      }
    }

    const topContext = contextCandidates
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, Math.max(2, Math.min(6, Math.ceil(neighbors.length * 0.6))));

    return dedupeRelations([...relations, ...topContext]).sort((a, b) => b.confidence - a.confidence);
  }
}

function overlapScore(currentSize: number, neighborSize: number, overlap: number): number {
  const denominator = Math.max(currentSize, neighborSize, 1);
  return overlap / denominator;
}

function recencyAffinity(neighborEndTime: number, currentStartTime: number): number {
  const gap = Math.max(0, currentStartTime - neighborEndTime);
  const minute = 60 * 1000;
  if (gap <= 5 * minute) return 1;
  if (gap <= 30 * minute) return 0.8;
  if (gap <= 2 * 60 * minute) return 0.55;
  if (gap <= 24 * 60 * minute) return 0.3;
  return 0.1;
}

function estimateFollowsConfidence(previousEndTime: number, currentStartTime: number): number {
  return clampConfidence(0.55 + recencyAffinity(previousEndTime, currentStartTime) * 0.4);
}

function hasAny(text: string, hints: string[]): boolean {
  return hints.some((hint) => text.includes(hint));
}

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function dedupeRelations(relations: ExtractedRelation[]): ExtractedRelation[] {
  const table = new Map<string, ExtractedRelation>();
  for (const relation of relations) {
    const key = `${relation.src}|${relation.dst}|${relation.type}`;
    const existing = table.get(key);
    if (!existing || existing.confidence < relation.confidence) {
      table.set(key, relation);
    }
  }
  return [...table.values()];
}
