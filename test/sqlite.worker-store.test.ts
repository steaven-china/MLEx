import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { MemoryBlock } from "../src/memory/MemoryBlock.js";
import { SQLiteWorkerClient } from "../src/memory/sqlite-worker/SQLiteWorkerClient.js";
import { SQLiteWorkerBlockStore } from "../src/memory/store/SQLiteWorkerBlockStore.js";
import { SQLiteWorkerRawEventStore } from "../src/memory/raw/SQLiteWorkerRawEventStore.js";
import { SQLiteWorkerRelationStore } from "../src/memory/relation/SQLiteWorkerRelationStore.js";
import { RelationType } from "../src/types.js";

const clients: SQLiteWorkerClient[] = [];

afterEach(async () => {
  while (clients.length > 0) {
    const client = clients.pop();
    if (!client) continue;
    await client.close();
  }
});

describe("SQLite worker stores", () => {
  test("block store keeps getMany caller order", async () => {
    const folder = await fs.mkdtemp(join(tmpdir(), "mlex-worker-blockstore-"));
    const sqliteFile = join(folder, "memory.db");

    const worker = new SQLiteWorkerClient({ filePath: sqliteFile, allowedAiTags: ["critical", "normal"] });
    clients.push(worker);
    const store = new SQLiteWorkerBlockStore(worker);

    const b1 = new MemoryBlock("block_1", 1000);
    b1.summary = "first";
    b1.endTime = 1100;
    const b2 = new MemoryBlock("block_2", 2000);
    b2.summary = "second";
    b2.endTime = 2100;

    await store.upsert(b1);
    await store.upsert(b2);

    const blocks = await store.getMany(["block_2", "block_1", "block_2"]);
    expect(blocks.map((item) => item.id)).toEqual(["block_2", "block_1", "block_2"]);
  });

  test("raw and relation stores persist via worker", async () => {
    const folder = await fs.mkdtemp(join(tmpdir(), "mlex-worker-rawrelation-"));
    const sqliteFile = join(folder, "memory.db");

    const worker = new SQLiteWorkerClient({ filePath: sqliteFile });
    clients.push(worker);

    const rawStore = new SQLiteWorkerRawEventStore(worker);
    const relationStore = new SQLiteWorkerRelationStore(worker);

    await rawStore.put("block-x", [
      {
        id: "e-1",
        role: "user",
        text: "hello",
        timestamp: 1
      }
    ]);
    const raw = await rawStore.get("block-x");
    expect(raw?.[0]?.id).toBe("e-1");

    await relationStore.add({
      src: "block-x",
      dst: "block-y",
      type: RelationType.FOLLOWS,
      timestamp: 123,
      confidence: 0.9
    });

    const outgoing = await relationStore.listOutgoing("block-x");
    expect(outgoing.length).toBe(1);
    expect(outgoing[0]?.dst).toBe("block-y");
  });
});
