const EN_STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "is",
  "are",
  "was",
  "were",
  "to",
  "of",
  "for",
  "in",
  "on",
  "at",
  "and",
  "or",
  "if",
  "it",
  "this",
  "that",
  "with",
  "as",
  "be",
  "by",
  "from",
  "we",
  "you",
  "i",
  "they",
  "he",
  "she",
  "but",
  "not",
  "do",
  "did",
  "done",
  "have",
  "has",
  "had"
]);

const ZH_STOPWORDS = new Set([
  "的",
  "了",
  "和",
  "是",
  "在",
  "我",
  "你",
  "他",
  "她",
  "它",
  "我们",
  "你们",
  "他们",
  "这",
  "那",
  "一个",
  "一下",
  "然后",
  "以及",
  "或者",
  "并且",
  "如果",
  "因为",
  "所以"
]);

export function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

export function tokenize(text: string): string[] {
  const normalized = normalizeText(text);
  return normalized
    .split(/[^\p{L}\p{N}_]+/u)
    .map((token) => token.trim())
    .filter(Boolean);
}

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

export function extractKeywords(text: string, topN = 8): string[] {
  const counts = new Map<string, number>();
  for (const token of tokenize(text)) {
    if (token.length <= 1) continue;
    if (EN_STOPWORDS.has(token) || ZH_STOPWORDS.has(token)) continue;
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([token]) => token);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let aNorm = 0;
  let bNorm = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    aNorm += a[i] * a[i];
    bNorm += b[i] * b[i];
  }
  if (aNorm === 0 || bNorm === 0) return 0;
  return dot / (Math.sqrt(aNorm) * Math.sqrt(bNorm));
}

export function hasDirectionalIntent(text: string): boolean {
  const hints = [
    "before",
    "after",
    "cause",
    "because",
    "next",
    "previous",
    "parent",
    "child",
    "related",
    "之前",
    "之后",
    "原因",
    "导致",
    "后续",
    "上一步",
    "下一步",
    "关联",
    "依赖"
  ];
  const normalized = normalizeText(text);
  return hints.some((hint) => normalized.includes(hint));
}
