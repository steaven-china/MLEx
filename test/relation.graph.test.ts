import { describe, expect, test } from "vitest";

import { RelationGraph } from "../src/memory/RelationGraph.js";
import { RelationType } from "../src/types.js";

describe("RelationGraph", () => {
  test("keeps multiple relation types between same pair", () => {
    const graph = new RelationGraph();
    graph.addRelation("a", "b", RelationType.CONTEXT);
    graph.addRelation("a", "b", RelationType.CAUSES);

    const outgoing = graph.getOutgoing("a");
    expect(outgoing.has("b")).toBe(true);

    const causes = graph.getOutgoing("a", RelationType.CAUSES);
    const context = graph.getOutgoing("a", RelationType.CONTEXT);
    expect(causes.has("b")).toBe(true);
    expect(context.has("b")).toBe(true);

    const typed = graph.getOutgoingTyped("a")
      .filter((item) => item.blockId === "b")
      .map((item) => item.type)
      .sort();
    expect(typed).toEqual([RelationType.CAUSES, RelationType.CONTEXT].sort());
  });

  test("traverse respects relation type filtering", () => {
    const graph = new RelationGraph();
    graph.addRelation("a", "b", RelationType.CONTEXT);
    graph.addRelation("a", "b", RelationType.CAUSES);
    graph.addRelation("b", "c", RelationType.FOLLOWS);

    const onlyCauses = graph.traverse("a", "outgoing", [RelationType.CAUSES], 1);
    expect(onlyCauses.has("b")).toBe(true);

    const onlyFollowsDepth2 = graph.traverse("a", "outgoing", [RelationType.FOLLOWS], 2);
    expect(onlyFollowsDepth2.has("b")).toBe(false);
    expect(onlyFollowsDepth2.has("c")).toBe(false);
  });
});
