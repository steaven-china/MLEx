import type { RetrievalHit, RetrievalInput } from "./types.js";

export interface IBlockRetriever {
  retrieve(input: RetrievalInput): Promise<RetrievalHit[]>;
}
