import { spawn, type ChildProcess } from "node:child_process";

import type { IDebugTraceRecorder } from "../debug/DebugTraceRecorder.js";
import { ReadonlyFileService } from "../files/ReadonlyFileService.js";
import type { IMemoryManager } from "../memory/IMemoryManager.js";
import type { SearchAugmentMode } from "../types.js";
import type { ISearchProvider, SearchRecord } from "../search/ISearchProvider.js";
import type { IWebPageFetcher } from "../search/IWebPageFetcher.js";
import { createId } from "../utils/id.js";

export interface AgentToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface AgentToolResult {
  ok: boolean;
  content: string;
}

export interface IAgentToolExecutor {
  instructions(): string;
  execute(call: AgentToolCall): Promise<AgentToolResult>;
}

export interface BuiltinAgentToolExecutorConfig {
  workspaceRoot: string;
  memoryManager: IMemoryManager;
  traceRecorder?: IDebugTraceRecorder;
  testRunTimeoutMs?: number;
  searchProvider?: ISearchProvider;
  webPageFetcher?: IWebPageFetcher;
  searchAugmentMode?: SearchAugmentMode;
  searchTopK?: number;
}

export class BuiltinAgentToolExecutor implements IAgentToolExecutor {
  private readonly fileService: ReadonlyFileService;
  private testRunInFlight = false;

  constructor(private readonly config: BuiltinAgentToolExecutorConfig) {
    this.fileService = new ReadonlyFileService({ rootPath: config.workspaceRoot });
  }

  instructions(): string {
    return [
      "You can call tools when needed.",
      "If a tool is needed, output ONLY one tag: <tool_call>{\"name\":\"...\",\"args\":{...}}</tool_call>.",
      "When information is incomplete, prefer calling history.query before answering.",
      "Supported tools:",
      "- readonly.list args: {\"path\":\".\",\"maxEntries\":200}",
      "- readonly.read args: {\"path\":\"README.md\",\"maxBytes\":65536}",
      "- history.query args: {\"query\":\"payment webhook\",\"mode\":\"hybrid\",\"topBlocks\":5,\"limit\":5,\"keywords\":[\"idempotency\"],\"includeRaw\":true,\"includeRecent\":true,\"includePrediction\":true,\"maxFormattedChars\":16384}",
      "- web.search.record args: {\"query\":\"latest payment retry best practices\",\"limit\":5,\"includeSnippets\":true}",
      "- web.fetch.record args: {\"url\":\"https://example.com/doc\",\"maxChars\":12000}",
      "- test.run args: {\"script\":\"typecheck|test|build|verify:arch\"}",
      "After a tool call, you will receive TOOL_RESULT JSON in a user message.",
      "You may call tools again in later rounds if needed, but only one tool_call per round.",
      "When no more tools are needed, return normal final answer text."
    ].join("\n");
  }

  async execute(call: AgentToolCall): Promise<AgentToolResult> {
    this.config.traceRecorder?.record("tool", "execute.start", { call });
    if (call.name === "readonly.list") {
      const pathInput = asString(call.args.path) ?? ".";
      const maxEntries = clampInt(call.args.maxEntries, 200, 1, 1000);
      const entries = await this.fileService.list(pathInput, maxEntries);
      const result = {
        ok: true,
        content: JSON.stringify({ path: pathInput, entries }, null, 2)
      };
      this.config.traceRecorder?.record("tool", "execute.result", {
        call,
        result
      });
      return result;
    }

    if (call.name === "readonly.read") {
      const pathInput = asString(call.args.path);
      if (!pathInput) {
        const result = { ok: false, content: "readonly.read requires args.path" };
        this.config.traceRecorder?.record("tool", "execute.result", { call, result });
        return result;
      }
      const maxBytes = clampInt(call.args.maxBytes, 64 * 1024, 256, 2 * 1024 * 1024);
      const result = await this.fileService.read(pathInput, maxBytes);
      const output = {
        ok: true,
        content: JSON.stringify(result, null, 2)
      };
      this.config.traceRecorder?.record("tool", "execute.result", { call, result: output });
      return output;
    }

    if (call.name === "test.run") {
      if (this.testRunInFlight) {
        const result = {
          ok: false,
          content: "test.run is already running. Please wait for current run to finish."
        };
        this.config.traceRecorder?.record("tool", "execute.result", { call, result });
        return result;
      }

      const script = asString(call.args.script) ?? "test";
      const allowedScripts = new Set(["typecheck", "test", "build", "verify:arch"]);
      if (!allowedScripts.has(script)) {
        const result = {
          ok: false,
          content: `test.run script not allowed: ${script}`
        };
        this.config.traceRecorder?.record("tool", "execute.result", { call, result });
        return result;
      }
      const timeoutMs = clampInt(
        call.args.timeoutMs,
        this.config.testRunTimeoutMs ?? DEFAULT_TEST_RUN_TIMEOUT_MS,
        5000,
        30 * 60 * 1000
      );
      this.testRunInFlight = true;
      let run: { exitCode: number; stdout: string; stderr: string; timedOut: boolean; durationMs: number };
      try {
        run = await runNpmScript(script, this.config.workspaceRoot, timeoutMs);
      } catch (error) {
        const result = {
          ok: false,
          content: JSON.stringify(
            {
              script,
              timeoutMs,
              error: toErrorMessage(error)
            },
            null,
            2
          )
        };
        this.config.traceRecorder?.record("tool", "execute.result", { call, result });
        return result;
      } finally {
        this.testRunInFlight = false;
      }
      const output = truncateText(`${run.stdout}${run.stderr}`.trim(), 16 * 1024);
      const result = {
        ok: run.exitCode === 0 && !run.timedOut,
        content: JSON.stringify(
          {
            script,
            exitCode: run.exitCode,
            timedOut: run.timedOut,
            durationMs: run.durationMs,
            timeoutMs,
            output
          },
          null,
          2
        )
      };
      this.config.traceRecorder?.record("tool", "execute.result", { call, result });
      return result;
    }

    if (call.name === "history.query") {
      const query = asString(call.args.query);
      if (!query) {
        const result = { ok: false, content: "history.query requires args.query" };
        this.config.traceRecorder?.record("tool", "execute.result", { call, result });
        return result;
      }
      const mode = asHistoryQueryMode(call.args.mode);
      const topBlocks = clampInt(call.args.topBlocks ?? call.args.limit, 5, 1, 50);
      const includeRaw = asBoolean(call.args.includeRaw, true);
      const includeRecent = asBoolean(call.args.includeRecent, true);
      const includePrediction = asBoolean(call.args.includePrediction, true);
      const maxFormattedChars = clampInt(call.args.maxFormattedChars, 16 * 1024, 256, 64 * 1024);
      const keywords = asStringArray(call.args.keywords);

      const finalQuery = keywords.length > 0 ? `${query} ${keywords.join(" ")}` : query;
      if (this.config.searchAugmentMode === "auto") {
        await this.searchAndRecord(finalQuery, this.config.searchTopK ?? 5);
      }
      const context = await this.config.memoryManager.getContext(finalQuery);
      const selectedBlocks = context.blocks.slice(0, topBlocks).map((block) => ({
        id: block.id,
        score: block.score,
        source: block.source,
        summary: block.summary,
        startTime: block.startTime,
        endTime: block.endTime,
        keywords: block.keywords,
        retentionMode: block.retentionMode ?? "raw",
        matchScore: block.matchScore ?? 0,
        conflict: Boolean(block.conflict),
        rawEventCount: block.rawEvents?.length ?? 0,
        rawEvents: includeRaw ? (block.rawEvents ?? []) : undefined
      }));

      const formatted = truncateText(context.formatted, maxFormattedChars);
      const result = {
        ok: true,
        content: JSON.stringify(
          {
            query,
            queryMeta: {
              mode,
              topBlocks,
              includeRaw,
              includeRecent,
              includePrediction,
              maxFormattedChars,
              keywords,
              effectiveQuery: finalQuery
            },
            blockCount: context.blocks.length,
            recentEventCount: context.recentEvents.length,
            blocks: selectedBlocks,
            recentEvents: includeRecent ? context.recentEvents : [],
            formatted,
            truncated: formatted !== context.formatted,
            prediction: includePrediction ? (context.prediction ?? null) : null
          },
          null,
          2
        )
      };
      this.config.traceRecorder?.record("tool", "execute.result", { call, result });
      return result;
    }

    if (call.name === "web.search.record") {
      const query = asString(call.args.query);
      if (!query) {
        const result = { ok: false, content: "web.search.record requires args.query" };
        this.config.traceRecorder?.record("tool", "execute.result", { call, result });
        return result;
      }
      const limit = clampInt(call.args.limit, this.config.searchTopK ?? 5, 1, 10);
      const includeSnippets = asBoolean(call.args.includeSnippets, true);
      const records = await this.searchAndRecord(query, limit);
      const output = records.map((item) => ({
        rank: item.rank,
        title: item.title,
        url: item.url,
        source: item.source,
        snippet: includeSnippets ? item.snippet : undefined,
        fetchedAt: item.fetchedAt
      }));
      const result = {
        ok: true,
        content: JSON.stringify(
          {
            query,
            count: output.length,
            records: output
          },
          null,
          2
        )
      };
      this.config.traceRecorder?.record("tool", "execute.result", { call, result });
      return result;
    }

    if (call.name === "web.fetch.record") {
      const url = asString(call.args.url);
      if (!url) {
        const result = { ok: false, content: "web.fetch.record requires args.url" };
        this.config.traceRecorder?.record("tool", "execute.result", { call, result });
        return result;
      }
      if (!this.config.webPageFetcher) {
        const result = { ok: false, content: "web.fetch.record is not configured" };
        this.config.traceRecorder?.record("tool", "execute.result", { call, result });
        return result;
      }
      const maxChars = clampInt(call.args.maxChars, 12_000, 256, 120_000);
      const page = await this.config.webPageFetcher.fetch(url);
      const content = truncateText(page.content, maxChars);
      await this.config.memoryManager.addEvent({
        id: createId("event"),
        role: "tool",
        text: `web fetch\nurl: ${page.url}\ntitle: ${page.title ?? ""}\n${content}`.trim(),
        timestamp: Date.now(),
        metadata: {
          tool: "web.fetch.record",
          url: page.url,
          title: page.title,
          fetchedAt: page.fetchedAt,
          truncated: content !== page.content
        }
      });
      const result = {
        ok: true,
        content: JSON.stringify(
          {
            url: page.url,
            title: page.title ?? null,
            content,
            truncated: content !== page.content,
            fetchedAt: page.fetchedAt
          },
          null,
          2
        )
      };
      this.config.traceRecorder?.record("tool", "execute.result", { call, result });
      return result;
    }

    const result = {
      ok: false,
      content: `unknown tool: ${call.name}`
    };
    this.config.traceRecorder?.record("tool", "execute.result", { call, result });
    return result;
  }

  private async searchAndRecord(query: string, limit: number): Promise<SearchRecord[]> {
    if (!this.config.searchProvider) return [];

    const records = await this.config.searchProvider.search({ query, limit });
    if (records.length === 0) return [];

    const summary = records
      .map((item) => `${item.rank}. ${item.title} | ${item.url} | ${item.snippet}`)
      .join("\n");

    await this.config.memoryManager.addEvent({
      id: createId("event"),
      role: "tool",
      text: `web search: ${query}\n${summary}`,
      timestamp: Date.now(),
      metadata: {
        tool: "web.search.record",
        mode: this.config.searchAugmentMode ?? "lazy",
        query,
        count: records.length,
        records
      }
    });

    return records;
  }
}

export function parseToolCall(text: string): AgentToolCall | undefined {
  for (const payload of extractCandidateJsonPayloads(text)) {
    const parsed = safeJsonParse<unknown>(payload);
    if (!parsed || typeof parsed !== "object") continue;
    const call = normalizeToolCallCandidate(parsed as Record<string, unknown>);
    if (call) return call;
  }
  return undefined;
}

export function formatToolResult(call: AgentToolCall, result: AgentToolResult): string {
  return `TOOL_RESULT ${JSON.stringify(
    {
      tool: call.name,
      ok: result.ok,
      content: result.content
    },
    null,
    2
  )}`;
}

async function runNpmScript(
  script: string,
  cwd: string,
  timeoutMs: number
): Promise<{ exitCode: number; stdout: string; stderr: string; timedOut: boolean; durationMs: number }> {
  const command = process.platform === "win32" ? "cmd.exe" : "npm";
  const args = process.platform === "win32" ? ["/d", "/s", "/c", "npm", "run", script] : ["run", script];
  const child = spawn(command, args, {
    cwd,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stdout = "";
  let stderr = "";
  let timedOut = false;
  const startedAt = Date.now();
  let resolved = false;
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  const timer = setTimeout(() => {
    timedOut = true;
    terminateChildProcess(child);
  }, timeoutMs);

  return new Promise((resolve) => {
    const finalize = (exitCode: number): void => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      resolve({
        exitCode,
        stdout,
        stderr,
        timedOut,
        durationMs: Date.now() - startedAt
      });
    };

    child.once("error", (error) => {
      const prefix = stderr.length > 0 ? "\n" : "";
      stderr += `${prefix}[spawn error] ${error.message}`;
      finalize(1);
    });

    child.once("close", (code) => {
      const exitCode = typeof code === "number" ? code : timedOut ? 124 : 1;
      finalize(exitCode);
    });
  });
}

function terminateChildProcess(child: ChildProcess): void {
  if (process.platform === "win32") {
    if (typeof child.pid === "number" && child.pid > 0) {
      const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true
      });
      killer.once("error", () => {
        child.kill("SIGKILL");
      });
      return;
    }
    child.kill("SIGKILL");
    return;
  }

  child.kill("SIGTERM");
  setTimeout(() => {
    child.kill("SIGKILL");
  }, 2000);
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return fallback;
}

function clampInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(asString(value) ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n...[truncated]`;
}

type HistoryQueryMode = "hybrid" | "recent" | "semantic";

function asHistoryQueryMode(value: unknown): HistoryQueryMode {
  const parsed = asString(value)?.toLowerCase();
  if (parsed === "recent" || parsed === "semantic") {
    return parsed;
  }
  return "hybrid";
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => asString(item))
    .filter((item): item is string => Boolean(item));
}

function extractCandidateJsonPayloads(text: string): string[] {
  const payloads: string[] = [];

  const tagged = text.match(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/i)?.[1]?.trim();
  if (tagged) payloads.push(tagged);

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1]?.trim();
  if (fenced) payloads.push(fenced);

  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    payloads.push(trimmed);
  }

  return payloads;
}

function normalizeToolCallCandidate(candidate: Record<string, unknown>): AgentToolCall | undefined {
  const directName = asString(candidate.name) ?? asString(candidate.tool);
  const directArgs = parseArgs(candidate.args ?? candidate.arguments);
  if (directName) {
    return {
      name: directName,
      args: directArgs
    };
  }

  const fn = candidate.function;
  if (fn && typeof fn === "object") {
    const fnObj = fn as Record<string, unknown>;
    const fnName = asString(fnObj.name);
    if (!fnName) return undefined;
    return {
      name: fnName,
      args: parseArgs(fnObj.arguments ?? fnObj.args)
    };
  }

  return undefined;
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === "string") {
    const parsed = safeJsonParse<unknown>(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  }
  return {};
}

function safeJsonParse<T>(raw: string): T | undefined {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

const DEFAULT_TEST_RUN_TIMEOUT_MS = 10 * 60 * 1000;
