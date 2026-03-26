import { describe, expect, test } from "vitest";

import { createRuntime } from "../src/container.js";

describe("Agent", () => {
  test("returns response and accumulates memory", async () => {
    const runtime = createRuntime({
      service: {
        provider: "rule-based"
      }
    });

    const first = await runtime.agent.respond("我们正在设计一个 Node.js CLI Agent。");
    expect(first.text.length).toBeGreaterThan(0);

    await runtime.agent.sealMemory();
    const second = await runtime.agent.respond("请回顾之前的设计重点。");
    expect(second.context.blocks.length).toBeGreaterThan(0);
  });
});
