#!/usr/bin/env node
import { Command } from "commander";
import { readFile } from "node:fs/promises";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import type { Interface as ReadlineInterface } from "node:readline/promises";

import { createRuntime } from "../container.js";
import type { DeepPartial, AppConfig } from "../config.js";
import type { IDebugTraceRecorder } from "../debug/DebugTraceRecorder.js";
import {
  ReadonlyFileService,
  type ReadFileResult,
  type ReadonlyFileEntry
} from "../files/ReadonlyFileService.js";
import { startWebServer } from "../web/server.js";

const program = new Command();

program
  .name("mlex")
  .description("Partition-memory agent CLI")
  .version("0.2.0");

program
  .command("web")
  .description("Start minimalist web UI")
  .option("--host <host>", "bind host", "127.0.0.1")
  .option("--port <number>", "bind port", "8787")
  .option("--provider <provider>", "rule-based | openai | deepseek-reasoner")
  .option("--model <model>", "LLM model for openai/deepseek provider")
  .option("--chunk-strategy <strategy>", "fixed | semantic | hybrid")
  .option("--storage-backend <backend>", "memory | sqlite | lance | chroma")
  .option("--sqlite-file <path>", "sqlite database file path")
  .option("--lance-file <path>", "local file path for lance backend")
  .option("--raw-store-backend <backend>", "memory | file | sqlite")
  .option("--raw-store-file <path>", "raw event store file path")
  .option("--relation-store-backend <backend>", "memory | file | sqlite")
  .option("--relation-store-file <path>", "relation store file path")
  .option("--graph-embedding <method>", "node2vec | transe")
  .option("--relation-extractor <kind>", "heuristic | openai | deepseek")
  .option("--relation-model <model>", "relation extraction model name")
  .option("--prediction <enabled>", "true | false")
  .option("--web-debug-api <enabled>", "true | false")
  .option("--web-file-api <enabled>", "true | false")
  .option("--web-raw-context <enabled>", "true | false")
  .option("--web-admin-token <token>", "admin token for debug/files APIs")
  .option("--web-body-max-bytes <number>", "max request body bytes for /api/chat")
  .option("--debug-trace <enabled>", "true | false")
  .option("--debug-trace-max <number>", "max in-memory trace entries")
  .action(async (options) => {
    const host = asOptionalString(options.host) ?? "127.0.0.1";
    const preferredPort = parseOptionalNumber(asOptionalString(options.port)) ?? 8787;
    const started = await startWebServerWithFallback(host, preferredPort, buildRuntimeOverrides(options));
    output.write(`MLEX web running at ${started.url}\n`);
    output.write("Press Ctrl+C to stop.\n");

    const shutdown = async (): Promise<void> => {
      await started.close();
      process.exit(0);
    };
    process.once("SIGINT", () => {
      void shutdown();
    });
    process.once("SIGTERM", () => {
      void shutdown();
    });
  });

program
  .command("files:list")
  .description("List files under readonly workspace root")
  .argument("[path]", "relative directory path", ".")
  .option("--max-entries <number>", "max listed entries", "200")
  .action(async (pathInput: string, options) => {
    const fileService = new ReadonlyFileService({ rootPath: process.cwd() });
    const maxEntries = parseOptionalNumber(asOptionalString(options.maxEntries));
    const entries = await fileService.list(pathInput, maxEntries);
    output.write(formatFileList(entries, pathInput));
  });

program
  .command("files:read")
  .description("Read one file in readonly mode")
  .argument("<path>", "relative file path")
  .option("--max-bytes <number>", "max bytes to read", "65536")
  .action(async (pathInput: string, options) => {
    const fileService = new ReadonlyFileService({ rootPath: process.cwd() });
    const maxBytes = parseOptionalNumber(asOptionalString(options.maxBytes));
    const result = await fileService.read(pathInput, maxBytes);
    output.write(formatFileRead(result));
  });

program
  .command("chat")
  .description("Start an interactive agent session")
  .option("--provider <provider>", "rule-based | openai | deepseek-reasoner")
  .option("--model <model>", "LLM model for openai/deepseek provider")
  .option("--stream", "enable streaming output", false)
  .option("--max-tokens <number>", "max tokens per memory block")
  .option("--chunk-strategy <strategy>", "fixed | semantic | hybrid")
  .option("--storage-backend <backend>", "memory | sqlite | lance | chroma")
  .option("--sqlite-file <path>", "sqlite database file path")
  .option("--lance-file <path>", "local file path for lance backend")
  .option("--chroma-base-url <url>", "chroma base url")
  .option("--chroma-collection <id>", "chroma collection id")
  .option("--raw-store-backend <backend>", "memory | file | sqlite")
  .option("--raw-store-file <path>", "raw event store file path")
  .option("--relation-store-backend <backend>", "memory | file | sqlite")
  .option("--relation-store-file <path>", "relation store file path")
  .option("--graph-embedding <method>", "node2vec | transe")
  .option("--relation-extractor <kind>", "heuristic | openai | deepseek")
  .option("--relation-model <model>", "relation extraction model name")
  .option("--prediction <enabled>", "true | false")
  .option("--show-context", "print context debug info after each answer", false)
  .option("--debug-trace <enabled>", "true | false")
  .option("--debug-trace-max <number>", "max in-memory trace entries")
  .action(async (options) => {
    const runtime = createRuntime(buildRuntimeOverrides(options));
    const fileService = new ReadonlyFileService({ rootPath: process.cwd() });
    const traceRecorder = runtime.container.resolve<IDebugTraceRecorder>("debugTraceRecorder");
    const rl = createInterface({ input, output });
    const lineReader = createLineReader(rl);
    output.write("MLEX chat started. Commands: /exit /seal /ctx <query> /config /ml /ls [path] /cat <file> /trace [n] /trace-clear\n");

    try {
      while (true) {
        const rawInput = await lineReader.nextLine("you> ");
        const commandInput = rawInput.trim();
        if (!commandInput) continue;
        if (commandInput === "/exit") break;

        if (commandInput === "/seal") {
          await runtime.agent.sealMemory();
          output.write("agent> 当前 active block 已封存。\n");
          continue;
        }

        if (commandInput.startsWith("/ctx ")) {
          const query = commandInput.slice(5).trim();
          const context = await runtime.agent.getContext(query);
          output.write(`${context.formatted}\n`);
          continue;
        }

        if (commandInput === "/config") {
          output.write(`${JSON.stringify(sanitizeConfigForDisplay(runtime.config), null, 2)}\n`);
          continue;
        }

        if (commandInput === "/trace-clear") {
          traceRecorder.clear();
          output.write("agent> trace 已清空。\n");
          continue;
        }

        if (commandInput === "/trace" || commandInput.startsWith("/trace ")) {
          const arg = getCommandArg(commandInput);
          const limit = parseOptionalNumber(arg) ?? 200;
          const entries = traceRecorder.list(Math.min(Math.max(limit, 1), 5000));
          output.write(`${JSON.stringify({ total: traceRecorder.size(), entries }, null, 2)}\n`);
          continue;
        }

        if (
          commandInput === "/ls" ||
          commandInput.startsWith("/ls ") ||
          commandInput === "/list" ||
          commandInput.startsWith("/list ")
        ) {
          try {
            const pathInput = getCommandArg(commandInput) ?? ".";
            const entries = await fileService.list(pathInput, 200);
            output.write(formatFileList(entries, pathInput));
          } catch (error) {
            output.write(`agent> 文件列表失败: ${toErrorMessage(error)}\n`);
          }
          continue;
        }

        if (
          commandInput.startsWith("/cat ") ||
          commandInput.startsWith("/read ")
        ) {
          const pathInput = getCommandArg(commandInput);
          if (!pathInput) {
            output.write("agent> 用法: /cat <file>\n");
            continue;
          }
          try {
            const readResult = await fileService.read(pathInput, 64 * 1024);
            output.write(formatFileRead(readResult));
          } catch (error) {
            output.write(`agent> 文件读取失败: ${toErrorMessage(error)}\n`);
          }
          continue;
        }

        if (commandInput === "/ml") {
          const multi = await readMultilineInput(lineReader);
          if (!multi) {
            output.write("agent> 已取消多行输入。\n");
            continue;
          }
          await handleChatInput(multi, options.stream, options.showContext, runtime);
          continue;
        }

        const pastedTail = await lineReader.collectBufferedBurst(45);
        const finalInput =
          pastedTail.length > 0 ? [rawInput, ...pastedTail].join("\n").trim() : commandInput;
        await handleChatInput(finalInput, options.stream, options.showContext, runtime);
      }
    } finally {
      lineReader.close();
      rl.close();
      await runtime.close();
    }
  });

program
  .command("ingest")
  .description("Ingest a text file into memory blocks")
  .argument("<file>", "path to txt/markdown file")
  .option("--provider <provider>", "rule-based | openai | deepseek-reasoner", "rule-based")
  .option("--model <model>", "LLM model for openai/deepseek provider")
  .option("--storage-backend <backend>", "memory | sqlite | lance | chroma", "sqlite")
  .option("--sqlite-file <path>", "sqlite database file path")
  .option("--lance-file <path>", "local file path for lance backend")
  .option("--raw-store-backend <backend>", "memory | file | sqlite")
  .option("--raw-store-file <path>", "raw event store file path")
  .option("--relation-store-backend <backend>", "memory | file | sqlite")
  .option("--relation-store-file <path>", "relation store file path")
  .option("--graph-embedding <method>", "node2vec | transe")
  .option("--relation-extractor <kind>", "heuristic | openai | deepseek")
  .option("--relation-model <model>", "relation extraction model name")
  .option("--prediction <enabled>", "true | false")
  .action(async (file: string, options) => {
    const runtime = createRuntime(buildRuntimeOverrides(options));
    try {
      const content = await readFile(file, "utf8");
      const segments = content
        .split(/\n{2,}/)
        .map((line) => line.trim())
        .filter(Boolean);

      for (const segment of segments) {
        await runtime.agent.respond(`请记住以下资料：\n${segment}`);
      }
      await runtime.agent.sealMemory();
      output.write(`ingest complete: ${segments.length} segments processed.\n`);
    } finally {
      await runtime.close();
    }
  });

program
  .command("ask")
  .description("Ask one question and print answer")
  .argument("<query>", "question to ask")
  .option("--provider <provider>", "rule-based | openai | deepseek-reasoner")
  .option("--model <model>", "LLM model for openai/deepseek provider")
  .option("--stream", "enable streaming output", false)
  .option("--storage-backend <backend>", "memory | sqlite | lance | chroma")
  .option("--sqlite-file <path>", "sqlite database file path")
  .option("--lance-file <path>", "local file path for lance backend")
  .option("--raw-store-backend <backend>", "memory | file | sqlite")
  .option("--raw-store-file <path>", "raw event store file path")
  .option("--relation-store-backend <backend>", "memory | file | sqlite")
  .option("--relation-store-file <path>", "relation store file path")
  .option("--graph-embedding <method>", "node2vec | transe")
  .option("--relation-extractor <kind>", "heuristic | openai | deepseek")
  .option("--relation-model <model>", "relation extraction model name")
  .option("--prediction <enabled>", "true | false")
  .action(async (query: string, options) => {
    const runtime = createRuntime(buildRuntimeOverrides(options));
    try {
      if (options.stream) {
        await runtime.agent.respondStream(query, (token) => output.write(token));
        output.write("\n");
        return;
      }

      const response = await runtime.agent.respond(query);
      output.write(`${response.text}\n`);
    } finally {
      await runtime.close();
    }
  });

program
  .command("swarm")
  .description("Run multi-agent collaboration and synthesis")
  .argument("<query>", "question/task to solve")
  .option("--provider <provider>", "rule-based | openai | deepseek-reasoner")
  .option("--model <model>", "LLM model for openai/deepseek provider")
  .option("--agents <number>", "number of worker agents (2-5)", "3")
  .option("--no-show-drafts", "hide each worker draft before final synthesis")
  .option("--storage-backend <backend>", "memory | sqlite | lance | chroma")
  .option("--sqlite-file <path>", "sqlite database file path")
  .option("--lance-file <path>", "local file path for lance backend")
  .option("--raw-store-backend <backend>", "memory | file | sqlite")
  .option("--raw-store-file <path>", "raw event store file path")
  .option("--relation-store-backend <backend>", "memory | file | sqlite")
  .option("--relation-store-file <path>", "relation store file path")
  .option("--graph-embedding <method>", "node2vec | transe")
  .option("--relation-extractor <kind>", "heuristic | openai | deepseek")
  .option("--relation-model <model>", "relation extraction model name")
  .option("--prediction <enabled>", "true | false")
  .action(async (query: string, options) => {
    const workerCount = clampAgents(options.agents);
    const roles = buildRoles(workerCount);
    const workerResults: Array<{ role: string; text: string }> = [];

    for (const role of roles) {
      const runtime = createRuntime(buildRuntimeOverrides(options), {
        agentSystemPrompt: role.systemPrompt
      });
      try {
        const response = await runtime.agent.respond(`${role.instruction}\n\n任务：${query}`);
        workerResults.push({ role: role.name, text: response.text });
      } finally {
        await runtime.close();
      }
    }

    if (options.showDrafts) {
      for (const item of workerResults) {
        output.write(`\n[${item.role}] draft:\n${item.text}\n`);
      }
    }

    const synthesisPrompt = [
      "请综合以下多 Agent 结果，给出最终统一方案：",
      ...workerResults.map(
        (item, index) => `\n[Worker ${index + 1} - ${item.role}]\n${item.text}`
      ),
      `\n[原始任务]\n${query}`,
      "\n输出格式：结论、关键步骤、风险点、下一步行动。"
    ].join("\n");

    const coordinator = createRuntime(buildRuntimeOverrides(options), {
      agentSystemPrompt:
        "You are the coordinator agent. Merge drafts, resolve conflicts, and output one practical final answer."
    });
    try {
      const final = await coordinator.agent.respond(synthesisPrompt);
      output.write(`\n[Coordinator]\n${final.text}\n`);
    } finally {
      await coordinator.close();
    }
  });

void program.parseAsync(process.argv);

function buildRuntimeOverrides(options: Record<string, unknown>): DeepPartial<AppConfig> {
  return {
    service: {
      provider: asOptionalString(options.provider) as AppConfig["service"]["provider"],
      openaiModel: asOptionalString(options.model),
      deepseekModel: asOptionalString(options.model)
    },
    component: {
      chunkStrategy: asOptionalString(options.chunkStrategy) as AppConfig["component"]["chunkStrategy"],
      storageBackend: asOptionalString(options.storageBackend) as AppConfig["component"]["storageBackend"],
      sqliteFilePath: asOptionalString(options.sqliteFile),
      lanceFilePath: asOptionalString(options.lanceFile),
      chromaBaseUrl: asOptionalString(options.chromaBaseUrl),
      chromaCollectionId: asOptionalString(options.chromaCollection),
      rawStoreBackend:
        asOptionalString(options.rawStoreBackend) as AppConfig["component"]["rawStoreBackend"],
      rawStoreFilePath: asOptionalString(options.rawStoreFile),
      relationStoreBackend:
        asOptionalString(options.relationStoreBackend) as AppConfig["component"]["relationStoreBackend"],
      relationStoreFilePath: asOptionalString(options.relationStoreFile),
      graphEmbeddingMethod:
        asOptionalString(options.graphEmbedding) as AppConfig["component"]["graphEmbeddingMethod"],
      relationExtractor:
        asOptionalString(options.relationExtractor) as AppConfig["component"]["relationExtractor"],
      relationModel: asOptionalString(options.relationModel),
      webDebugApiEnabled: parseOptionalBoolean(asOptionalString(options.webDebugApi)),
      webFileApiEnabled: parseOptionalBoolean(asOptionalString(options.webFileApi)),
      webExposeRawContext: parseOptionalBoolean(asOptionalString(options.webRawContext)),
      webAdminToken: asOptionalString(options.webAdminToken),
      webRequestBodyMaxBytes: parseOptionalNumber(asOptionalString(options.webBodyMaxBytes)),
      debugTraceEnabled: parseOptionalBoolean(asOptionalString(options.debugTrace)),
      debugTraceMaxEntries: parseOptionalNumber(asOptionalString(options.debugTraceMax))
    },
    manager: {
      maxTokensPerBlock: parseOptionalNumber(asOptionalString(options.maxTokens)),
      predictionEnabled: parseOptionalBoolean(asOptionalString(options.prediction))
    }
  };
}

function asOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.length > 0 ? value : undefined;
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseOptionalBoolean(value: string | undefined): boolean | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return undefined;
}

function getCommandArg(input: string): string | undefined {
  const spaceIndex = input.indexOf(" ");
  if (spaceIndex < 0) return undefined;
  const value = input.slice(spaceIndex + 1).trim();
  return value.length > 0 ? value : undefined;
}

function formatFileList(entries: ReadonlyFileEntry[], pathInput: string): string {
  const header = `agent> readonly list: ${pathInput}\n`;
  if (entries.length === 0) {
    return `${header}(empty)\n`;
  }
  const lines = entries.map((entry) => {
    const prefix = entry.type === "dir" ? "[dir] " : entry.type === "file" ? "[file]" : "[other]";
    const sizePart = typeof entry.sizeBytes === "number" ? ` ${entry.sizeBytes}B` : "";
    return `${prefix} ${entry.path}${sizePart}`;
  });
  return `${header}${lines.join("\n")}\n`;
}

function formatFileRead(result: ReadFileResult): string {
  const meta = `agent> readonly read: ${result.path} (${result.bytes}/${result.totalBytes} bytes${result.truncated ? ", truncated" : ""})\n`;
  return `${meta}${result.text}\n`;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sanitizeConfigForDisplay(config: AppConfig): AppConfig {
  return {
    ...config,
    service: {
      ...config.service,
      openaiApiKey: redactSecret(config.service.openaiApiKey),
      deepseekApiKey: redactSecret(config.service.deepseekApiKey)
    },
    component: {
      ...config.component,
      webAdminToken: redactSecret(config.component.webAdminToken)
    }
  };
}

function redactSecret(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value.length <= 4) return "***";
  if (value.length <= 8) return `${value.slice(0, 1)}***${value.slice(-1)}`;
  return `${value.slice(0, 3)}***${value.slice(-2)}`;
}

function clampAgents(value: unknown): number {
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : Number(value);
  if (!Number.isFinite(parsed)) return 3;
  return Math.min(5, Math.max(2, parsed));
}

function buildRoles(count: number): Array<{ name: string; instruction: string; systemPrompt: string }> {
  const templates = [
    {
      name: "Planner",
      systemPrompt: "You are a senior planner agent focused on decomposition and milestones.",
      instruction: "请重点输出执行计划、里程碑与优先级。"
    },
    {
      name: "Implementer",
      systemPrompt: "You are a senior implementation agent focused on technical execution.",
      instruction: "请重点输出可落地实现方案、接口与工程结构。"
    },
    {
      name: "Critic",
      systemPrompt: "You are a critical reviewer agent focused on risk and edge cases.",
      instruction: "请重点指出风险、失败模式、监控与回滚策略。"
    },
    {
      name: "Optimizer",
      systemPrompt: "You optimize for performance, cost and reliability trade-offs.",
      instruction: "请重点优化性能/成本/可靠性并给出取舍建议。"
    },
    {
      name: "Product",
      systemPrompt: "You focus on product value, usability, and iteration planning.",
      instruction: "请重点补充产品化交互、验收标准与迭代建议。"
    }
  ];
  return templates.slice(0, count);
}

async function readMultilineInput(lineReader: LineReader): Promise<string | undefined> {
  output.write("输入多行内容，使用 /end 提交，/cancel 取消。\n");
  const lines: string[] = [];
  while (true) {
    const line = await lineReader.nextLine("... ");
    if (line.trim() === "/cancel") {
      return undefined;
    }
    if (line.trim() === "/end") {
      break;
    }
    lines.push(line);
  }
  return lines.join("\n").trim();
}

async function handleChatInput(
  userInput: string,
  stream: boolean,
  showContext: boolean,
  runtime: ReturnType<typeof createRuntime>
): Promise<void> {
  if (!userInput) return;
  if (stream) {
    output.write("agent> ");
    const response = await runtime.agent.respondStream(userInput, (token) => {
      output.write(token);
    });
    output.write("\n");
    if (showContext) {
      output.write(`${response.context.formatted}\n`);
    }
    return;
  }

  const response = await runtime.agent.respond(userInput);
  output.write(`agent> ${response.text}\n`);
  if (showContext) {
    output.write(`${response.context.formatted}\n`);
  }
}

interface LineReader {
  nextLine(prompt: string): Promise<string>;
  collectBufferedBurst(waitMs: number): Promise<string[]>;
  close(): void;
}

function createLineReader(rl: ReadlineInterface): LineReader {
  const buffer: string[] = [];
  let resolver: ((line: string) => void) | undefined;

  const onLine = (line: string): void => {
    if (resolver) {
      const activeResolver = resolver;
      resolver = undefined;
      activeResolver(line);
      return;
    }
    buffer.push(line);
  };

  rl.on("line", onLine);

  return {
    async nextLine(prompt: string): Promise<string> {
      output.write(prompt);
      if (buffer.length > 0) {
        return buffer.shift() ?? "";
      }
      return new Promise<string>((resolve) => {
        resolver = resolve;
      });
    },
    async collectBufferedBurst(waitMs: number): Promise<string[]> {
      await sleep(waitMs);
      if (buffer.length === 0) return [];
      const lines: string[] = [];
      while (buffer.length > 0) {
        const line = buffer.shift();
        if (typeof line === "string") {
          lines.push(line);
        }
      }
      return lines;
    },
    close(): void {
      rl.off("line", onLine);
      if (resolver) {
        const activeResolver = resolver;
        resolver = undefined;
        activeResolver("");
      }
    }
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function startWebServerWithFallback(
  host: string,
  preferredPort: number,
  runtimeOverrides: DeepPartial<AppConfig>
): Promise<Awaited<ReturnType<typeof startWebServer>>> {
  try {
    return await startWebServer({
      host,
      port: preferredPort,
      runtimeOverrides
    });
  } catch (error) {
    if (!isAddressInUse(error)) {
      throw error;
    }
    output.write(`Port ${preferredPort} is in use, falling back to a random port.\n`);
    return startWebServer({
      host,
      port: 0,
      runtimeOverrides
    });
  }
}

function isAddressInUse(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: string };
  return candidate.code === "EADDRINUSE";
}
