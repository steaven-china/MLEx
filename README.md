# MLEX Agent (Node.js + TypeScript)

一个基于你给出的分块记忆架构实现的可运行项目，包含：

- `PartitionMemoryManager`（分块、封存、摘要、关键词/向量索引）
- `PartitionMemoryManager`（支持主动触发 seal：角色切换边界/空闲超时）
- 混合检索（关键词 + 向量 + 关系图扩展〔relation confidence + depth decay 加权〕+ 融合重排）
- 异步关系抽取队列
- 历史匹配计算 + 指向性感知保留策略（Compress/KeepRaw/Conflict）
- 原文存储与回溯（RawEventStore + Backtracker）
- 预测引擎（图嵌入 + 加权随机游走 + 意图解码）
- 主动触发门控（冷却窗口 + 时间分段策略 + 预测熵 + top1-top2 margin + 语义相似度二次验证）
- 主动预取路径（prefetch 预热下一轮检索分数，非即时注入）
- 压缩策略软决策（阈值软区间 + 指向性/新颖度/关系信号联合决策）
- 存储抽象（InMemory / SQLite / Chroma 适配 / Lance 文件适配）
- 可替换 LLM Provider（`rule-based` / `openai` / `deepseek-reasoner`）
- 可直接运行的 CLI Agent（`mlex chat`）
- 简约风 Web 前端（`mlex web`）

## 1) 快速开始

```bash
npm install
npm run build
npx mlex chat
```

开发模式：

```bash
npm run dev
```

前端模式：

```bash
npm run web
```

## 2) CLI

### 交互式对话

```bash
npx mlex chat --provider rule-based
```

可选参数：

- `--provider rule-based|openai|deepseek-reasoner`
- `--model <model>`（openai/deepseek 均可用）
- `--stream`（OpenAI/任意 provider 流式打印）
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
- `--prediction true|false`
- `--show-context`

会话内命令：

- `/seal`：封存当前 active block
- `/ctx <query>`：查看某查询的检索上下文
- `/config`：打印当前配置
- `/trace [n]`：查看最近 n 条完整调用 trace（模型请求/响应、Agent轮次、工具调用）
- `/trace-clear`：清空 trace
- `/ml`：进入多行输入（`/end` 提交，`/cancel` 取消）
- `/ls [path]` 或 `/list [path]`：只读列目录
- `/cat <file>` 或 `/read <file>`：只读读取文件内容（默认最多 64KB）
- `/exit`：退出

直接粘贴多行文本时，CLI 会自动合并为一条消息发送（无需先输入 `/ml`）。

Agent 也可在回答过程中自主触发工具调用（模型输出 `<tool_call>...</tool_call>` 协议）：

- `readonly.list`：只读列目录
- `readonly.read`：只读读文件
- `history.query`：查询对话记录上下文（blocks/recentEvents/prediction）
- `test.run`：运行白名单脚本（`typecheck` / `test` / `build` / `verify:arch`）

默认优先读取 `AgentDocs/AGENT.md` 并注入到系统提示中作为运行约束（兼容回退到工作目录向上的 `AGENTS.md`）。

当数据库暂无可检索历史块时，会自动注入 `AgentDocs/Introduction.md` 作为冷启动引导。

主动 seal 可通过环境变量调整：`MLEX_PROACTIVE_SEAL_ENABLED`、`MLEX_PROACTIVE_SEAL_IDLE_SECONDS`、`MLEX_PROACTIVE_SEAL_TURN_BOUNDARY`、`MLEX_PROACTIVE_SEAL_MIN_TOKENS`。

压缩决策可通过环境变量调整：`MLEX_COMPRESS_HIGH_MATCH`、`MLEX_COMPRESS_LOW_MATCH`、`MLEX_COMPRESS_SOFT_BAND`、`MLEX_COMPRESS_PRESERVE_WEIGHT`、`MLEX_COMPRESS_MIN_RAW_TOKENS`。

### Web 前端

```bash
npx mlex web --provider deepseek-reasoner --model deepseek-reasoner --port 8787
```

然后访问：`http://127.0.0.1:8787`

如果端口被占用，CLI 会自动回退到随机端口并打印最终地址。

页面内点击 `Debug` 按钮可打开右侧数据库调试窗口，展示存储后端、块/关系/原文数量、Retention 分布，并支持点击上下文块/数据库块/关系记录弹窗查看完整明细。
调试表格包含时间与顺序号，便于按时间线追踪上下文块与关系演进。
出于安全默认，Debug API、只读文件 API、`rawContext` 回传默认关闭；需要显式开启。
Web 输入框支持本地命令：`/trace [n]`（读取 trace）与 `/trace-clear`（清空 trace），命令会直接调用 Debug API，不会发送给模型。

启用示例（PowerShell 可直接复制）：

```powershell
npx mlex web --web-debug-api true --web-file-api true --web-raw-context true
```

如需给 Debug/文件 API 增加令牌鉴权：

```powershell
npx mlex web --web-debug-api true --web-file-api true --web-admin-token "YOUR_TOKEN"
```

请求时在 Header 里传：

- `x-mlex-admin-token: YOUR_TOKEN`
- 或 `Authorization: Bearer YOUR_TOKEN`

也可使用环境变量：

- `MLEX_WEB_DEBUG_API_ENABLED=true`
- `MLEX_WEB_FILE_API_ENABLED=true`
- `MLEX_WEB_EXPOSE_RAW_CONTEXT=true`
- `MLEX_WEB_ADMIN_TOKEN=YOUR_TOKEN`
- `MLEX_WEB_REQUEST_BODY_MAX_BYTES=262144`
- `MLEX_DEBUG_TRACE_ENABLED=true`
- `MLEX_DEBUG_TRACE_MAX_ENTRIES=2000`

Web API 也支持只读文件能力：

- `GET /api/capabilities`（返回 debug/file/rawContext 能力与是否要求 admin token）
- `GET /api/debug/traces?limit=500`（完整模型/Agent/工具调用 trace）
- `POST /api/debug/traces/clear`（清空 trace）
- `GET /api/files/list?path=.&maxEntries=200`
- `GET /api/files/read?path=README.md&maxBytes=65536`

### 导入文本

```bash
npx mlex ingest ./docs/notes.md
```

Lance（本地文件）示例：

```bash
npx mlex chat --storage-backend lance --lance-file .mlex/blocks.json
```

SQLite（推荐）示例：

```bash
npx mlex chat --storage-backend sqlite --raw-store-backend sqlite --relation-store-backend sqlite --sqlite-file .mlex/memory.db
```

Chroma 后端会在 `get/getMany/list` 时按需从远端集合水合数据（非仅进程内缓存）。

只读文件命令（CLI）：

```bash
npx mlex files:list .
npx mlex files:read README.md --max-bytes 2048
```

### 单次提问

```bash
npx mlex ask "回顾我们的 memory 架构"
```

流式单次提问：

```bash
npx mlex ask "总结当前方案" --provider openai --stream
```

### 多 Agent 协作

```bash
npx mlex swarm "构建上线方案" --provider openai --agents 3
```

会依次运行多个 Worker 角色（Planner/Implementer/Critic 等），最后由 Coordinator 汇总统一答案。

## 3) OpenAI Provider（可选）

```bash
set OPENAI_API_KEY=YOUR_KEY
set MLEX_PROVIDER=openai
npx mlex chat --provider openai --model gpt-4.1-mini
```

## 3.1) DeepSeek-Reasoner Provider（可选）

```bash
set DEEPSEEK_API_KEY=YOUR_KEY
set MLEX_PROVIDER=deepseek-reasoner
npx mlex chat --provider deepseek-reasoner --model deepseek-reasoner --stream
```

OpenAI 关系抽取器（轻量模型）：

```bash
npx mlex chat --provider openai --relation-extractor openai --relation-model gpt-4.1-nano
```

DeepSeek 关系抽取器（轻量模型）：

```bash
npx mlex chat --provider deepseek-reasoner --relation-extractor deepseek --relation-model deepseek-reasoner
```

## 3.2) SQLite 持久化配置（推荐）

PowerShell:

```powershell
$env:MLEX_STORAGE_BACKEND="sqlite"
$env:MLEX_RAW_STORE_BACKEND="sqlite"
$env:MLEX_RELATION_STORE_BACKEND="sqlite"
$env:MLEX_SQLITE_FILE=".mlex/memory.db"
npx mlex chat
```

## 4) 架构映射

- Phase 0 检索融合器：
  - `src/memory/retrieval/IBlockRetriever.ts`
  - `src/memory/retrieval/KeywordRetriever.ts`
  - `src/memory/retrieval/VectorRetriever.ts`
  - `src/memory/retrieval/GraphRetriever.ts`
  - `src/memory/retrieval/FusionRetriever.ts`
- Phase 1 分块策略：
  - `src/memory/chunking/IChunkStrategy.ts`
  - `src/memory/chunking/FixedTokenChunkStrategy.ts`
  - `src/memory/chunking/SemanticBoundaryChunkStrategy.ts`
  - `src/memory/chunking/HybridChunkStrategy.ts`
- Phase 2 存储抽象：
  - `src/memory/store/IBlockStore.ts`
  - `src/memory/store/InMemoryBlockStore.ts`
  - `src/memory/store/SQLiteBlockStore.ts`
  - `src/memory/sqlite/SQLiteDatabase.ts`
  - `src/memory/store/ChromaBlockStore.ts`
  - `src/memory/store/LanceBlockStore.ts`
  - `src/memory/raw/SQLiteRawEventStore.ts`
  - `src/memory/relation/SQLiteRelationStore.ts`
- Phase 3 关系抽取异步化：
  - `src/memory/relation/RelationExtractor.ts`
  - `src/memory/relation/OpenAIRelationExtractor.ts`
  - `src/memory/relation/DeepSeekRelationExtractor.ts`
  - `src/memory/relation/AsyncRelationQueue.ts`
- Phase 3.5 管理层策略：
  - `src/memory/management/HistoryMatchCalculator.ts`
  - `src/memory/management/RetentionPolicyEngine.ts`
  - `src/memory/management/RetentionActions.ts`
- Phase 3.6 预测层：
  - `src/memory/prediction/GraphEmbedder.ts`
  - `src/memory/prediction/Node2VecGraphEmbedder.ts`
  - `src/memory/prediction/TransEGraphEmbedder.ts`
  - `src/memory/prediction/WeightedRandomWalk.ts`
  - `src/memory/prediction/PredictorEngine.ts`
- Phase 3.7 输出组装层：
  - `src/memory/output/HybridRetriever.ts`
  - `src/memory/output/RawBacktracker.ts`
  - `src/memory/output/ContextAssembler.ts`
- Phase 4 配置与 DI：
  - `src/config.ts`
  - `src/container.ts`
- Agent 工作约束：
  - `AgentDocs/AGENT.md`（优先）
  - `AGENTS.md`（兼容回退）

## 5) 测试

```bash
npm test
```

## 6) 一键验收

```bash
npm run verify:arch
```

该命令会依次执行：

1. `typecheck`
2. `unit/integration tests`
3. `build`
4. `acceptance`（自动启动 Web、写入样例会话、校验分块/关系/预测/流式、重启后校验持久化）
