export type BlockId = string;

export type EventRole = "system" | "user" | "assistant" | "tool";

export interface MemoryEvent {
  id: string;
  role: EventRole;
  text: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export type RetentionMode = "compressed" | "raw" | "conflict";

export enum RelationType {
  CAUSES = "CAUSES",
  FOLLOWS = "FOLLOWS",
  PARENT_TASK = "PARENT_TASK",
  CHILD_TASK = "CHILD_TASK",
  ALTERNATIVE = "ALTERNATIVE",
  CONTEXT = "CONTEXT"
}

export interface BlockRef {
  id: BlockId;
  score: number;
  source: "keyword" | "vector" | "graph" | "fusion";
  summary: string;
  startTime: number;
  endTime: number;
  keywords: string[];
  rawEvents?: MemoryEvent[];
  retentionMode?: RetentionMode;
  matchScore?: number;
  conflict?: boolean;
}

export interface PredictedIntent {
  blockId: BlockId;
  label: string;
  confidence: number;
}

export interface PredictionResult {
  vector: number[];
  intents: PredictedIntent[];
  activeTrigger: boolean;
  transitionProbabilities: Array<{ blockId: BlockId; probability: number }>;
}

export interface Context {
  blocks: BlockRef[];
  recentEvents: MemoryEvent[];
  formatted: string;
  prediction?: PredictionResult;
}

export type TraverseDirection = "incoming" | "outgoing" | "both";

export interface DirectionalIntent {
  direction: TraverseDirection;
  relationTypes: RelationType[];
  depth: number;
}

export interface ManagerConfig {
  maxTokensPerBlock: number;
  minTokensPerBlock: number;
  proactiveSealEnabled: boolean;
  proactiveSealIdleSeconds: number;
  proactiveSealTurnBoundary: boolean;
  proactiveSealMinTokens: number;
  recentEventWindow: number;
  semanticTopK: number;
  finalTopK: number;
  enableRelationExpansion: boolean;
  relationDepth: number;
  graphExpansionTopK: number;
  keywordWeight: number;
  vectorWeight: number;
  graphWeight: number;
  compressionHighMatchThreshold: number;
  compressionLowMatchThreshold: number;
  compressionSoftBand: number;
  compressionPreserveWeight: number;
  compressionMinRawTokens: number;
  conflictMarkerEnabled: boolean;
  predictionEnabled: boolean;
  predictionTopK: number;
  predictionWalkDepth: number;
  predictionActiveThreshold: number;
  predictionTransitionDecay: number;
  predictionBoostWeight: number;
}
