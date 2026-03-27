export interface SearchRecord {
  title: string;
  url: string;
  snippet: string;
  source?: string;
  rank: number;
  fetchedAt: number;
}

export interface SearchQuery {
  query: string;
  limit: number;
}

export interface ISearchProvider {
  search(input: SearchQuery): Promise<SearchRecord[]>;
}
