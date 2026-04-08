import type { SearchQuery, SearchRecord, SearchResponse, ISearchProvider } from "./ISearchProvider.js";

interface HttpSearchProviderConfig {
  endpoint?: string;
  apiKey?: string;
  providerName: string;
  timeoutMs: number;
  apiFlavor?: "generic" | "bocha" | "bing" | "auto";
  apiFreshness?: string;
  apiSummaryEnabled?: boolean;
  apiMarket?: string;
}

type ResolvedApiFlavor = "generic" | "bocha" | "bing";

export class HttpSearchProvider implements ISearchProvider {
  constructor(private readonly config: HttpSearchProviderConfig) {}

  async search(input: SearchQuery): Promise<SearchResponse> {
    const endpoint = this.config.endpoint?.trim();
    if (!endpoint) {
      return {
        records: [],
        status: "not_configured",
        error: "search endpoint is not configured"
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.config.timeoutMs);

    try {
      const flavor = this.resolveApiFlavor(endpoint);
      const request = this.buildRequest(endpoint, input, flavor);
      const response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        signal: controller.signal
      });
      if (!response.ok) {
        return {
          records: [],
          status: "http_error",
          error: `search provider http error: ${response.status}`,
          httpStatus: response.status
        };
      }
      const payload = (await response.json()) as unknown;
      const now = Date.now();
      const records: SearchRecord[] = this.extractResultItems(payload)
        .slice(0, input.limit)
        .map((item, index) => ({
          title: this.pickFirstString(item, ["title", "name", "heading"]),
          url: this.pickFirstString(item, ["url", "link", "targetUrl"]),
          snippet: this.pickFirstString(item, ["snippet", "summary", "description"]),
          source: this.pickFirstString(item, ["source", "siteName", "provider"]) || this.config.providerName,
          rank: index + 1,
          fetchedAt: now
        }))
        .filter((item) => item.url.length > 0 && (item.title.length > 0 || item.snippet.length > 0));
      return {
        records,
        status: records.length === 0 ? "ok_empty" : "ok"
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        records: [],
        status: "request_error",
        error: `search provider request error: ${message}`
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private resolveApiFlavor(endpoint: string): ResolvedApiFlavor {
    const configured = this.config.apiFlavor ?? "generic";
    if (configured !== "auto") return configured;
    const normalized = endpoint.toLowerCase();
    if (normalized.includes("bochaai")) return "bocha";
    if (normalized.includes("bing.microsoft.com") || normalized.includes("/v7.0/search")) return "bing";
    return "generic";
  }

  private buildRequest(
    endpoint: string,
    input: SearchQuery,
    flavor: ResolvedApiFlavor
  ): { url: string; method: "GET" | "POST"; headers: Record<string, string>; body?: string } {
    if (flavor === "bing") {
      const queryParams: Record<string, string> = {
        q: input.query,
        count: String(input.limit)
      };
      const market = this.normalizeString(this.config.apiMarket);
      if (market) {
        queryParams.mkt = market;
      }
      const freshness = this.normalizeString(this.config.apiFreshness);
      if (freshness) {
        queryParams.freshness = freshness;
      }
      return {
        url: this.appendQueryParams(endpoint, queryParams),
        method: "GET",
        headers: this.buildHeaders(flavor, false)
      };
    }

    const body =
      flavor === "bocha"
        ? this.buildBochaRequestBody(input)
        : JSON.stringify({
            query: input.query,
            limit: input.limit,
            count: input.limit
          });
    return {
      url: endpoint,
      method: "POST",
      headers: this.buildHeaders(flavor, true),
      body
    };
  }

  private buildBochaRequestBody(input: SearchQuery): string {
    const payload: Record<string, unknown> = {
      query: input.query,
      count: input.limit,
      summary: this.config.apiSummaryEnabled ?? true
    };
    const freshness = this.normalizeString(this.config.apiFreshness);
    if (freshness) {
      payload.freshness = freshness;
    }
    return JSON.stringify(payload);
  }

  private buildHeaders(flavor: ResolvedApiFlavor, withJsonContentType: boolean): Record<string, string> {
    const headers: Record<string, string> = {};
    if (withJsonContentType) {
      headers["Content-Type"] = "application/json";
    }
    const apiKey = this.normalizeString(this.config.apiKey);
    if (!apiKey) return headers;
    if (flavor === "bing") {
      headers["Ocp-Apim-Subscription-Key"] = apiKey;
      return headers;
    }
    headers.Authorization = `Bearer ${apiKey}`;
    return headers;
  }

  private extractResultItems(payload: unknown): Array<Record<string, unknown>> {
    const root = this.toRecord(payload);
    if (!root) return [];

    const candidates = [
      this.toRecordArray(root.results),
      this.toRecordArray(root.items),
      this.toRecordArray(this.toRecord(root.webPages)?.value),
      this.toRecordArray(this.toRecord(root.data)?.results),
      this.toRecordArray(this.toRecord(this.toRecord(root.data)?.webPages)?.value)
    ];
    for (const items of candidates) {
      if (items.length > 0) return items;
    }
    return [];
  }

  private pickFirstString(item: Record<string, unknown>, keys: string[]): string {
    for (const key of keys) {
      const value = item[key];
      if (typeof value === "string" && value.trim().length > 0) {
        return value.trim();
      }
    }
    return "";
  }

  private toRecord(value: unknown): Record<string, unknown> | undefined {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    return value as Record<string, unknown>;
  }

  private toRecordArray(value: unknown): Array<Record<string, unknown>> {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is Record<string, unknown> => {
      return typeof item === "object" && item !== null && !Array.isArray(item);
    });
  }

  private appendQueryParams(baseUrl: string, query: Record<string, string>): string {
    const queryEntries = Object.entries(query).filter(([, value]) => value.trim().length > 0);
    if (queryEntries.length === 0) return baseUrl;
    try {
      const url = new URL(baseUrl);
      for (const [key, value] of queryEntries) {
        url.searchParams.set(key, value);
      }
      return url.toString();
    } catch {
      const suffix = new URLSearchParams(queryEntries).toString();
      if (suffix.length === 0) return baseUrl;
      return baseUrl.includes("?") ? `${baseUrl}&${suffix}` : `${baseUrl}?${suffix}`;
    }
  }

  private normalizeString(value: string | undefined): string {
    return typeof value === "string" ? value.trim() : "";
  }
}
