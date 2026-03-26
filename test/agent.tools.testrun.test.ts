import { describe, expect, test } from "vitest";

import { BuiltinAgentToolExecutor } from "../src/agent/AgentToolExecutor.js";
import { createRuntime } from "../src/container.js";

describe("BuiltinAgentToolExecutor test.run", () => {
  test("returns error payload instead of throwing when process spawn fails", async () => {
    const runtime = createRuntime();
    const tool = new BuiltinAgentToolExecutor({
      workspaceRoot: "__mlex_nonexistent_workspace__",
      memoryManager: runtime.memoryManager
    });

    const result = await tool.execute({
      name: "test.run",
      args: {
        script: "test"
      }
    });

    expect(result.ok).toBe(false);
    const payload = JSON.parse(result.content) as {
      script?: string;
      timeoutMs?: number;
      error?: string;
      exitCode?: number;
    };
    expect(payload.script).toBe("test");
    expect(typeof payload.timeoutMs).toBe("number");
    if (typeof payload.error === "string") {
      expect(payload.error.length).toBeGreaterThan(0);
      return;
    }
    expect(typeof payload.exitCode).toBe("number");
  });
});
