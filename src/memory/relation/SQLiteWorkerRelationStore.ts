import type { BlockId } from "../../types.js";
import { SQLiteWorkerClient } from "../sqlite-worker/SQLiteWorkerClient.js";
import type { IRelationStore, StoredRelation } from "./IRelationStore.js";

export class SQLiteWorkerRelationStore implements IRelationStore {
  constructor(private readonly worker: SQLiteWorkerClient) {}

  async add(relation: StoredRelation): Promise<void> {
    await this.worker.request("relation.add", relation);
  }

  async listOutgoing(src: BlockId): Promise<StoredRelation[]> {
    return this.worker.request<StoredRelation[]>("relation.listOutgoing", src);
  }

  async listIncoming(dst: BlockId): Promise<StoredRelation[]> {
    return this.worker.request<StoredRelation[]>("relation.listIncoming", dst);
  }

  async listAll(): Promise<StoredRelation[]> {
    return this.worker.request<StoredRelation[]>("relation.listAll");
  }
}
