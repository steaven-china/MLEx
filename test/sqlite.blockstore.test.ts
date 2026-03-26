import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { MemoryBlock } from "../src/memory/MemoryBlock.js";
import { SQLiteDatabase } from "../src/memory/sqlite/SQLiteDatabase.js";
import { SQLiteBlockStore } from "../src/memory/store/SQLiteBlockStore.js";

describe("SQLiteBlockStore getMany", () => {
  test("keeps caller order (including duplicates)", async () => {
    const folder = await fs.mkdtemp(join(tmpdir(), "mlex-sqlite-blockstore-"));
    const sqliteFile = join(folder, "memory.db");
    const sqlite = new SQLiteDatabase({ filePath: sqliteFile });
    try {
      const store = new SQLiteBlockStore(sqlite);

      const b1 = new MemoryBlock("block_1", 1000);
      b1.summary = "first";
      b1.endTime = 1100;
      const b2 = new MemoryBlock("block_2", 2000);
      b2.summary = "second";
      b2.endTime = 2100;

      store.upsert(b1);
      store.upsert(b2);

      const blocks = store.getMany(["block_2", "block_1", "block_2"]);
      expect(blocks.map((item) => item.id)).toEqual(["block_2", "block_1", "block_2"]);
    } finally {
      sqlite.close();
    }
  });
});
