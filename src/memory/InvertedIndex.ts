import type { BlockId } from "../types.js";

export class InvertedIndex {
  private map = new Map<string, Set<BlockId>>();

  add(blockId: BlockId, keywords: string[]): void {
    for (const keyword of keywords) {
      const normalized = keyword.toLowerCase();
      if (!this.map.has(normalized)) {
        this.map.set(normalized, new Set<BlockId>());
      }
      this.map.get(normalized)?.add(blockId);
    }
  }

  lookup(keywords: string[]): Set<BlockId> {
    if (keywords.length === 0) return new Set<BlockId>();
    const result = new Set<BlockId>();
    for (const keyword of keywords) {
      const ids = this.map.get(keyword.toLowerCase());
      if (!ids) continue;
      for (const id of ids) {
        result.add(id);
      }
    }
    return result;
  }

  remove(blockId: BlockId): void {
    for (const [key, ids] of this.map.entries()) {
      ids.delete(blockId);
      if (ids.size === 0) {
        this.map.delete(key);
      }
    }
  }
}
