export const DEFAULT_ALLOWED_AI_TAGS = ["important", "normal"];

export function normalizeAllowedAiTags(tags: readonly string[] | undefined): string[] {
  const normalized = (tags ?? DEFAULT_ALLOWED_AI_TAGS)
    .map((tag) => sanitizeTag(tag))
    .filter((tag): tag is string => Boolean(tag));
  const deduped = [...new Set(normalized)];
  return deduped.length > 0 ? deduped : ["normal"];
}

export function normalizeBlockTags(tags: unknown, allowedTags: readonly string[] | undefined): string[] {
  const allowed = new Set(normalizeAllowedAiTags(allowedTags));
  const output: string[] = [];
  if (Array.isArray(tags)) {
    for (const rawTag of tags) {
      if (typeof rawTag !== "string") continue;
      const tag = sanitizeTag(rawTag);
      if (!tag || !allowed.has(tag) || output.includes(tag)) continue;
      output.push(tag);
    }
  }

  if (output.length > 0) return output;
  return [defaultTag(allowed)];
}

function defaultTag(allowed: Set<string>): string {
  if (allowed.has("normal")) return "normal";
  const first = allowed.values().next().value;
  return typeof first === "string" && first.length > 0 ? first : "normal";
}

function sanitizeTag(tag: string): string {
  return tag.trim().toLowerCase();
}
