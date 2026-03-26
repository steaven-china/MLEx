import type { MemoryBlock } from "../MemoryBlock.js";
import type { IRetentionAction } from "./RetentionActions.js";

export interface RetentionPolicyConfig {
  highMatchThreshold: number;
  lowMatchThreshold: number;
  softBand?: number;
  preserveWeight?: number;
  minRawTokens?: number;
  conflictMarkerEnabled: boolean;
}

export interface RetentionDecisionInput {
  block: MemoryBlock;
  matchScore: number;
  directionalAffinity?: number;
  noveltyScore?: number;
  relationBoost?: number;
}

export interface RetentionDecision {
  action: IRetentionAction;
  reason: string;
}

export class RetentionPolicyEngine {
  constructor(
    private readonly config: RetentionPolicyConfig,
    private readonly actions: {
      compress: IRetentionAction;
      keepRaw: IRetentionAction;
      conflict: IRetentionAction;
    }
  ) {}

  decide(input: RetentionDecisionInput): RetentionDecision {
    const { block, matchScore } = input;
    const highMatchThreshold = normalizeThreshold(this.config.highMatchThreshold, 0.82);
    const lowMatchThreshold = normalizeThreshold(this.config.lowMatchThreshold, 0.35);
    const upperThreshold = Math.max(highMatchThreshold, lowMatchThreshold + 0.01);
    const lowerThreshold = Math.min(lowMatchThreshold, upperThreshold - 0.01);
    const softBand = clampRange(this.config.softBand ?? 0.08, 0, 0.25);
    const preserveWeight = clampRange(this.config.preserveWeight ?? 0.7, 0, 1.5);
    const minRawTokens = Math.max(0, Math.floor(this.config.minRawTokens ?? 56));

    const directionalAffinity = clampUnit(input.directionalAffinity ?? 0);
    const noveltyScore = clampUnit(input.noveltyScore ?? 0);
    const relationSignal = clampUnit((input.relationBoost ?? 0) / 0.1);
    const preserveSignal = clampUnit(
      directionalAffinity * 0.5 + noveltyScore * 0.35 + relationSignal * 0.15
    );
    const text = `${block.summary} ${block.rawEvents.map((event) => event.text).join(" ")}`.toLowerCase();
    const hasConflictSignal = this.config.conflictMarkerEnabled && containsConflictSignal(text);

    if (hasConflictSignal) {
      return {
        action: this.actions.conflict,
        reason: "conflict_signal_detected"
      };
    }

    if (block.tokenCount <= minRawTokens && matchScore < upperThreshold) {
      return {
        action: this.actions.keepRaw,
        reason: "small_block_preserve"
      };
    }

    if (matchScore >= upperThreshold + softBand) {
      if (isDirectionalProgress(directionalAffinity, noveltyScore, relationSignal, preserveSignal)) {
        return {
          action: this.actions.keepRaw,
          reason: "high_match_directional_progress"
        };
      }
      return {
        action: this.actions.compress,
        reason: "high_match_redundant"
      };
    }

    if (matchScore <= lowerThreshold - softBand) {
      return {
        action: this.actions.keepRaw,
        reason: "low_match_unique"
      };
    }

    const normalizedMatch = normalizeRange(matchScore, lowerThreshold - softBand, upperThreshold + softBand);
    const adaptiveCompressionScore = normalizedMatch * (1 - preserveSignal * preserveWeight);
    if (adaptiveCompressionScore >= 0.58) {
      return {
        action: this.actions.compress,
        reason: "adaptive_soft_compress"
      };
    }

    return {
      action: this.actions.keepRaw,
      reason: "adaptive_soft_keep"
    };
  }
}

function containsConflictSignal(text: string): boolean {
  const markers = [
    "but",
    "however",
    "instead",
    "contradict",
    "conflict",
    "not",
    "但是",
    "不过",
    "冲突",
    "矛盾",
    "相反",
    "而不是",
    "并非"
  ];
  return markers.some((marker) => text.includes(marker));
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function normalizeThreshold(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return clampUnit(value);
}

function clampRange(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function normalizeRange(value: number, min: number, max: number): number {
  if (max <= min) return value >= max ? 1 : 0;
  return clampUnit((value - min) / (max - min));
}

function isDirectionalProgress(
  directionalAffinity: number,
  noveltyScore: number,
  relationSignal: number,
  preserveSignal: number
): boolean {
  if (directionalAffinity >= 0.62 && noveltyScore >= 0.22) return true;
  if (directionalAffinity >= 0.5 && noveltyScore >= 0.3 && relationSignal >= 0.35) return true;
  return preserveSignal >= 0.68;
}
