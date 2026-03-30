import { promises as fs } from "node:fs";

import type { BlockId } from "../../types.js";
import { writeJsonAtomic } from "../../utils/fs.js";
import type { IRelationStore, StoredRelation } from "./IRelationStore.js";

export interface FileRelationStoreConfig {
  filePath: string;
}

export class FileRelationStore implements IRelationStore {
  private readonly relations: StoredRelation[] = [];
  private initialized = false;

  constructor(private readonly config: FileRelationStoreConfig) {}

  async add(relation: StoredRelation): Promise<void> {
    await this.ensureLoaded();
    const existing = this.relations.find(
      (item) =>
        item.src === relation.src && item.dst === relation.dst && item.type === relation.type
    );
    if (existing) {
      existing.timestamp = relation.timestamp;
      existing.confidence = relation.confidence;
    } else {
      this.relations.push({ ...relation });
    }
    await this.flush();
  }

  async listOutgoing(src: BlockId): Promise<StoredRelation[]> {
    await this.ensureLoaded();
    return this.relations.filter((relation) => relation.src === src).map((relation) => ({ ...relation }));
  }

  async listIncoming(dst: BlockId): Promise<StoredRelation[]> {
    await this.ensureLoaded();
    return this.relations.filter((relation) => relation.dst === dst).map((relation) => ({ ...relation }));
  }

  async listAll(): Promise<StoredRelation[]> {
    await this.ensureLoaded();
    return this.relations.map((relation) => ({ ...relation }));
  }

  private async ensureLoaded(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    try {
      const raw = await fs.readFile(this.config.filePath, "utf8");
      const parsed = JSON.parse(raw) as StoredRelation[];
      // Deduplicate by (src, dst, type), keeping the entry with the highest
      // confidence — consistent with SQLite and InMemory store behaviour.
      const seen = new Map<string, StoredRelation>();
      for (const item of parsed) {
        if (
          typeof item.src !== "string" ||
          typeof item.dst !== "string" ||
          typeof item.type !== "string" ||
          item.type.length === 0 ||
          (item.src.length === 0 && item.dst.length === 0)
        ) {
          continue;
        }
        const key = `${item.src}|${item.dst}|${item.type}`;
        const existing = seen.get(key);
        if (!existing || (item.confidence ?? 0) > (existing.confidence ?? 0)) {
          seen.set(key, item);
        }
      }
      this.relations.push(...seen.values());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("ENOENT")) {
        throw error;
      }
    }
  }

  private async flush(): Promise<void> {
    await writeJsonAtomic(this.config.filePath, this.relations);
  }
}
