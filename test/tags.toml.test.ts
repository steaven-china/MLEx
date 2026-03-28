import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { loadUserTagsToml } from "../src/config/tagsToml.js";

const tempDirs: string[] = [];

async function makeTempPath(fileName = "tags.toml"): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "mlex-tags-toml-test-"));
  tempDirs.push(dir);
  return path.join(dir, fileName);
}

afterEach(async () => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("loadUserTagsToml", () => {
  test("returns empty object when file missing", () => {
    const filePath = path.join(tmpdir(), `mlex-missing-tags-${Date.now()}.toml`);
    const config = loadUserTagsToml({ filePath });
    expect(config).toEqual({});
  });

  test("loads docs and vars", async () => {
    const filePath = await makeTempPath();
    await writeFile(
      filePath,
      [
        "[docs]",
        'intro = "Tags intro"',
        'item = ["critical: production", "normal: routine"]',
        "",
        "[vars]",
        'team = "search"',
        'owner = "ops"'
      ].join("\n"),
      "utf8"
    );

    const config = loadUserTagsToml({ filePath });
    expect(config.docs?.intro).toBe("Tags intro");
    expect(config.docs?.item).toEqual(["critical: production", "normal: routine"]);
    expect(config.vars).toEqual({ team: "search", owner: "ops" });
  });

  test("throws on invalid syntax", async () => {
    const filePath = await makeTempPath();
    await writeFile(filePath, "[docs\nintro = 'x'", "utf8");

    expect(() => loadUserTagsToml({ filePath })).toThrowError(
      new RegExp(`Failed to parse tags TOML config at ${escapeRegex(filePath)}`)
    );
  });

  test("throws on invalid vars key", async () => {
    const filePath = await makeTempPath();
    await writeFile(filePath, ["[vars]", '"invalid-key" = "x"'].join("\n"), "utf8");

    expect(() => loadUserTagsToml({ filePath })).toThrowError(/must match \[A-Za-z_\]\[A-Za-z0-9_\]\*/);
  });
});

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
