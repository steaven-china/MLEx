export interface WebPageFetchResult {
  url: string;
  title?: string;
  content: string;
  fetchedAt: number;
}

export interface IWebPageFetcher {
  fetch(url: string): Promise<WebPageFetchResult>;
}
