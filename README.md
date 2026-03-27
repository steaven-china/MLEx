# MLEX Agent

MLEX 是一个面向高上下文 Agent 的分块记忆引擎与可运行 CLI/Web 项目。
核心目标是把“记忆处理、关系抽取、预测检索、输出组装”拆成可替换模块，便于演进和实验。

## 核心能力

- 分块记忆与封存：`PartitionMemoryManager` + 可切换 chunk 策略（`fixed|semantic|hybrid`）
- 混合检索：关键词 + 向量（ANN 候选召回）+ 关系图扩展 + 融合重排
- 关系抽取：启发式或 LLM 抽取，异步入队
- 保留策略：`raw/compressed/conflict` 决策与原文回溯
- 预测引擎：图嵌入 + 随机游走 + 主动触发门控 + prefetch
- 存储抽象：`memory/sqlite/lance/chroma`（块存储）+ 可独立 raw/relation store
- Provider 可替换：`rule-based` / `openai` / `deepseek-reasoner`
- 外部搜索增强：支持 `lazy|auto|scheduled` 三种模式（搜索摘要入库 + 网页正文懒抓取）
- 运行形态：CLI（`chat/ask/ingest/swarm/files:*`）+ Web（SSE 流式）

## 运行要求

- Node.js `>=20`（推荐 `22+`）
- npm `>=10`
- 默认后端是 `sqlite`，需要运行时支持 `node:sqlite`

如果当前 Node 运行时不支持 `node:sqlite`，请改用：

- `--storage-backend memory`
- 或 `--storage-backend lance`
- 或升级到支持 `node:sqlite` 的 Node 版本

## 快速开始（PowerShell）

```powershell
npm install
npm run build
npx mlex chat --provider rule-based
```

开发模式：

```powershell
npm run dev
```

Web 模式：

```powershell
npm run web
```

## 脚本说明

| Script | 说明 |
| --- | --- |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm test` | 运行 Vitest 单元/集成测试 |
| `npm run build` | `tsup` 构建 `dist/` |
| `npm run acceptance` | Web 端到端验收（含持久化与流式检查） |
| `npm run verify:arch` | 依次执行 `typecheck -> test -> build -> acceptance` |

## CLI 命令总览

| 命令 | 说明 | 示例 |
| --- | --- | --- |
| `mlex chat` | 交互式会话 | `npx mlex chat --provider openai --stream` |
| `mlex web` | 启动 Web UI + API | `npx mlex web --port 8787` |
| `mlex ask` | 单次提问 | `npx mlex ask "总结当前记忆架构"` |
| `mlex ingest <file>` | 导入文本并写入记忆块 | `npx mlex ingest .\docs\notes.md` |
| `mlex swarm` | 多 Agent 协作汇总 | `npx mlex swarm "给出上线方案" --agents 3` |
| `mlex files:list` | 只读列目录 | `npx mlex files:list .` |
| `mlex files:read` | 只读读文件 | `npx mlex files:read README.md --max-bytes 2048` |

## `mlex chat`

示例：

```powershell
npx mlex chat --provider rule-based
```

`chat` 已升级为全屏 TUI（基于 `blessed`），默认布局为：

- 左侧 Sessions：会话轨（支持多会话切换）
- 中间 Session：当前会话实时对话流
- 右侧上半 Activity：操作轨迹/状态日志
- 右侧下半 Inspector：上下文/配置/trace/文件查看
- 底部 Prompt：输入区
- 默认深色低亮主题，且启用 `fullUnicode` + `forceUnicode`（支持 CJK/emoji/组合字符）
- 流式模式下，assistant 回复会在 Session 面板中实时增长（即时对话体验）

常用参数：

- `--provider rule-based|openai|deepseek-reasoner`
- `--model <model>`
- `--stream`
- `--max-tokens <number>`
- `--chunk-strategy fixed|semantic|hybrid`
- `--storage-backend memory|sqlite|lance|chroma`
- `--sqlite-file <path>`
- `--lance-file <path>`
- `--chroma-base-url <url>`
- `--chroma-collection <id>`
- `--raw-store-backend memory|file|sqlite`
- `--raw-store-file <path>`
- `--relation-store-backend memory|file|sqlite`
- `--relation-store-file <path>`
- `--graph-embedding node2vec|transe`
- `--relation-extractor heuristic|openai|deepseek`
- `--relation-model <model>`
- `--search-endpoint <url>`
- `--search-api-key <key>`
- `--web-fetch-endpoint <url>`
- `--web-fetch-api-key <key>`
- `--search-mode lazy|auto|scheduled`
- `--search-schedule-minutes <number>`
- `--search-topk <number>`
- `--search-seeds <csv>`
- `--prediction true|false`
- `--show-context`
- `--debug-trace true|false`
- `--debug-trace-max <number>`

TUI 输入命令（在底部输入框）：

- `/help`：查看命令与快捷键帮助（右侧 Inspector 显示）
- `/new` 或 `/clear`：创建新会话
- `/resend` 或 `/retry`：重发上一条用户消息
- `/stop`：打断当前流式回复
- `/mode <chat|code|plan>`：切换工作模式标签
- `/seal`：封存当前 active block
- `/ctx <query>`：查看检索上下文
- `/config`：输出当前配置（敏感字段脱敏）
- `/trace [n]`：查看 trace
- `/trace-clear`：清空 trace
- `/ls [path]` 或 `/list [path]`
- `/cat <file>` 或 `/read <file>`
- `/exit`

TUI 快捷键：

- `Ctrl+1` / `Ctrl+2` / `Ctrl+3`：切换 `chat/code/plan` 模式
- `Ctrl+K`：打开 Quick Palette
- `Ctrl+N`：新建会话
- `Ctrl+R`：重发上一条消息（流式中会先打断再重发）
- `Ctrl+X`：打断当前流式回复
- `Ctrl+S`：快速 seal
- `Ctrl+P`：切换 streaming 开关
- `Ctrl+T`：打开 trace 面板
- `Ctrl+L`：清空当前会话消息
- `Ctrl+E`：打开外部编辑器输入多行文本
- `Tab`：切换 `Prompt -> Sessions -> Session -> Activity -> Inspector` 焦点
- `Ctrl+C`：退出 TUI

## 搜索增强（lazy / auto / scheduled）

MLEX 支持在回答流程中调用外部搜索并把结果作为 `tool` 事件写入 memory，后续可被 `history.query` 命中。

- `lazy`：仅在模型调用 `web.search.record` 时触发搜索
- `auto`：每次 `history.query` 前自动搜索并入库
- `scheduled`：运行时按固定间隔执行种子 queries 并入库

CLI 示例：

```powershell
# 懒获取（默认）
npx mlex chat --search-mode lazy --search-endpoint "https://your-search-endpoint"

# 自动获取
npx mlex chat --search-mode auto --search-endpoint "https://your-search-endpoint" --search-topk 5

# 定时获取（每 30 分钟）
npx mlex chat --search-mode scheduled --search-endpoint "https://your-search-endpoint" --search-seeds "payment retry,webhook idempotency" --search-schedule-minutes 30
```


示例：

```powershell
npx mlex web --provider deepseek-reasoner --model deepseek-reasoner --port 8787
```

默认地址：`http://127.0.0.1:8787`

如果端口占用，会自动回退到随机端口并打印最终地址。

常用参数（除 chat 参数外）：

- `--host <host>`
- `--port <number>`
- `--web-debug-api true|false`
- `--web-file-api true|false`
- `--web-raw-context true|false`
- `--web-admin-token <token>`
- `--web-body-max-bytes <number>`

启用 Debug/文件 API 示例：

```powershell
npx mlex web --web-debug-api true --web-file-api true --web-raw-context true
```

启用鉴权示例：

```powershell
npx mlex web --web-debug-api true --web-file-api true --web-admin-token "YOUR_TOKEN"
```

请求头可使用：

- `x-mlex-admin-token: YOUR_TOKEN`
- `Authorization: Bearer YOUR_TOKEN`

## `mlex ask`

```powershell
npx mlex ask "回顾我们的 memory 架构"
npx mlex ask "总结当前方案" --provider openai --stream
```

## `mlex ingest`

```powershell
npx mlex ingest .\docs\notes.md
```

## `mlex swarm`

```powershell
npx mlex swarm "构建上线方案" --provider openai --agents 3
```

说明：Worker（Planner/Implementer/Critic...）会并发执行，最后由 Coordinator 汇总。
总耗时通常接近最慢 Worker 的响应时间。

## Provider 配置

### OpenAI

```powershell
$env:OPENAI_API_KEY="YOUR_KEY"
$env:MLEX_PROVIDER="openai"
npx mlex chat --provider openai --model gpt-4.1-mini
```

OpenAI 关系抽取器：

```powershell
npx mlex chat --provider openai --relation-extractor openai --relation-model gpt-4.1-nano
```

### DeepSeek-Reasoner

```powershell
$env:DEEPSEEK_API_KEY="YOUR_KEY"
$env:MLEX_PROVIDER="deepseek-reasoner"
npx mlex chat --provider deepseek-reasoner --model deepseek-reasoner --stream
```

DeepSeek 关系抽取器：

```powershell
npx mlex chat --provider deepseek-reasoner --relation-extractor deepseek --relation-model deepseek-reasoner
```

## 存储后端配置

### SQLite（推荐）

```powershell
$env:MLEX_STORAGE_BACKEND="sqlite"
$env:MLEX_RAW_STORE_BACKEND="sqlite"
$env:MLEX_RELATION_STORE_BACKEND="sqlite"
$env:MLEX_SQLITE_FILE=".mlex/memory.db"
npx mlex chat
```

### Lance（本地文件）

```powershell
npx mlex chat --storage-backend lance --lance-file .mlex/blocks.json
```

### Chroma

`chat` 命令可直接传参；其他命令建议用环境变量。

```powershell
$env:MLEX_STORAGE_BACKEND="chroma"
$env:MLEX_CHROMA_BASE_URL="http://127.0.0.1:8000"
$env:MLEX_CHROMA_COLLECTION="mlex-blocks"
npx mlex chat
```

## 关键环境变量

查看完整 CLI 参数可执行：

```powershell
npx mlex --help
npx mlex chat --help
npx mlex web --help
```

常用环境变量分组如下（对应 `src/config.ts`）：

- Provider：
  - `MLEX_PROVIDER`
  - `OPENAI_API_KEY` `OPENAI_BASE_URL` `OPENAI_MODEL`
  - `DEEPSEEK_API_KEY` `MLEX_DEEPSEEK_API_KEY` `DEEPSEEK_BASE_URL` `DEEPSEEK_MODEL`
- 记忆分块与检索：
  - `MLEX_MAX_TOKENS` `MLEX_MIN_TOKENS`
  - `MLEX_RECENT_WINDOW` `MLEX_SEMANTIC_TOPK` `MLEX_FINAL_TOPK`
  - `MLEX_KEYWORD_WEIGHT` `MLEX_VECTOR_WEIGHT` `MLEX_GRAPH_WEIGHT` `MLEX_VECTOR_MIN_SCORE`
  - `MLEX_RELATION_DEPTH` `MLEX_GRAPH_TOPK` `MLEX_RELATION_EXPAND`
- 主动 seal：
  - `MLEX_PROACTIVE_SEAL_ENABLED`
  - `MLEX_PROACTIVE_SEAL_IDLE_SECONDS`
  - `MLEX_PROACTIVE_SEAL_TURN_BOUNDARY`
  - `MLEX_PROACTIVE_SEAL_MIN_TOKENS`
- 压缩与冲突：
  - `MLEX_COMPRESS_HIGH_MATCH` `MLEX_COMPRESS_LOW_MATCH`
  - `MLEX_COMPRESS_SOFT_BAND` `MLEX_COMPRESS_PRESERVE_WEIGHT`
  - `MLEX_COMPRESS_MIN_RAW_TOKENS` `MLEX_CONFLICT_MARKER_ENABLED`
- 预测：
  - `MLEX_PREDICTION_ENABLED` `MLEX_PREDICTION_TOPK`
  - `MLEX_PREDICTION_WALK_DEPTH` `MLEX_PREDICTION_ACTIVE_THRESHOLD`
  - `MLEX_PREDICTION_DECAY` `MLEX_PREDICTION_BOOST_WEIGHT`
- 搜索增强：
  - `MLEX_SEARCH_AUGMENT_MODE` `MLEX_SEARCH_SCHEDULE_MINUTES` `MLEX_SEARCH_TOPK`
  - `MLEX_SEARCH_ENDPOINT` `MLEX_SEARCH_API_KEY`
  - `MLEX_WEB_FETCH_ENDPOINT` `MLEX_WEB_FETCH_API_KEY`
  - `MLEX_SEARCH_SEED_QUERIES` `MLEX_SEARCH_TIMEOUT_MS`
- 存储与关系抽取：
  - `MLEX_CHUNK_STRATEGY` `MLEX_STORAGE_BACKEND`
  - `MLEX_SQLITE_FILE` `MLEX_LANCE_FILE`
  - `MLEX_CHROMA_BASE_URL` `MLEX_CHROMA_COLLECTION` `MLEX_CHROMA_API_KEY`
  - `MLEX_RAW_STORE_BACKEND` `MLEX_RAW_STORE_FILE`
  - `MLEX_RELATION_STORE_BACKEND` `MLEX_RELATION_STORE_FILE`
  - `MLEX_GRAPH_EMBEDDING_METHOD`
  - `MLEX_RELATION_EXTRACTOR` `MLEX_RELATION_MODEL` `MLEX_RELATION_TIMEOUT_MS`
- Web 与调试：
  - `MLEX_WEB_DEBUG_API_ENABLED` `MLEX_WEB_FILE_API_ENABLED`
  - `MLEX_WEB_EXPOSE_RAW_CONTEXT` `MLEX_WEB_REQUEST_BODY_MAX_BYTES`
  - `MLEX_WEB_ADMIN_TOKEN`
  - `MLEX_DEBUG_TRACE_ENABLED` `MLEX_DEBUG_TRACE_MAX_ENTRIES`

## Web API 概览

- `GET /healthz`
- `GET /api/capabilities`
- `POST /api/chat`
- `POST /api/chat/stream`（SSE：`token` + `done`）
- `POST /api/seal`
- `GET /api/debug/database`（需 `web-debug-api`）
- `GET /api/debug/block?id=<blockId>`（需 `web-debug-api`）
- `GET /api/debug/traces?limit=500`（需 `web-debug-api`）
- `POST /api/debug/traces/clear`（需 `web-debug-api`）
- `GET /api/files/list?path=.&maxEntries=200`（需 `web-file-api`）
- `GET /api/files/read?path=README.md&maxBytes=65536`（需 `web-file-api`）

## Agent 文档注入规则

运行时默认优先加载并注入：

1. `AgentDocs/AGENT.md`
2. `AgentDocs/AGENTS.md`
3. 当前目录向上回溯的 `AGENTS.md`

当历史块为空时，会尝试注入 `AgentDocs/Introduction.md`（或根目录 `Introduction.md`）作为冷启动信息。

## 架构目录映射

- `src/memory/processing/*`：seal/index 处理链
- `src/memory/management/*`：保留/压缩策略
- `src/memory/relation/*`：关系抽取、图构建与持久化
- `src/memory/prediction/*`：图嵌入、随机游走、预测
- `src/memory/output/*`：检索组装与回溯
- `src/tui/*`：TUI 输入解析、快捷键与布局渲染
- `src/container.ts`：依赖注入与运行时装配

## 验证与验收

```powershell
npm run typecheck
npm test
npm run build
npm run verify:arch
```

`verify:arch` 会执行完整流水线（含 `acceptance`）。

## 常见问题

### 1) `node:sqlite` 不可用

现象：启动 sqlite 后端时报错（例如 `DatabaseSync export is unavailable`）。

处理：

- 升级到支持 `node:sqlite` 的 Node 版本（推荐 Node 22+）
- 或切换到 `memory/lance/chroma` 后端

### 2) Windows 下 `spawn EPERM`（`esbuild`）

现象：`npm test` / `npm run build` 在 `esbuild` 子进程处失败。

处理建议：

- 检查安全软件是否拦截 `node_modules/esbuild/*`
- 确认项目目录和 npm cache 目录有可执行权限
- 在受限环境中优先跑 `npm run typecheck` 做快速校验



