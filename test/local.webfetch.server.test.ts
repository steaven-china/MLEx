import { afterEach, describe, expect, test, vi } from "vitest";

import { startLocalWebFetchServer, type StartedLocalWebFetchServer } from "../src/tools/localWebFetchServer.js";

describe("Local webfetch server", () => {
  let started: StartedLocalWebFetchServer | undefined;
  const nativeFetch = globalThis.fetch.bind(globalThis);
  const resolveInputUrl = (input: unknown): string => {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.href;
    if (input && typeof input === "object" && "url" in input) {
      const value = (input as { url?: unknown }).url;
      if (typeof value === "string") return value;
    }
    return "";
  };

  afterEach(async () => {
    vi.restoreAllMocks();
    if (started) {
      await started.close();
      started = undefined;
    }
  });

  test("fetches and normalizes html body text", async () => {
    vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit): Promise<Response> => {
      const requestUrl = resolveInputUrl(input);
      if (requestUrl.startsWith("https://example.com/")) {
        return new Response(
          "<html><head><title>Demo</title></head><body><h1>Hello</h1><script>bad()</script><p>World</p></body></html>",
          {
            status: 200,
            headers: {
              "content-type": "text/html; charset=utf-8"
            }
          }
        );
      }
      return nativeFetch(input as Parameters<typeof fetch>[0], init);
    });
    started = await startLocalWebFetchServer({
      host: "127.0.0.1",
      port: 0,
      requestTimeoutMs: 5000,
      bodyMaxBytes: 65536,
      maxContentChars: 5000,
      userAgent: "test-agent"
    });

    const response = await fetch(`${started.url}/fetch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/demo" })
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { title?: string; content?: string; url?: string };
    expect(payload.title).toBe("Demo");
    expect(payload.content).toBe("Hello World");
    expect(payload.url).toBe("https://example.com/demo");
  });

  test("enforces bearer auth when api key is configured", async () => {
    vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit): Promise<Response> => {
      const requestUrl = resolveInputUrl(input);
      if (requestUrl.startsWith("https://example.com/")) {
        return new Response("ok", {
          status: 200,
          headers: {
            "content-type": "text/plain"
          }
        });
      }
      return nativeFetch(input as Parameters<typeof fetch>[0], init);
    });
    started = await startLocalWebFetchServer({
      host: "127.0.0.1",
      port: 0,
      apiKey: "local-key",
      requestTimeoutMs: 5000,
      bodyMaxBytes: 65536,
      maxContentChars: 5000,
      userAgent: "test-agent"
    });

    const unauthorized = await fetch(`${started.url}/fetch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/demo" })
    });
    expect(unauthorized.status).toBe(401);

    const authorized = await fetch(`${started.url}/fetch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer local-key"
      },
      body: JSON.stringify({ url: "https://example.com/demo" })
    });
    expect(authorized.status).toBe(200);
  });
});
