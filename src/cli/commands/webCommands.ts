import type { Command } from "commander";

import type { RuntimeOptions } from "../../container.js";
import { loadConfig } from "../../config.js";
import type { AppConfig, DeepPartial } from "../../config.js";
import type { I18n } from "../../i18n/index.js";
import {
  startLocalWebFetchServer,
  type LocalWebFetchServerOptions,
  type StartedLocalWebFetchServer
} from "../../tools/localWebFetchServer.js";
import { startWebServer } from "../../web/server.js";

interface WebCommandDependencies {
  i18n: I18n;
  output: {
    write(chunk: string): unknown;
  };
  optionDescriptions: Record<string, string>;
  asOptionalString: (value: unknown) => string | undefined;
  parseOptionalNumber: (value: string | undefined) => number | undefined;
  buildRuntimeOptions: (options: Record<string, unknown>) => RuntimeOptions;
  buildRuntimeOverrides: (options: Record<string, unknown>) => DeepPartial<AppConfig>;
}

export function registerWebCommands(program: Command, deps: WebCommandDependencies): void {
  const {
    i18n,
    output,
    optionDescriptions,
    asOptionalString,
    parseOptionalNumber,
    buildRuntimeOptions,
    buildRuntimeOverrides
  } = deps;

  program
    .command("web")
    .description(i18n.t("cli.web.description"))
    .option("--host <host>", optionDescriptions.host, "127.0.0.1")
    .option("--port <number>", optionDescriptions.port, "8787")
    .option("--provider <provider>", optionDescriptions.provider)
    .option("--model <model>", optionDescriptions.model)
    .option("--chunk-strategy <strategy>", optionDescriptions.chunkStrategy)
    .option("--storage-backend <backend>", optionDescriptions.storageBackend)
    .option("--sqlite-file <path>", optionDescriptions.sqliteFile)
    .option("--lance-file <path>", optionDescriptions.lanceFile)
    .option("--lance-db-path <path>", optionDescriptions.lanceDbPath)
    .option("--raw-store-backend <backend>", optionDescriptions.rawStoreBackend)
    .option("--raw-store-file <path>", optionDescriptions.rawStoreFile)
    .option("--relation-store-backend <backend>", optionDescriptions.relationStoreBackend)
    .option("--relation-store-file <path>", optionDescriptions.relationStoreFile)
    .option("--graph-embedding <method>", optionDescriptions.graphEmbedding)
    .option("--relation-extractor <kind>", optionDescriptions.relationExtractor)
    .option("--relation-model <model>", optionDescriptions.relationModel)
    .option("--search-endpoint <url>", optionDescriptions.searchEndpoint)
    .option("--search-api-key <key>", optionDescriptions.searchApiKey)
    .option("--search-api-flavor <flavor>", optionDescriptions.searchApiFlavor)
    .option("--search-api-freshness <value>", optionDescriptions.searchApiFreshness)
    .option("--search-api-summary <enabled>", optionDescriptions.searchApiSummary)
    .option("--search-api-market <market>", optionDescriptions.searchApiMarket)
    .option("--web-fetch-endpoint <url>", optionDescriptions.webFetchEndpoint)
    .option("--web-fetch-api-key <key>", optionDescriptions.webFetchApiKey)
    .option("--search-mode <mode>", optionDescriptions.searchMode)
    .option("--search-schedule-minutes <number>", optionDescriptions.searchScheduleMinutes)
    .option("--search-topk <number>", optionDescriptions.searchTopK)
    .option("--search-seeds <csv>", optionDescriptions.searchSeeds)
    .option("--prediction <enabled>", optionDescriptions.prediction)
    .option("--proactive-wakeup <enabled>", optionDescriptions.proactiveWakeup)
    .option("--proactive-min-interval-seconds <number>", optionDescriptions.proactiveMinIntervalSeconds)
    .option("--proactive-max-per-hour <number>", optionDescriptions.proactiveMaxPerHour)
    .option("--proactive-require-evidence <enabled>", optionDescriptions.proactiveRequireEvidence)
    .option("--proactive-timer <enabled>", optionDescriptions.proactiveTimer)
    .option("--proactive-timer-interval-seconds <number>", optionDescriptions.proactiveTimerIntervalSeconds)
    .option("--topic-shift-trigger <enabled>", optionDescriptions.topicShiftTrigger)
    .option("--topic-shift-min-keywords <number>", optionDescriptions.topicShiftMinKeywords)
    .option("--topic-shift-min-tokens <number>", optionDescriptions.topicShiftMinTokens)
    .option(
      "--topic-shift-query-similarity-soft-max <number>",
      optionDescriptions.topicShiftQuerySimilaritySoftMax
    )
    .option(
      "--topic-shift-query-similarity-hard-max <number>",
      optionDescriptions.topicShiftQuerySimilarityHardMax
    )
    .option(
      "--topic-shift-keyword-overlap-soft-max <number>",
      optionDescriptions.topicShiftKeywordOverlapSoftMax
    )
    .option(
      "--topic-shift-keyword-overlap-hard-max <number>",
      optionDescriptions.topicShiftKeywordOverlapHardMax
    )
    .option(
      "--topic-shift-retrieval-overlap-soft-max <number>",
      optionDescriptions.topicShiftRetrievalOverlapSoftMax
    )
    .option(
      "--topic-shift-retrieval-overlap-hard-max <number>",
      optionDescriptions.topicShiftRetrievalOverlapHardMax
    )
    .option(
      "--topic-shift-soft-cooldown-seconds <number>",
      optionDescriptions.topicShiftSoftCooldownSeconds
    )
    .option(
      "--topic-shift-hard-cooldown-seconds <number>",
      optionDescriptions.topicShiftHardCooldownSeconds
    )
    .option("--chunk-manifest-enabled <enabled>", optionDescriptions.chunkManifestEnabled)
    .option("--chunk-affects-retrieval <enabled>", optionDescriptions.chunkAffectsRetrieval)
    .option("--chunk-manifest-target-tokens <number>", optionDescriptions.chunkManifestTargetTokens)
    .option("--chunk-manifest-max-tokens <number>", optionDescriptions.chunkManifestMaxTokens)
    .option("--chunk-manifest-max-blocks <number>", optionDescriptions.chunkManifestMaxBlocks)
    .option("--chunk-manifest-max-gap-ms <number>", optionDescriptions.chunkManifestMaxGapMs)
    .option("--chunk-neighbor-expand-enabled <enabled>", optionDescriptions.chunkNeighborExpandEnabled)
    .option("--chunk-neighbor-window <number>", optionDescriptions.chunkNeighborWindow)
    .option("--chunk-neighbor-score-gate <number>", optionDescriptions.chunkNeighborScoreGate)
    .option("--chunk-max-expanded-blocks <number>", optionDescriptions.chunkMaxExpandedBlocks)
    .option("--web-debug-api <enabled>", optionDescriptions.webDebugApi)
    .option("--web-file-api <enabled>", optionDescriptions.webFileApi)
    .option("--web-raw-context <enabled>", optionDescriptions.webRawContext)
    .option("--bridge-mode <mode>", optionDescriptions.bridgeMode)
    .option("--openai-compat-bypass-agent <enabled>", optionDescriptions.openaiCompatBypassAgent)
    .option("--web-admin-token <token>", optionDescriptions.webAdminToken)
    .option("--web-body-max-bytes <number>", optionDescriptions.webBodyMaxBytes)
    .option("--tool-file-write-enabled <enabled>", optionDescriptions.toolFileWriteEnabled)
    .option("--tool-file-write-max-bytes <number>", optionDescriptions.toolFileWriteMaxBytes)
    .option("--tool-terminal-enabled <enabled>", optionDescriptions.toolTerminalEnabled)
    .option("--tool-terminal-timeout-ms <number>", optionDescriptions.toolTerminalTimeoutMs)
    .option("--tool-terminal-max-output-chars <number>", optionDescriptions.toolTerminalMaxOutputChars)
    .option("--mcp-enabled <enabled>", optionDescriptions.mcpEnabled)
    .option("--mcp-command <command>", optionDescriptions.mcpCommand)
    .option("--mcp-args <csv>", optionDescriptions.mcpArgs)
    .option("--mcp-workdir <path>", optionDescriptions.mcpWorkdir)
    .option("--mcp-init-timeout-ms <number>", optionDescriptions.mcpInitTimeoutMs)
    .option("--mcp-tool-timeout-ms <number>", optionDescriptions.mcpToolTimeoutMs)
    .option("--mcp-tool-allowlist <csv>", optionDescriptions.mcpToolAllowlist)
    .option("--debug-trace <enabled>", optionDescriptions.debugTrace)
    .option("--debug-trace-max <number>", optionDescriptions.debugTraceMax)
    .option("--hybrid-prescreen-ratio <number>", optionDescriptions.hybridPrescreenRatio)
    .option("--hybrid-prescreen-min <number>", optionDescriptions.hybridPrescreenMin)
    .option("--hybrid-prescreen-max <number>", optionDescriptions.hybridPrescreenMax)
    .option("--hybrid-rerank-multiplier <number>", optionDescriptions.hybridRerankMultiplier)
    .option("--hybrid-rerank-hard-cap <number>", optionDescriptions.hybridRerankHardCap)
    .option(
      "--hybrid-hash-early-stop-min-gap <number>",
      optionDescriptions.hybridHashEarlyStopMinGap
    )
    .option("--hybrid-local-rerank-timeout-ms <number>", optionDescriptions.hybridLocalRerankTimeoutMs)
    .option("--hybrid-rerank-text-max-chars <number>", optionDescriptions.hybridRerankTextMaxChars)
    .option("--hybrid-local-cache-max <number>", optionDescriptions.hybridLocalCacheMax)
    .option("--hybrid-local-cache-ttl-ms <number>", optionDescriptions.hybridLocalCacheTtlMs)
    .option("--local-embed-batch-window-ms <number>", optionDescriptions.localEmbedBatchWindowMs)
    .option("--local-embed-max-batch-size <number>", optionDescriptions.localEmbedMaxBatchSize)
    .option("--local-embed-queue-max-pending <number>", optionDescriptions.localEmbedQueueMaxPending)
    .option("--local-embed-execution-provider <provider>", optionDescriptions.localEmbedExecutionProvider)
    .option("--include-tags-intro <enabled>", optionDescriptions.includeTagsIntro)
    .option("--tags-intro <path>", optionDescriptions.tagsIntro)
    .option("--tags-toml <path>", optionDescriptions.tagsToml)
    .option("--tags-vars <csv>", optionDescriptions.tagsVars)
    .action(async (options) => {
      const host = asOptionalString(options.host) ?? "127.0.0.1";
      const preferredPort = parseOptionalNumber(asOptionalString(options.port)) ?? 8787;
      const runtimeOptions = buildRuntimeOptions(options);
      let runtimeOverrides = buildRuntimeOverrides(options);
      let localWebFetch: StartedLocalWebFetchServer | undefined;
      let started: Awaited<ReturnType<typeof startWebServer>> | undefined;
      try {
        const prepared = await maybeStartAutoWebFetchForWeb(runtimeOverrides, i18n, output);
        runtimeOverrides = prepared.runtimeOverrides;
        localWebFetch = prepared.localWebFetch;
        started = await startWebServerWithFallback(
          host,
          preferredPort,
          runtimeOverrides,
          runtimeOptions,
          i18n,
          output
        );
        output.write(`${i18n.t("cli.web.running", { url: started.url })}\n`);
        output.write(`${i18n.t("cli.web.stop_hint")}\n`);

        const shutdown = async (): Promise<void> => {
          await started?.close();
          await localWebFetch?.close();
          process.exit(0);
        };
        process.once("SIGINT", () => {
          void shutdown();
        });
        process.once("SIGTERM", () => {
          void shutdown();
        });
      } catch (error) {
        await started?.close();
        await localWebFetch?.close();
        throw error;
      }
    });

  program
    .command("webfetch-local")
    .description(i18n.t("cli.webfetch_local.description"))
    .option("--host <host>", optionDescriptions.host, "127.0.0.1")
    .option("--port <number>", optionDescriptions.port, "3005")
    .option("--web-fetch-api-key <key>", optionDescriptions.webFetchApiKey)
    .option("--timeout-ms <number>", optionDescriptions.webFetchTimeoutMs, "15000")
    .option("--max-chars <number>", optionDescriptions.webFetchMaxChars, "120000")
    .option("--body-max-bytes <number>", optionDescriptions.webFetchBodyMaxBytes, "65536")
    .action(async (options) => {
      const host = asOptionalString(options.host) ?? "127.0.0.1";
      const port = parseOptionalNumber(asOptionalString(options.port)) ?? 3005;
      const timeoutMs = parseOptionalNumber(asOptionalString(options.timeoutMs)) ?? 15000;
      const maxChars = parseOptionalNumber(asOptionalString(options.maxChars)) ?? 120000;
      const bodyMaxBytes = parseOptionalNumber(asOptionalString(options.bodyMaxBytes)) ?? 65536;
      const apiKey = asOptionalString(options.webFetchApiKey);
      const started = await startLocalWebFetchServer({
        host,
        port,
        apiKey,
        requestTimeoutMs: timeoutMs,
        bodyMaxBytes,
        maxContentChars: maxChars,
        userAgent: "MLEX-LocalWebFetch/1.0"
      });
      const endpoint = `${started.url}/fetch`;
      output.write(`${i18n.t("cli.webfetch_local.running", { endpoint })}\n`);
      if (apiKey) {
        output.write(`${i18n.t("cli.webfetch_local.auth_required")}\n`);
      } else {
        output.write(`${i18n.t("cli.webfetch_local.auth_disabled")}\n`);
      }
      output.write(`${i18n.t("cli.webfetch_local.config_hint", { endpoint })}\n`);
      output.write(`${i18n.t("cli.webfetch_local.stop_hint")}\n`);

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
}

async function startWebServerWithFallback(
  host: string,
  preferredPort: number,
  runtimeOverrides: DeepPartial<AppConfig>,
  runtimeOptions: RuntimeOptions,
  i18n: I18n,
  output: { write(chunk: string): unknown }
): Promise<Awaited<ReturnType<typeof startWebServer>>> {
  try {
    return await startWebServer({
      host,
      port: preferredPort,
      runtimeOverrides,
      runtimeOptions
    });
  } catch (error) {
    if (!isAddressInUse(error)) {
      throw error;
    }
    output.write(`${i18n.t("cli.web.port_fallback", { port: preferredPort })}\n`);
    return startWebServer({
      host,
      port: 0,
      runtimeOverrides,
      runtimeOptions
    });
  }
}

function isAddressInUse(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: string };
  return candidate.code === "EADDRINUSE";
}

async function maybeStartAutoWebFetchForWeb(
  runtimeOverrides: DeepPartial<AppConfig>,
  i18n: I18n,
  output: { write(chunk: string): unknown }
): Promise<{
  runtimeOverrides: DeepPartial<AppConfig>;
  localWebFetch?: StartedLocalWebFetchServer;
}> {
  const resolvedConfig = loadConfig(runtimeOverrides);
  const mode = resolvedConfig.manager.searchAugmentMode;
  const hasWebFetchEndpoint = Boolean(resolvedConfig.component.webFetchEndpoint?.trim());
  const shouldAutoStart = (mode === "predictive" || mode === "scheduled") && !hasWebFetchEndpoint;
  if (!shouldAutoStart) {
    return { runtimeOverrides };
  }

  const webFetchApiKey = resolvedConfig.component.webFetchApiKey?.trim() || undefined;
  const localWebFetch = await startLocalWebFetchServerWithFallback("127.0.0.1", 3005, {
    apiKey: webFetchApiKey,
    requestTimeoutMs: 15000,
    bodyMaxBytes: 65536,
    maxContentChars: 120000,
    userAgent: "MLEX-LocalWebFetch/1.0"
  }, i18n, output);
  const endpoint = `${localWebFetch.url}/fetch`;
  output.write(`${i18n.t("cli.web.webfetch_autostart", { mode, endpoint })}\n`);
  if (webFetchApiKey) {
    output.write(`${i18n.t("cli.web.webfetch_autostart_auth_required")}\n`);
  } else {
    output.write(`${i18n.t("cli.web.webfetch_autostart_auth_disabled")}\n`);
  }

  return {
    runtimeOverrides: {
      ...runtimeOverrides,
      component: {
        ...(runtimeOverrides.component ?? {}),
        webFetchEndpoint: endpoint
      }
    },
    localWebFetch
  };
}

async function startLocalWebFetchServerWithFallback(
  host: string,
  preferredPort: number,
  options: Omit<LocalWebFetchServerOptions, "host" | "port">,
  i18n: I18n,
  output: { write(chunk: string): unknown }
): Promise<StartedLocalWebFetchServer> {
  try {
    return await startLocalWebFetchServer({
      ...options,
      host,
      port: preferredPort
    });
  } catch (error) {
    if (!isAddressInUse(error)) {
      throw error;
    }
    output.write(`${i18n.t("cli.web.webfetch_port_fallback", { port: preferredPort })}\n`);
    return startLocalWebFetchServer({
      ...options,
      host,
      port: 0
    });
  }
}
