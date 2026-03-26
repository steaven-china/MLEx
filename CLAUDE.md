# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run typecheck       # TypeScript type checking (no emit)
npm test                # Run all tests with vitest
npm run test:watch      # Watch mode tests
npm run build           # Build with tsup (outputs to dist/)
npm run dev             # Run CLI chat in dev mode (tsx, no build)
npm run web             # Run web server in dev mode
npm run acceptance      # Run acceptance tests (requires running system)
npm run verify:arch     # Full validation: typecheck + test + build + acceptance
```

Run a single test file:
```bash
npx vitest run test/memory.test.ts
```

**After any code change, always run in order: `npm run typecheck` → `npm test` → `npm run build`.**

## Architecture

MLEX is a **partitioned memory agent** — a CLI/Web AI assistant whose distinguishing feature is a multi-layer memory system that stores, indexes, retrieves, and predicts conversation context using configurable backends.

### Dependency Wiring

All dependencies are wired in `src/container.ts` via a simple `Container` (IoC). `createRuntime()` is the single entry point used by both CLI and web server. Configuration is loaded from environment variables in `src/config.ts` using `loadConfig()`, with defaults in `DEFAULT_MANAGER_CONFIG`.

### Memory Pipeline (layered)

```
Ingest (events)
  └─ PartitionMemoryManager (src/memory/PartitionMemoryManager.ts)
       ├─ Active block accumulates events until sealed
       ├─ SealProcessor: summarize + embed + retention-policy decision
       │    ├─ IChunkStrategy (fixed / semantic / hybrid)
       │    ├─ ISummarizer (heuristic)
       │    ├─ IEmbedder (hash-based, 256-dim)
       │    └─ RetentionPolicyEngine → Compress / KeepRaw / Conflict
       ├─ IBlockStore (memory / sqlite / lance / chroma)
       ├─ IRawEventStore (memory / file / sqlite)
       ├─ IRelationStore (memory / file / sqlite)
       │    └─ AsyncRelationQueue → IRelationExtractor (heuristic / openai / deepseek)
       └─ RelationGraph (in-memory adjacency for prediction/retrieval)

Query (context retrieval)
  └─ HybridRetriever
       ├─ FusionRetriever: KeywordRetriever (InvertedIndex) + VectorRetriever
       └─ GraphRetriever (relation-graph expansion with depth decay)
            └─ ContextAssembler + RawBacktracker → formatted Context

Prediction
  └─ PredictorEngine
       ├─ IGraphEmbedder (node2vec / transe)
       ├─ WeightedRandomWalk
       └─ ProactiveTimingPolicy / ProactiveRetrievePolicy / PrefetchIntentPolicy
```

### Agent Layer (`src/agent/`)

`Agent` wraps `IMemoryManager` + `ILLMProvider`. On each turn it retrieves context from memory, builds a chat history, calls the provider, then ingests the response back into memory.

- Providers: `RuleBasedProvider`, `OpenAIProvider`, `DeepSeekReasonerProvider`, `ChatCompletionProvider`
- Tool calling: model emits `<tool_call>…</tool_call>` XML; `AgentToolExecutor` dispatches to `readonly.list`, `readonly.read`, `history.query`, `test.run`
- System prompt is built from `AgentDocs/AGENT.md` (primary) or `AGENTS.md` (fallback), plus optional `AgentDocs/Introduction.md` injected on cold start (no memory blocks yet)

### CLI & Web (`src/cli/index.ts`, `src/web/server.ts`)

CLI uses `commander`. Web uses Node's built-in `http` module (no external framework). Web debug/file APIs are off by default — enable with `--web-debug-api true` or env vars.

### Key Interfaces

| Interface | Location | Purpose |
|---|---|---|
| `IBlockStore` | `src/memory/store/IBlockStore.ts` | Sealed block persistence |
| `IRawEventStore` | `src/memory/raw/IRawEventStore.ts` | Raw event persistence |
| `IRelationStore` | `src/memory/relation/IRelationStore.ts` | Relation persistence |
| `IChunkStrategy` | `src/memory/chunking/IChunkStrategy.ts` | Block chunking |
| `IEmbedder` | `src/memory/embedder/IEmbedder.ts` | Text → vector |
| `ILLMProvider` | `src/agent/LLMProvider.ts` | LLM completion |
| `IBlockRetriever` | `src/memory/retrieval/IBlockRetriever.ts` | Block retrieval |

### Module Boundaries (from AGENTS.md)

- `src/memory/processing/*` — seal/index pipelines only
- `src/memory/management/*` — retention/compression policy only
- `src/memory/relation/*` — extraction + graph + persistence
- `src/memory/prediction/*` — embedding/walk/prediction
- `src/memory/output/*` — retrieval assembly/backtracking

Do not hard-code providers or storage backends inside module internals; inject through `Container`.

### Storage defaults

- **Tests**: `memory` backend for all stores (`NODE_ENV=test` triggers this in `loadConfig`)
- **Dev/prod**: `sqlite` backend, file at `.mlex/memory.db`

### TypeScript

- ESM (`"type": "module"`, `moduleResolution: NodeNext`)
- All imports must use `.js` extension (even for `.ts` source files)
- Strict mode on; avoid `any`
