export function normalizeText(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function toNormalizedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return normalizeText(value);
}

export function firstDefinedString(values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const normalized = normalizeText(value);
    if (normalized) return normalized;
  }
  return undefined;
}

export function firstDefinedRecord<T extends object>(values: Array<T | undefined>): T | undefined {
  for (const value of values) {
    if (value && typeof value === "object") return value;
  }
  return undefined;
}

export function asObjectRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

export function readHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return normalizeText(value[0]);
  }
  return normalizeText(value);
}

export function normalizeSessionId(sessionId: string | undefined): string {
  const normalized = normalizeText(sessionId);
  if (!normalized) return "default";
  return normalized;
}

export function safeJsonParse<T>(raw: string): T | undefined {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}
