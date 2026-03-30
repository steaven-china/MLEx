import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { RelationType } from "../src/types.js";
import { FileRelationStore } from "../src/memory/relation/FileRelationStore.js";
import { InMemoryRelationStore } from "../src/memory/relation/InMemoryRelationStore.js";
import type { IRelationStore } from "../src/memory/relation/IRelationStore.js";
import { SQLiteRelationStore } from "../src/memory/relation/SQLiteRelationStore.js";
import { SQLiteDatabase } from "../src/memory/sqlite/SQLiteDatabase.js";

describe("RelationStore contract", () => {
  test("in-memory store", async () => {
    const store = new InMemoryRelationStore();
    await assertContract(store);
  });

  test("file store", async () => {
    const folder = await fs.mkdtemp(join(tmpdir(), "mlex-relation-file-"));
    const filePath = join(folder, "relations.json");
    const store = new FileRelationStore({ filePath });
    try {
      await assertContract(store);
    } finally {
      await fs.rm(folder, { recursive: true, force: true });
    }
  });

  test("sqlite store", async () => {
    const folder = await fs.mkdtemp(join(tmpdir(), "mlex-relation-sqlite-"));
    const sqlite = new SQLiteDatabase({ filePath: join(folder, "memory.db") });
    const store = new SQLiteRelationStore(sqlite);
    try {
      await assertContract(store);
    } finally {
      sqlite.close();
      await fs.rm(folder, { recursive: true, force: true });
    }
  });
});

async function assertContract(store: IRelationStore): Promise<void> {
  await store.add({
    src: "a",
    dst: "b",
    type: RelationType.CONTEXT,
    timestamp: 100,
    confidence: 0.4
  });
  await store.add({
    src: "a",
    dst: "b",
    type: RelationType.CONTEXT,
    timestamp: 120,
    confidence: 0.9
  });
  await store.add({
    src: "b",
    dst: "c",
    type: RelationType.FOLLOWS,
    timestamp: 130,
    confidence: 0.6
  });
  await store.add({
    src: "",
    dst: "b",
    type: "name",
    timestamp: 140,
    confidence: 0.7
  });
  await store.add({
    src: "a",
    dst: "",
    type: "events",
    timestamp: 150,
    confidence: 0.8
  });

  const outgoingA = await store.listOutgoing("a");
  const ab = outgoingA.find((relation) => relation.dst === "b" && relation.type === RelationType.CONTEXT);

  expect(outgoingA).toHaveLength(2);
  expect(outgoingA.some((relation) => relation.dst === "" && relation.type === "events")).toBe(true);
  expect(ab?.timestamp).toBe(120);
  expect(ab?.confidence).toBe(0.9);

  const incomingB = await store.listIncoming("b");
  expect(incomingB.some((relation) => relation.src === "a" && relation.type === RelationType.CONTEXT)).toBe(true);
  expect(incomingB.some((relation) => relation.src === "" && relation.type === "name")).toBe(true);

  const outgoingEmpty = await store.listOutgoing("");
  expect(outgoingEmpty.some((relation) => relation.dst === "b" && relation.type === "name")).toBe(true);

  const incomingEmpty = await store.listIncoming("");
  expect(incomingEmpty.some((relation) => relation.src === "a" && relation.type === "events")).toBe(true);

  const all = await store.listAll();
  expect(all).toHaveLength(4);
  expect(all.some((relation) => relation.src === "a" && relation.dst === "b")).toBe(true);
  expect(all.some((relation) => relation.src === "b" && relation.dst === "c")).toBe(true);
  expect(all.some((relation) => relation.src === "" && relation.dst === "b" && relation.type === "name")).toBe(true);
  expect(all.some((relation) => relation.src === "a" && relation.dst === "" && relation.type === "events")).toBe(true);
}
