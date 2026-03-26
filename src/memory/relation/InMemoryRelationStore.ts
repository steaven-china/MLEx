import type { BlockId } from "../../types.js";
import type { IRelationStore, StoredRelation } from "./IRelationStore.js";

export class InMemoryRelationStore implements IRelationStore {
  private readonly relations: StoredRelation[] = [];

  add(relation: StoredRelation): void {
    const existing = this.relations.find(
      (item) =>
        item.src === relation.src && item.dst === relation.dst && item.type === relation.type
    );
    if (existing) {
      existing.timestamp = relation.timestamp;
      existing.confidence = relation.confidence;
      return;
    }
    this.relations.push({ ...relation });
  }

  listOutgoing(src: BlockId): StoredRelation[] {
    return this.relations.filter((relation) => relation.src === src).map((relation) => ({ ...relation }));
  }

  listIncoming(dst: BlockId): StoredRelation[] {
    return this.relations.filter((relation) => relation.dst === dst).map((relation) => ({ ...relation }));
  }

  listAll(): StoredRelation[] {
    return this.relations.map((relation) => ({ ...relation }));
  }
}
