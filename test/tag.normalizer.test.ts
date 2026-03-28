import { describe, expect, test } from "vitest";

import { normalizeAllowedAiTags, normalizeBlockTags } from "../src/memory/tagger/TagNormalizer.js";

describe("TagNormalizer", () => {
  test("normalizes allowed tags with trim/lowercase/dedupe", () => {
    const normalized = normalizeAllowedAiTags([" Important ", "NORMAL", "important", "	ops	"]);
    expect(normalized).toEqual(["important", "normal", "ops"]);
  });

  test("falls back to default tags when allowed tag list is empty", () => {
    const normalized = normalizeAllowedAiTags([]);
    expect(normalized).toEqual(["normal"]);
  });

  test("keeps only allowed tags and returns default when none valid", () => {
    const tags = normalizeBlockTags(["Critical", "unknown"], ["critical", "normal"]);
    expect(tags).toEqual(["critical"]);

    const fallback = normalizeBlockTags(["unknown"], ["critical", "normal"]);
    expect(fallback).toEqual(["normal"]);
  });

  test("uses first allowed tag when normal is absent", () => {
    const tags = normalizeBlockTags(undefined, ["ops", "critical"]);
    expect(tags).toEqual(["ops"]);
  });
});
