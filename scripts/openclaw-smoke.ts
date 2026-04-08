import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

interface SmokeOptions {
  openclawCommand?: string;
  profile: string;
  onboard: boolean;
  providerId: string;
  modelId: string;
  apiKey: string;
  baseUrl: string;
  startMlex: boolean;
  mlexEntry: string;
  mlexHost: string;
  mlexPort: number;
  mlexProvider: string;
  keepMlexAlive: boolean;
  sessionId: string;
  message: string;
  iterations: number;
  commandTimeoutMs: number;
  healthTimeoutMs: number;
}

interface CommandResult {
  code: number;
  output: string;
  durationMs: number;
}

interface IterationResult {
  index: number;
  ok: boolean;
  wallMs: number;
  modelMs: number | null;
  textPreview: string;
  rawOutput: string;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const openclaw = resolveOpenclawCommand(options.openclawCommand);
  const mlex = options.startMlex ? startMlexServer(options) : undefined;
  const startedAt = Date.now();

  try {
    if (mlex) {
      const healthUrl = `http://${options.mlexHost}:${options.mlexPort}/healthz`;
      console.info(`[openclaw-smoke] starting MLEX: ${mlex.commandLine}`);
      await waitForHealth(healthUrl, mlex, options.healthTimeoutMs);
      console.info(`[openclaw-smoke] MLEX healthy: ${healthUrl}`);
    }

    if (options.onboard) {
      console.info(
        `[openclaw-smoke] onboarding profile=${options.profile} provider=${options.providerId} model=${options.modelId}`
      );
      const onboard = await runOpenclawCommand(
        openclaw,
        [
          "--profile",
          options.profile,
          "onboard",
          "--non-interactive",
          "--accept-risk",
          "--mode",
          "local",
          "--flow",
          "quickstart",
          "--auth-choice",
          "custom-api-key",
          "--custom-provider-id",
          options.providerId,
          "--custom-compatibility",
          "openai",
          "--custom-base-url",
          options.baseUrl,
          "--custom-model-id",
          options.modelId,
          "--custom-api-key",
          options.apiKey,
          "--skip-channels",
          "--skip-search",
          "--skip-skills",
          "--skip-ui",
          "--skip-daemon",
          "--skip-health",
          "--secret-input-mode",
          "plaintext",
          "--json"
        ],
        options.commandTimeoutMs
      );
      if (onboard.code !== 0) {
        throw new Error(`[openclaw-smoke] onboard failed\n${onboard.output}`);
      }
    }

    const status = await runOpenclawCommand(
      openclaw,
      ["--profile", options.profile, "models", "status", "--json"],
      options.commandTimeoutMs
    );
    if (status.code !== 0) {
      throw new Error(`[openclaw-smoke] models status failed\n${status.output}`);
    }
    const statusJson = extractLastJsonObject(status.output) as Record<string, unknown> | undefined;
    const resolvedDefault =
      typeof statusJson?.resolvedDefault === "string" ? statusJson.resolvedDefault : "unknown";
    console.info(`[openclaw-smoke] resolved default model: ${resolvedDefault}`);

    const iterations: IterationResult[] = [];
    for (let index = 1; index <= options.iterations; index += 1) {
      const command = [
        "--profile",
        options.profile,
        "agent",
        "--local",
        "--session-id",
        options.sessionId,
        "--message",
        options.message,
        "--json"
      ];
      console.info(`[openclaw-smoke] running iteration ${index}/${options.iterations}`);
      const result = await runOpenclawCommand(openclaw, command, options.commandTimeoutMs);
      const payload = extractLastJsonObject(result.output) as
        | {
            payloads?: Array<{ text?: string }>;
            meta?: { durationMs?: number };
          }
        | undefined;
      const text = payload?.payloads?.map((entry) => entry.text ?? "").join("\n").trim() ?? "";
      const modelMs = typeof payload?.meta?.durationMs === "number" ? payload.meta.durationMs : null;
      const timeoutLike = isTimeoutLikeText(text);
      iterations.push({
        index,
        ok: result.code === 0 && text.length > 0 && !timeoutLike,
        wallMs: result.durationMs,
        modelMs,
        textPreview: shrinkText(text, 140),
        rawOutput: result.output
      });
    }

    const summary = buildSummary({
      options,
      openclaw,
      totalDurationMs: Date.now() - startedAt,
      iterations
    });

    console.info(`[openclaw-smoke] completed: ${summary.success}/${summary.total} succeeded`);
    console.info(
      `[openclaw-smoke] wall avg/p95: ${summary.wallAvgMs.toFixed(1)} / ${summary.wallP95Ms.toFixed(1)} ms`
    );
    if (summary.modelSamples > 0) {
      console.info(
        `[openclaw-smoke] model avg/p95: ${summary.modelAvgMs.toFixed(1)} / ${summary.modelP95Ms.toFixed(1)} ms`
      );
    }
    console.info(`[openclaw-smoke] sample reply: ${summary.sampleReply}`);
    console.info(JSON.stringify(summary, null, 2));

    if (summary.success !== summary.total) {
      process.exitCode = 1;
    }
  } finally {
    if (mlex && !options.keepMlexAlive) {
      await stopChildProcess(mlex.child);
    }
  }
}

function parseArgs(args: string[]): SmokeOptions {
  const values = new Map<string, string>();
  for (const raw of args) {
    if (!raw.startsWith("--")) continue;
    const normalized = raw.slice(2);
    const splitIndex = normalized.indexOf("=");
    if (splitIndex < 0) {
      values.set(normalized, "true");
    } else {
      values.set(normalized.slice(0, splitIndex), normalized.slice(splitIndex + 1));
    }
  }

  const startMlex = parseBoolean(values.get("start-mlex"), true);
  const mlexHost = values.get("mlex-host")?.trim() || "127.0.0.1";
  const mlexPort = toPositiveInt(values.get("mlex-port")) ?? 8787;
  const baseUrl =
    values.get("base-url")?.trim() ||
    `http://${mlexHost}:${mlexPort}/v1`;

  return {
    openclawCommand: values.get("openclaw-cmd")?.trim() || undefined,
    profile: values.get("profile")?.trim() || "mlex-test",
    onboard: parseBoolean(values.get("onboard"), true),
    providerId: values.get("provider-id")?.trim() || "mlex-local",
    modelId: values.get("model-id")?.trim() || "mlex-agent",
    apiKey: values.get("api-key")?.trim() || "mlex-local",
    baseUrl,
    startMlex,
    mlexEntry: values.get("mlex-entry")?.trim() || "dist/cli/index.js",
    mlexHost,
    mlexPort,
    mlexProvider: values.get("mlex-provider")?.trim() || "rule-based",
    keepMlexAlive: parseBoolean(values.get("keep-mlex-alive"), false),
    sessionId: values.get("session-id")?.trim() || `mlex-smoke-${Date.now()}`,
    message: values.get("message")?.trim() || "Please summarize this integration status in one sentence.",
    iterations: toPositiveInt(values.get("iterations")) ?? 1,
    commandTimeoutMs: (toPositiveInt(values.get("timeout-ms")) ?? 180_000),
    healthTimeoutMs: toPositiveInt(values.get("health-timeout-ms")) ?? 30_000
  };
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (!raw) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  return fallback;
}

function toPositiveInt(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function resolveOpenclawCommand(input: string | undefined): string {
  if (input) return input;
  if (process.platform === "win32") {
    const cmd = join(process.env.APPDATA ?? "", "npm", "openclaw.cmd");
    if (existsSync(cmd)) return cmd;
  }
  return "openclaw";
}

function startMlexServer(options: SmokeOptions): {
  child: ChildProcess;
  commandLine: string;
  outputTail: () => string;
} {
  const args = [
    options.mlexEntry,
    "web",
    "--host",
    options.mlexHost,
    "--port",
    String(options.mlexPort),
    "--provider",
    options.mlexProvider
  ];
  const child = spawn("node", args, {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  const output = createTailBuffer(20_000);
  child.stdout?.on("data", (chunk) => output.push(chunk.toString()));
  child.stderr?.on("data", (chunk) => output.push(chunk.toString()));
  return {
    child,
    commandLine: formatCommandLine("node", args),
    outputTail: output.read
  };
}

async function waitForHealth(
  healthUrl: string,
  server: { child: ChildProcess; outputTail: () => string },
  timeoutMs: number
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (server.child.exitCode !== null) {
      throw new Error(
        `[openclaw-smoke] MLEX exited early (code=${server.child.exitCode})\n${server.outputTail()}`
      );
    }
    try {
      const response = await fetch(healthUrl);
      if (response.ok) {
        const payload = (await response.json()) as { ok?: boolean };
        if (payload.ok === true) return;
      }
    } catch {}
    await sleep(400);
  }
  throw new Error(`[openclaw-smoke] MLEX health timeout: ${healthUrl}\n${server.outputTail()}`);
}

async function runOpenclawCommand(
  openclawCommand: string,
  args: string[],
  timeoutMs: number
): Promise<CommandResult> {
  const commandLine = formatCommandLine(openclawCommand, args);
  return runShell(commandLine, timeoutMs);
}

function runShell(commandLine: string, timeoutMs: number): Promise<CommandResult> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(commandLine, {
      shell: true,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout?.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      output += chunk.toString();
    });

    const timer = setTimeout(() => {
      if (!child.killed) child.kill("SIGKILL");
    }, timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        code: code ?? 1,
        output,
        durationMs: Date.now() - startedAt
      });
    });
  });
}

function formatCommandLine(command: string, args: string[]): string {
  return [quoteArg(command), ...args.map((arg) => quoteArg(arg))].join(" ");
}

function quoteArg(value: string): string {
  if (!/[\s"]/u.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}

function createTailBuffer(maxChars: number): { push(chunk: string): void; read(): string } {
  let content = "";
  return {
    push(chunk: string): void {
      content += chunk;
      if (content.length > maxChars) {
        content = content.slice(content.length - maxChars);
      }
    },
    read(): string {
      return content;
    }
  };
}

function extractLastJsonObject(output: string): unknown | undefined {
  const clean = stripAnsi(output);
  const objects: string[] = [];
  let depth = 0;
  let inString = false;
  let escaping = false;
  let startIndex = -1;

  for (let index = 0; index < clean.length; index += 1) {
    const char = clean[index];
    if (!inString) {
      if (char === "{") {
        if (depth === 0) startIndex = index;
        depth += 1;
        continue;
      }
      if (char === "}" && depth > 0) {
        depth -= 1;
        if (depth === 0 && startIndex >= 0) {
          objects.push(clean.slice(startIndex, index + 1));
          startIndex = -1;
        }
        continue;
      }
    }

    if (char === "\\" && !escaping) {
      escaping = true;
      continue;
    }
    if (char === "\"" && !escaping) {
      inString = !inString;
    }
    escaping = false;
  }

  for (let index = objects.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(objects[index] ?? "");
    } catch {}
  }
  return undefined;
}

function stripAnsi(input: string): string {
  return input.replace(/\u001b\[[0-9;]*m/g, "");
}

function shrinkText(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 3)}...`;
}

function isTimeoutLikeText(text: string): boolean {
  const normalized = text.toLowerCase();
  if (!normalized) return false;
  return (
    normalized.includes("request timed out before a response was generated") ||
    normalized.includes("response timed out") ||
    normalized.includes("timed out")
  );
}

function buildSummary(input: {
  options: SmokeOptions;
  openclaw: string;
  totalDurationMs: number;
  iterations: IterationResult[];
}): Record<string, unknown> {
  const success = input.iterations.filter((item) => item.ok).length;
  const wall = input.iterations.map((item) => item.wallMs);
  const model = input.iterations
    .map((item) => item.modelMs)
    .filter((item): item is number => typeof item === "number");
  const sampleReply = input.iterations.find((item) => item.textPreview.length > 0)?.textPreview ?? "";

  return {
    ok: success === input.iterations.length,
    success,
    total: input.iterations.length,
    totalDurationMs: input.totalDurationMs,
    openclawCommand: input.openclaw,
    profile: input.options.profile,
    providerId: input.options.providerId,
    modelId: input.options.modelId,
    baseUrl: input.options.baseUrl,
    sessionId: input.options.sessionId,
    iterations: input.options.iterations,
    wallAvgMs: average(wall),
    wallP95Ms: percentile(wall, 0.95),
    modelSamples: model.length,
    modelAvgMs: model.length > 0 ? average(model) : 0,
    modelP95Ms: model.length > 0 ? percentile(model, 0.95) : 0,
    sampleReply,
    details: input.iterations.map((item) => ({
      index: item.index,
      ok: item.ok,
      wallMs: item.wallMs,
      modelMs: item.modelMs,
      textPreview: item.textPreview
    }))
  };
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1));
  return sorted[rank] ?? 0;
}

async function stopChildProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  const exited = await waitForExit(child, 4_000);
  if (exited) return;
  child.kill("SIGKILL");
  await waitForExit(child, 2_000);
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      resolve(false);
    }, timeoutMs);
    child.once("exit", () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(true);
    });
  });
}

main().catch((error) => {
  console.error(`[openclaw-smoke] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
