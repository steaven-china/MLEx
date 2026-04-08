import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { WorkspaceFileService } from "../src/files/WorkspaceFileService.js";

describe("WorkspaceFileService", () => {
  test("writes file with overwrite mode", async () => {
    const folder = await fs.mkdtemp(join(tmpdir(), "mlex-files-write-"));
    const service = new WorkspaceFileService({ rootPath: folder });

    const result = await service.write("notes/a.txt", "hello", {
      mode: "overwrite",
      createDirs: true
    });
    expect(result.path).toBe("notes/a.txt");
    expect(result.mode).toBe("overwrite");
    expect(result.bytesWritten).toBe(5);
    expect(result.totalBytes).toBe(5);
  });

  test("appends file content", async () => {
    const folder = await fs.mkdtemp(join(tmpdir(), "mlex-files-append-"));
    const service = new WorkspaceFileService({ rootPath: folder });

    await service.write("a.txt", "abc", { mode: "overwrite" });
    const result = await service.write("a.txt", "def", { mode: "append" });
    expect(result.totalBytes).toBe(6);
  });

  test("blocks path traversal outside root", async () => {
    const folder = await fs.mkdtemp(join(tmpdir(), "mlex-files-root-"));
    const service = new WorkspaceFileService({ rootPath: folder });

    await expect(service.write("../outside.txt", "x")).rejects.toThrow("Path escapes workspace root");
  });
});
