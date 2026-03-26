import { afterEach, describe, expect, test, vi } from "vitest";

import { DeepSeekReasonerProvider } from "../src/agent/DeepSeekReasonerProvider.js";
import { createRuntime } from "../src/container.js";

describe("DeepSeekReasonerProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test("generates text via chat completions", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: "DeepSeek answer"
            }
          }
        ]
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new DeepSeekReasonerProvider({
      apiKey: "test-key",
      model: "deepseek-reasoner"
    });

    const text = await provider.generate([
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "hello" }
    ]);
    expect(text).toBe("DeepSeek answer");
  });

  test("streams tokens from sse chunks", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode('data: {"choices":[{"delta":{"content":"deep"}}]}\n\n')
        );
        controller.enqueue(
          encoder.encode('data: {"choices":[{"delta":{"content":"seek"}}]}\n\n')
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(stream, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const provider = new DeepSeekReasonerProvider({
      apiKey: "test-key"
    });

    let collected = "";
    const text = await provider.generateStream!(
      [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "hello" }
      ],
      (token) => {
        collected += token;
      }
    );

    expect(text).toBe("deepseek");
    expect(collected).toBe("deepseek");
  });

  test("runtime resolves deepseek provider", () => {
    const runtime = createRuntime({
      service: {
        provider: "deepseek-reasoner",
        deepseekApiKey: "test-key"
      }
    });
    const provider = runtime.container.resolve("provider");
    expect(provider).toBeInstanceOf(DeepSeekReasonerProvider);
  });
});
