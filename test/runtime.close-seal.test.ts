import { describe, expect, test } from "vitest";

import { createRuntime } from "../src/container.js";
import { createId } from "../src/utils/id.js";

describe("Runtime close sealing", () => {
  test("seals active block on close", async () => {
    const runtime = createRuntime({
      manager: {
        maxTokensPerBlock: 9999,
        minTokensPerBlock: 120,
        proactiveSealEnabled: false,
        proactiveSealTurnBoundary: false
      },
      component: {
        chunkStrategy: "fixed",
        storageBackend: "memory",
        rawStoreBackend: "memory",
        relationStoreBackend: "memory"
      }
    });

    const blockStore = runtime.container.resolve<{
      list: () => Promise<Array<{ id: string }>>;
    }>("blockStore");

    await runtime.memoryManager.addEvent({
      id: createId("event"),
      role: "user",
      text: "未触发自动 seal 的活跃上下文块",
      timestamp: Date.now()
    });

    const beforeClose = await blockStore.list();
    expect(beforeClose.length).toBe(0);

    await runtime.close();

    const afterClose = await blockStore.list();
    expect(afterClose.length).toBe(1);
  });
});
