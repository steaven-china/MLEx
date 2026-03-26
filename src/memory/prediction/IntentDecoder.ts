import type { PredictedIntent } from "../../types.js";
import type { MemoryBlock } from "../MemoryBlock.js";

export class IntentDecoder {
  decode(
    transitions: Map<string, number>,
    blockById: Map<string, MemoryBlock>,
    topK: number
  ): PredictedIntent[] {
    const ranked = [...transitions.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK);

    return ranked.map(([blockId, confidence]) => {
      const block = blockById.get(blockId);
      return {
        blockId,
        confidence,
        label: buildLabel(block)
      };
    });
  }
}

function buildLabel(block: MemoryBlock | undefined): string {
  if (!block) return "unknown-intent";
  if (block.keywords.length > 0) {
    return block.keywords.slice(0, 3).join("/");
  }
  if (block.summary) {
    return block.summary.slice(0, 24);
  }
  return block.id;
}
