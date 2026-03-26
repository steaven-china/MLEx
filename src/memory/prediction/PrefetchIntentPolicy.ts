import type { PredictedIntent } from "../../types.js";

export interface PrefetchedIntentState {
  confidence: number;
  createdAtUtc: number;
}

export interface PrefetchBoostConfig {
  ttlSeconds: number;
  boostRatio: number;
  predictionBoostWeight: number;
}

export function stagePrefetchedIntents(
  state: Map<string, PrefetchedIntentState>,
  intents: PredictedIntent[],
  nowUtc: number
): void {
  state.clear();
  for (const intent of intents) {
    state.set(intent.blockId, {
      confidence: intent.confidence,
      createdAtUtc: nowUtc
    });
  }
}

export function clearPrefetchedIntents(state: Map<string, PrefetchedIntentState>): void {
  state.clear();
}

export function applyPrefetchBoost(
  state: Map<string, PrefetchedIntentState>,
  scores: Map<string, number>,
  nowUtc: number,
  config: PrefetchBoostConfig
): void {
  if (state.size === 0) return;

  let applied = false;
  for (const [blockId, pending] of state.entries()) {
    if (nowUtc - pending.createdAtUtc > config.ttlSeconds) {
      state.delete(blockId);
      continue;
    }
    const base = scores.get(blockId) ?? 0;
    scores.set(
      blockId,
      base + pending.confidence * config.predictionBoostWeight * config.boostRatio
    );
    applied = true;
  }

  if (applied || state.size === 0) {
    state.clear();
  }
}
