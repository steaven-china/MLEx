import type { BlockId, RelationLabel, TraverseDirection } from "../types.js";

export class RelationGraph {
  private outEdges = new Map<BlockId, Map<BlockId, Set<RelationLabel>>>();
  private inEdges = new Map<BlockId, Map<BlockId, Set<RelationLabel>>>();

  addRelation(src: BlockId, dst: BlockId, type: RelationLabel): void {
    if (!this.outEdges.has(src)) this.outEdges.set(src, new Map());
    if (!this.inEdges.has(dst)) this.inEdges.set(dst, new Map());
    const outTable = this.outEdges.get(src);
    if (!outTable) return;
    if (!outTable.has(dst)) outTable.set(dst, new Set());
    outTable.get(dst)?.add(type);

    const inTable = this.inEdges.get(dst);
    if (!inTable) return;
    if (!inTable.has(src)) inTable.set(src, new Set());
    inTable.get(src)?.add(type);
  }

  getOutgoing(src: BlockId, type?: RelationLabel): Set<BlockId> {
    const edges = this.outEdges.get(src);
    if (!edges) return new Set();
    const result = new Set<BlockId>();
    for (const [dst, edgeTypes] of edges.entries()) {
      if (!type || edgeTypes.has(type)) result.add(dst);
    }
    return result;
  }

  getIncoming(dst: BlockId, type?: RelationLabel): Set<BlockId> {
    const edges = this.inEdges.get(dst);
    if (!edges) return new Set();
    const result = new Set<BlockId>();
    for (const [src, edgeTypes] of edges.entries()) {
      if (!type || edgeTypes.has(type)) result.add(src);
    }
    return result;
  }

  getOutgoingTyped(src: BlockId): Array<{ blockId: BlockId; type: RelationLabel }> {
    const edges = this.outEdges.get(src);
    if (!edges) return [];
    const result: Array<{ blockId: BlockId; type: RelationLabel }> = [];
    for (const [blockId, types] of edges.entries()) {
      for (const type of types.values()) {
        result.push({ blockId, type });
      }
    }
    return result;
  }

  getIncomingTyped(dst: BlockId): Array<{ blockId: BlockId; type: RelationLabel }> {
    const edges = this.inEdges.get(dst);
    if (!edges) return [];
    const result: Array<{ blockId: BlockId; type: RelationLabel }> = [];
    for (const [blockId, types] of edges.entries()) {
      for (const type of types.values()) {
        result.push({ blockId, type });
      }
    }
    return result;
  }

  traverse(
    start: BlockId,
    direction: TraverseDirection,
    types: RelationLabel[] = [],
    depth = 1
  ): Set<BlockId> {
    if (depth <= 0) return new Set();
    const allowType = (type: RelationLabel): boolean =>
      types.length === 0 || types.includes(type);

    const visited = new Set<BlockId>([start]);
    const result = new Set<BlockId>();
    const queue: Array<{ id: BlockId; level: number }> = [{ id: start, level: 0 }];

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) break;
      if (current.level >= depth) continue;

      if (direction === "outgoing" || direction === "both") {
        const out = this.outEdges.get(current.id);
        if (out) {
          for (const [nextId, relTypes] of out.entries()) {
            const matched = [...relTypes].some((rel) => allowType(rel));
            if (!matched || visited.has(nextId)) continue;
            visited.add(nextId);
            result.add(nextId);
            queue.push({ id: nextId, level: current.level + 1 });
          }
        }
      }

      if (direction === "incoming" || direction === "both") {
        const incoming = this.inEdges.get(current.id);
        if (incoming) {
          for (const [nextId, relTypes] of incoming.entries()) {
            const matched = [...relTypes].some((rel) => allowType(rel));
            if (!matched || visited.has(nextId)) continue;
            visited.add(nextId);
            result.add(nextId);
            queue.push({ id: nextId, level: current.level + 1 });
          }
        }
      }
    }

    return result;
  }
}
