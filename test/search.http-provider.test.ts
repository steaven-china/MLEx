import { afterEach, describe, expect, test, vi } from "vitest";

import { HttpSearchProvider } from "../src/search/HttpSearchProvider.js";

describe("HttpSearchProvider compatibility", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("sends generic POST payload and parses results", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              title: "Retry Pattern",
              url: "https://example.com/retry",
              snippet: "Use idempotency key",
              source: "generic"
            }
          ]
        }),
        { status: 200 }
      )
    );
    const provider = new HttpSearchProvider({
      endpoint: "https://search.example.com/api",
      apiKey: "secret-key",
      providerName: "http",
      timeoutMs: 3000
    });

    const result = await provider.search({ query: "payment retry", limit: 3 });

    expect(result.status).toBe("ok");
    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.title).toBe("Retry Pattern");
    expect(result.records[0]?.source).toBe("generic");

    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe("https://search.example.com/api");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer secret-key");
    expect(JSON.parse(String(init?.body))).toEqual({
      query: "payment retry",
      limit: 3,
      count: 3
    });
  });

  test("supports bocha flavor request/response mapping", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 200,
          data: {
            webPages: {
              value: [
                {
                  name: "Bocha Result",
                  url: "https://bocha.example.com/r1",
                  summary: "Bocha summary",
                  siteName: "bocha"
                }
              ]
            }
          }
        }),
        { status: 200 }
      )
    );
    const provider = new HttpSearchProvider({
      endpoint: "https://api.bochaai.com/v1/web-search",
      apiKey: "bocha-key",
      providerName: "http",
      timeoutMs: 3000,
      apiFlavor: "bocha",
      apiFreshness: "noLimit",
      apiSummaryEnabled: false
    });

    const result = await provider.search({ query: "OpenAI 最新模型", limit: 5 });

    expect(result.status).toBe("ok");
    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.title).toBe("Bocha Result");
    expect(result.records[0]?.snippet).toBe("Bocha summary");
    expect(result.records[0]?.source).toBe("bocha");

    const [, init] = fetchSpy.mock.calls[0] ?? [];
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer bocha-key");
    expect(JSON.parse(String(init?.body))).toEqual({
      query: "OpenAI 最新模型",
      count: 5,
      summary: false,
      freshness: "noLimit"
    });
  });

  test("supports bing flavor request/response mapping", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          webPages: {
            value: [
              {
                name: "Bing Result",
                url: "https://bing.example.com/r1",
                snippet: "Bing snippet"
              }
            ]
          }
        }),
        { status: 200 }
      )
    );
    const provider = new HttpSearchProvider({
      endpoint: "https://api.bing.microsoft.com/v7.0/search",
      apiKey: "bing-key",
      providerName: "http",
      timeoutMs: 3000,
      apiFlavor: "bing",
      apiFreshness: "Week",
      apiMarket: "zh-CN"
    });

    const result = await provider.search({ query: "MLEX", limit: 4 });

    expect(result.status).toBe("ok");
    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.title).toBe("Bing Result");
    expect(result.records[0]?.snippet).toBe("Bing snippet");

    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(String(url)).toContain("https://api.bing.microsoft.com/v7.0/search?");
    expect(String(url)).toContain("q=MLEX");
    expect(String(url)).toContain("count=4");
    expect(String(url)).toContain("mkt=zh-CN");
    expect(String(url)).toContain("freshness=Week");
    expect(init?.method).toBe("GET");
    expect((init?.headers as Record<string, string>)["Ocp-Apim-Subscription-Key"]).toBe("bing-key");
  });

  test("auto flavor infers bocha mode by endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            webPages: {
              value: []
            }
          }
        }),
        { status: 200 }
      )
    );
    const provider = new HttpSearchProvider({
      endpoint: "https://api.bochaai.com/v1/web-search",
      providerName: "http",
      timeoutMs: 3000,
      apiFlavor: "auto"
    });

    const result = await provider.search({ query: "compat", limit: 2 });

    expect(result.status).toBe("ok_empty");
    const [, init] = fetchSpy.mock.calls[0] ?? [];
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      query: "compat",
      count: 2,
      summary: true
    });
  });
});

