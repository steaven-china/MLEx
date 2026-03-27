import type { SearchQuery, SearchRecord, ISearchProvider } from "./ISearchProvider.js";

interface HttpSearchProviderConfig {
  endpoint?: string;
  apiKey?: string;
  providerName: string;
  timeoutMs: number;
}

interface SearchApiResponse {
  results?: Array<{
    title?: string;
    url?: string;
    snippet?: string;
    source?: string;
  }>;
}

export class HttpSearchProvider implements ISearchProvider {
  constructor(private readonly config: HttpSearchProviderConfig) {}

  async search(input: SearchQuery): Promise<SearchRecord[]> {
    const endpoint = this.config.endpoint?.trim();
    if (!endpoint) return [];

    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.config.timeoutMs);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {})
        },
        body: JSON.stringify({
          query: input.query,
          limit: input.limit
        }),
        signal: controller.signal
      });
      if (!response.ok) {
        return [];
      }
      const payload = (await response.json()) as SearchApiResponse;
      const now = Date.now();
      return (payload.results ?? [])
        .slice(0, input.limit)
        .map((item, index) => ({
          title: (item.title ?? "").trim(),
          url: (item.url ?? "").trim(),
          snippet: (item.snippet ?? "").trim(),
          source: (item.source ?? this.config.providerName).trim(),
          rank: index + 1,
          fetchedAt: now
        }))
        .filter((item) => item.url.length > 0 && (item.title.length > 0 || item.snippet.length > 0));
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
    }
  }
}
