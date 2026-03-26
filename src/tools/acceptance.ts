import { strict as assert } from "node:assert";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { AppConfig, DeepPartial } from "../config.js";
import { startWebServer, type StartedWebServer } from "../web/server.js";

interface ChatResponse {
  reply?: string;
  context?: string;
  blocks?: Array<Record<string, unknown>>;
  prediction?: Record<string, unknown> | null;
}

async function main(): Promise<void> {
  const tempDir = await fs.mkdtemp(join(tmpdir(), "mlex-acceptance-"));
  const sqliteFile = join(tempDir, "memory.db");

  const overrides: DeepPartial<AppConfig> = {
    service: {
      provider: "rule-based"
    },
    component: {
      storageBackend: "sqlite",
      sqliteFilePath: sqliteFile,
      rawStoreBackend: "sqlite",
      relationStoreBackend: "sqlite",
      graphEmbeddingMethod: "transe",
      relationExtractor: "heuristic"
    },
    manager: {
      maxTokensPerBlock: 96,
      minTokensPerBlock: 24,
      predictionEnabled: true,
      predictionActiveThreshold: 0.05
    }
  };

  let server: StartedWebServer | undefined;
  try {
    server = await startWebServer({
      host: "127.0.0.1",
      port: 0,
      runtimeOverrides: overrides
    });

    log(`server started: ${server.url}`);
    await verifyHealth(server.url);
    await runConversation(server.url);
    await verifyStreaming(server.url);
    await verifySqlitePersistence(sqliteFile);

    await server.close();
    server = undefined;

    const restarted = await startWebServer({
      host: "127.0.0.1",
      port: 0,
      runtimeOverrides: overrides
    });
    log(`server restarted: ${restarted.url}`);

    const contextAfterRestart = await postChat(restarted.url, "重启后回顾之前任务的下一步");
    assert((contextAfterRestart.blocks?.length ?? 0) > 0, "restart retrieval returned no blocks");
    log("restart persistence check passed");
    await restarted.close();

    log("ACCEPTANCE PASS ✅");
  } catch (error) {
    console.error("ACCEPTANCE FAIL ❌");
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (server) {
      await server.close();
    }
  }
}

async function verifyHealth(baseUrl: string): Promise<void> {
  const response = await fetch(`${baseUrl}/healthz`);
  assert.equal(response.status, 200, "health endpoint failed");
  const payload = (await response.json()) as { ok?: boolean };
  assert.equal(payload.ok, true, "health payload mismatch");
  log("health check passed");
}

async function runConversation(baseUrl: string): Promise<void> {
  await postChat(baseUrl, "任务A：先完成需求分析并拆解里程碑。");
  await postSeal(baseUrl);
  await postChat(baseUrl, "任务B：根据分析结果设计接口与数据流。");
  await postSeal(baseUrl);
  await postChat(baseUrl, "任务C：开始实现并联调，关注回滚策略。");
  await postSeal(baseUrl);

  const response = await postChat(baseUrl, "下一步是什么？请关联之前步骤");
  assert.equal(typeof response.reply, "string", "chat reply missing");
  assert.equal(typeof response.context, "string", "context missing");
  assert((response.blocks?.length ?? 0) > 0, "context blocks missing");
  assert("prediction" in response, "prediction field missing");
  assert(
    response.prediction === null || typeof response.prediction === "object",
    "prediction payload invalid"
  );
  const hasRetention = (response.blocks ?? []).some((block) => "retentionMode" in block);
  assert.equal(hasRetention, true, "retention metadata missing from blocks");
  log("conversation/context check passed");
}

async function verifyStreaming(baseUrl: string): Promise<void> {
  const response = await fetch(`${baseUrl}/api/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "请流式返回并附带完整上下文" })
  });
  assert.equal(response.status, 200, "stream endpoint failed");
  const contentType = response.headers.get("content-type") ?? "";
  assert(contentType.includes("text/event-stream"), "stream content-type mismatch");

  const text = await response.text();
  const frames = parseSseFrames(text);
  const tokenFrame = frames.find((frame) => frame.event === "token");
  const doneFrame = frames.find((frame) => frame.event === "done");
  assert(tokenFrame, "stream token event missing");
  assert(doneFrame, "stream done event missing");

  const doneData = doneFrame?.data ?? {};
  assert.equal(typeof doneData.context, "string", "stream done context missing");
  assert(Array.isArray(doneData.blocks), "stream done blocks missing");
  assert("prediction" in doneData, "stream done prediction missing");
  log("stream check passed");
}

async function verifySqlitePersistence(sqliteFile: string): Promise<void> {
  await fs.access(sqliteFile);
  const db = new DatabaseSync(sqliteFile);
  const blockCount = (db.prepare("SELECT COUNT(*) AS count FROM blocks").get() as { count: number })
    .count;
  const rawCount = (
    db.prepare("SELECT COUNT(*) AS count FROM raw_events").get() as {
      count: number;
    }
  ).count;
  const relationCount = (db.prepare("SELECT COUNT(*) AS count FROM relations").get() as {
    count: number;
  }).count;
  db.close();

  assert(blockCount > 0, "persisted blocks empty");
  assert(rawCount > 0, "persisted raw-events empty");
  assert(relationCount > 0, "persisted relations empty");
  log("sqlite persistence check passed");
}

async function postChat(baseUrl: string, message: string): Promise<ChatResponse> {
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message })
  });
  assert.equal(response.status, 200, "chat endpoint failed");
  return (await response.json()) as ChatResponse;
}

async function postSeal(baseUrl: string): Promise<void> {
  const response = await fetch(`${baseUrl}/api/seal`, {
    method: "POST"
  });
  assert.equal(response.status, 200, "seal endpoint failed");
}

function parseSseFrames(raw: string): Array<{ event: string; data: Record<string, unknown> }> {
  const frames = raw
    .split("\n\n")
    .map((frame) => frame.trim())
    .filter(Boolean);

  const output: Array<{ event: string; data: Record<string, unknown> }> = [];

  for (const frame of frames) {
    let event = "message";
    const dataLines: string[] = [];
    for (const line of frame.split("\n")) {
      if (line.startsWith("event:")) {
        event = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trim());
      }
    }
    const rawData = dataLines.join("\n");
    let data: Record<string, unknown> = {};
    if (rawData) {
      try {
        data = JSON.parse(rawData) as Record<string, unknown>;
      } catch {
        data = { raw: rawData };
      }
    }
    output.push({ event, data });
  }

  return output;
}

function log(message: string): void {
  console.log(`[acceptance] ${message}`);
}

void main();
