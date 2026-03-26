import type { BlockId, RelationType } from "../../types.js";

export interface StoredRelation {
  src: BlockId;
  dst: BlockId;
  type: RelationType;
  timestamp: number;
  confidence?: number;
}

export interface IRelationStore {
  add(relation: StoredRelation): Promise<void> | void;
  listOutgoing(src: BlockId): Promise<StoredRelation[]> | StoredRelation[];
  listIncoming(dst: BlockId): Promise<StoredRelation[]> | StoredRelation[];
  listAll(): Promise<StoredRelation[]> | StoredRelation[];
}
