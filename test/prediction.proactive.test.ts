import { describe, expect, test } from "vitest";

import { shouldProactiveRetrieve } from "../src/memory/prediction/ProactiveRetrievePolicy.js";

describe("ProactiveRetrievePolicy", () => {
  test("rejects proactive retrieval when prediction entropy is high", () => {
    const allowed = shouldProactiveRetrieve({
      predProbs: [0.34, 0.33, 0.33],
      queryVec: [1, 0, 0],
      topSummaryVec: [1, 0, 0]
    });
    expect(allowed).toBe(false);
  });

  test("allows proactive retrieval on confident prediction with semantic confirmation", () => {
    const allowed = shouldProactiveRetrieve({
      predProbs: [0.94, 0.04, 0.02],
      queryVec: [1, 0, 0],
      topSummaryVec: [0.95, 0.1, 0]
    });
    expect(allowed).toBe(true);
  });

  test("rejects when semantic confirmation is weak even if prediction is confident", () => {
    const allowed = shouldProactiveRetrieve({
      predProbs: [0.94, 0.04, 0.02],
      queryVec: [1, 0, 0],
      topSummaryVec: [0, 1, 0]
    });
    expect(allowed).toBe(false);
  });
});
