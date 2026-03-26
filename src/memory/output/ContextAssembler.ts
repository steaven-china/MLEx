import type { BlockRef, Context, MemoryEvent, PredictionResult } from "../../types.js";

export class ContextAssembler {
  assemble(
    blocks: BlockRef[],
    recentEvents: MemoryEvent[],
    prediction?: PredictionResult
  ): Context {
    const formatted = this.formatContext(blocks, recentEvents, prediction);
    return {
      blocks,
      recentEvents,
      formatted,
      prediction
    };
  }

  private formatContext(
    blocks: BlockRef[],
    recentEvents: MemoryEvent[],
    prediction?: PredictionResult
  ): string {
    const blockLines = blocks.map((block, index) => {
      const header =
        `#${index + 1} [${block.id}] score=${block.score.toFixed(3)} ` +
        `retention=${block.retentionMode ?? "raw"} match=${(block.matchScore ?? 0).toFixed(3)}`;
      const summary = block.summary ? `summary: ${block.summary}` : "summary: <empty>";
      return `${header}\n${summary}`;
    });

    const recentLines = recentEvents.map(
      (event) =>
        `${new Date(event.timestamp).toISOString()} ${event.role.toUpperCase()}: ${event.text}`
    );

    const predictionLines = prediction
      ? [
          "=== PREDICTION ===",
          `activeTrigger=${prediction.activeTrigger}`,
          `vectorDim=${prediction.vector.length}`,
          ...prediction.intents.map(
            (intent, index) =>
              `intent#${index + 1} block=${intent.blockId} conf=${intent.confidence.toFixed(3)} label=${intent.label}`
          )
        ]
      : [];

    return [
      "=== RETRIEVED BLOCKS ===",
      ...blockLines,
      "",
      "=== RECENT EVENTS ===",
      ...recentLines,
      "",
      ...predictionLines
    ].join("\n");
  }
}
