import { describe, expect, test } from "vitest";

import { proactivePolicy } from "../src/memory/prediction/ProactiveTimingPolicy.js";

describe("ProactiveTimingPolicy", () => {
  test("blocks trigger during cooldown window", () => {
    const result = proactivePolicy(1000, 900, 100, 950);
    expect(result).toEqual({ allow: false });
  });

  test("allows inject mode for recent conversation", () => {
    const result = proactivePolicy(1000, 980, 200, 800);
    expect(result).toEqual({ allow: true, mode: "inject", depth: 2 });
  });

  test("degrades to inject depth 1 when span is long", () => {
    const result = proactivePolicy(4000, 3900, 1000, 3000);
    expect(result).toEqual({ allow: true, mode: "inject", depth: 1 });
  });

  test("allows prefetch for medium idle gap", () => {
    const result = proactivePolicy(3000, 1400, 100, 2000);
    expect(result).toEqual({ allow: true, mode: "prefetch", depth: 1 });
  });

  test("blocks when idle gap is too long", () => {
    const result = proactivePolicy(5000, 2000, 100, 1000);
    expect(result).toEqual({ allow: false });
  });
});
