import type { IEmbedder, EmbedOptions } from "./IEmbedder.js";

/**
 * Batch-capable pipeline interface.
 * Single string → { data: ArrayLike<number> }
 * String array  → { dims: number[]; data: ArrayLike<number> }  (shape [N, hidden])
 */
interface EmbeddingPipeline {
  (
    text: string,
    options: { pooling: string; normalize: boolean }
  ): Promise<{ data: ArrayLike<number> }>;
  (
    text: string[],
    options: { pooling: string; normalize: boolean }
  ): Promise<{ dims: number[]; data: ArrayLike<number> }>;
}

export interface LocalEmbedderConfig {
  /** HuggingFace model id — must support feature-extraction.
   *  Default: "Xenova/multilingual-e5-small" (384-dim, Chinese+English). */
  model?: string;
  /** Use quantized (int8) ONNX weights.  Smaller download, faster inference.
   *  Default: true. */
  quantized?: boolean;
  /**
   * Base URL for model downloads.  Override to use a mirror (e.g.
   * "https://hf-mirror.com/" for users in mainland China).
   * Default: HuggingFace Hub ("https://huggingface.co/").
   */
  mirror?: string;
}

/**
 * Semantic text embedder backed by @xenova/transformers.
 *
 * **Lazy**: the ONNX model is downloaded and loaded on the *first* call to
 * `embed()`, not at construction time.  Subsequent calls reuse the same
 * pipeline instance.
 *
 * **Static pipeline cache**: all LocalEmbedder instances sharing the same
 * model name reuse one ONNX session — critical when many runtimes are created
 * in the same process (e.g. eval bench with hundreds of cases).
 *
 * **Batch support**: `embedBatch()` sends N texts in a single ONNX forward
 * pass, which is 3-8× faster than N sequential `embed()` calls.
 */
export class LocalEmbedder implements IEmbedder {
  // Static cache keyed by "modelName:quantized" so all instances share one session.
  private static readonly pipelineCache = new Map<
    string,
    Promise<EmbeddingPipeline>
  >();

  private readonly modelName: string;
  private readonly quantized: boolean;
  private readonly mirror: string | undefined;
  private readonly cacheKey: string;

  constructor(config: LocalEmbedderConfig = {}) {
    this.modelName = config.model ?? "Xenova/multilingual-e5-small";
    this.quantized = config.quantized ?? true;
    this.mirror = config.mirror;
    this.cacheKey = `${this.modelName}:${this.quantized}`;
  }

  // ------------------------------------------------------------------ //
  //  Public API                                                          //
  // ------------------------------------------------------------------ //

  // Auto-batcher: accumulates embed() calls that arrive within `batchWindowMs`
  // and flushes them together as one ONNX forward pass.
  private batchQueue: Array<{
    text: string;
    resolve: (vec: number[]) => void;
    reject: (err: unknown) => void;
  }> = [];
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly batchWindowMs = 5; // flush after 5ms of inactivity
  private readonly maxBatchSize = 32;  // cap to avoid OOM on huge batches

  async embed(text: string, _options?: EmbedOptions): Promise<number[]> {
    return new Promise<number[]>((resolve, reject) => {
      this.batchQueue.push({ text, resolve, reject });

      // If batch is full, flush immediately
      if (this.batchQueue.length >= this.maxBatchSize) {
        if (this.batchTimer !== null) {
          clearTimeout(this.batchTimer);
          this.batchTimer = null;
        }
        void this.flushBatch();
        return;
      }

      // Otherwise, schedule a flush after the window
      if (this.batchTimer === null) {
        this.batchTimer = setTimeout(() => {
          this.batchTimer = null;
          void this.flushBatch();
        }, this.batchWindowMs);
      }
    });
  }

  private async flushBatch(): Promise<void> {
    if (this.batchQueue.length === 0) return;
    const batch = this.batchQueue.splice(0, this.maxBatchSize);

    try {
      const texts = batch.map(item => item.text);
      const vecs = await this.embedBatch(texts);
      for (let i = 0; i < batch.length; i++) {
        batch[i]!.resolve(vecs[i]!);
      }
    } catch (err) {
      for (const item of batch) item.reject(err);
    }
  }

  /**
   * Embed multiple texts in a single ONNX forward pass.
   * 3-8× faster than calling embed() N times sequentially.
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    if (texts.length === 1) return [await this.embed(texts[0]!)];

    const pipe = await this.getPipeline();
    const result = await (pipe as (t: string[], o: object) => Promise<{ dims: number[]; data: ArrayLike<number> }>)(
      texts,
      { pooling: "mean", normalize: true }
    );

    // result.dims = [batchSize, hiddenDim]
    const hiddenDim = result.dims[1]!;
    const flat = Array.from(result.data);
    return texts.map((_, i) => flat.slice(i * hiddenDim, (i + 1) * hiddenDim));
  }

  // ------------------------------------------------------------------ //
  //  Static pipeline management                                          //
  // ------------------------------------------------------------------ //

  private getPipeline(): Promise<EmbeddingPipeline> {
    const cached = LocalEmbedder.pipelineCache.get(this.cacheKey);
    if (cached) return cached;

    const promise = this.loadPipeline().catch((err: unknown) => {
      // Remove from cache on failure so the next call retries.
      LocalEmbedder.pipelineCache.delete(this.cacheKey);
      throw err;
    });
    LocalEmbedder.pipelineCache.set(this.cacheKey, promise);
    return promise;
  }

  private async loadPipeline(): Promise<EmbeddingPipeline> {
    const { pipeline, env } = await import("@xenova/transformers");

    if (this.mirror) {
      (env as { remoteHost?: string }).remoteHost = this.mirror;
    }

    const pipe = await pipeline("feature-extraction", this.modelName, {
      quantized: this.quantized
    });
    return pipe as unknown as EmbeddingPipeline;
  }
}
