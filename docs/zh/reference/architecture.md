# GolemBot 架构设计

> **为什么叫 "GolemBot"？** Golem（魔像）是传说中用泥土塑造的躯体——在上面写下真名（shem），它就会活过来。
> 我们的项目也是同样的道理：将一个 Coding Agent 作为灵魂注入目录，它就变成了你的 AI 助手。

> 本文档是 GolemBot 项目的核心架构参考。所有实现都应与本文档保持一致。
> 当实现与架构产生冲突，或需要变更和优化时，**必须先更新本文档**，再修改代码。

## 1. 产品定位

**GolemBot 是一个本地优先的个人 AI 助手——它使用你已有的 Coding Agent 作为大脑，不仅能聊天，还能真正帮你做事。**

使用场景与 OpenClaw 类似（个人助手、多频道接入、技能扩展），核心区别在于大脑：

- OpenClaw：直接调用 LLM API + 自定义工具系统 → 大脑是无状态的 API
- GolemBot：使用 Coding Agent CLI 作为引擎 → **大脑是一个有状态的、住在目录里的 Coding Agent**

这带来了一个关键的体验差异：**OpenClaw 的助手是全局的，而 GolemBot 的助手是绑定到目录的。** 因为 Coding Agent 天然在目录中工作——技能、脚本、记忆和工作产物都在里面。

独特优势：

- **更强大**：Coding Agent 原生支持读写文件、运行代码、操作浏览器、多步推理
- **引擎可选**：Cursor / Claude Code / OpenCode / Codex——用哪个随你
- **完全透明**：`ls` 一下助手目录就能看到它知道什么、能做什么、做过什么
- **可版本控制**：整个助手可以通过 git 管理、分享、克隆

## 2. 核心理念

**Coding Agent = 灵魂，GolemBot = 泥土之躯。**

GolemBot 不实现 LLM 推理、工具调用、上下文管理。它只做三件事：

1. 准备工作区（注入技能）
2. 调用 Coding Agent CLI（传入用户消息）
3. 将响应返回给用户

所有复杂工作（决策、规划、执行）都委托给 Coding Agent。

### 库优先，CLI 只是薄壳

GolemBot 的核心是一个**可导入的 TypeScript 库**，而非 CLI 工具。CLI 只是这个库的一个消费者。

```
              golembot 核心库 (index.ts)
             createAssistant() → Assistant
            /        |         \         \
       CLI 薄壳    库导入     HTTP       Bot
      (cli.ts)  (第三方)    封装       封装
                          (第三方)    (第三方)
```

所有调用方式共享相同的核心逻辑，零重复。这使得 GolemBot 易于**嵌入任何场景**，作为各种领域 Agent 方案的核心引擎。

## 3. 两个核心概念

整个框架只有两个概念——不多不少：

### 1. 助手目录

一个目录就是一个助手（一个 GolemBot）。目录结构：

```
~/my-assistant/
├── golem.yaml             # 助手配置（只配引擎类型和名字）
├── skills/                # 技能目录——里面有什么就加载什么
│   ├── general/
│   │   └── SKILL.md       # 通用助手技能
│   └── ops-xhs/
│       ├── SKILL.md       # 小红书运营技能
│       ├── xhs.py         # 技能附带的脚本
│       └── brand-voice.md # 辅助知识文档
├── AGENTS.md              # Golem 自动生成的上下文文档
├── .golem/                # 内部状态（会话等，gitignore）
└── ...                    # Agent 工作过程中产生的文件（笔记、数据、报告等）
```

配置文件 `golem.yaml` 很精简——只配引擎，不配技能：

```yaml
name: my-assistant
engine: cursor              # cursor | claude-code | opencode | codex
model: claude-sonnet        # 可选，首选模型

# 可选：IM 频道配置（gateway 会连接所有已配置的频道）
channels:
  feishu:
    appId: ${FEISHU_APP_ID}
    appSecret: ${FEISHU_APP_SECRET}
  dingtalk:
    clientId: ${DINGTALK_CLIENT_ID}
    clientSecret: ${DINGTALK_CLIENT_SECRET}

# 可选：网关服务配置
gateway:
  port: 3000
  token: ${GOLEM_TOKEN}
```

敏感字段支持 `${ENV_VAR}` 占位符引用环境变量（由 `resolveEnvPlaceholders()` 在加载时解析）。`channels` 和 `gateway` 都是可选的——不配置时行为与纯 CLI 模式完全一致。

**技能不在配置文件中声明。** `skills/` 目录是唯一的事实来源——里面有什么技能，助手就具备什么能力。想加技能？把文件夹放进去。想删？把文件夹删掉。`ls skills/` 就能看到助手的完整能力集。

### 2. 技能

技能是助手能力的载体。一个技能就是一个目录，包含：

- `SKILL.md`：知识和指令（必须）
- 其他辅助文件：知识文档、脚本、配置模板等（可选）

格式完全兼容 Cursor 的 `.cursor/skills/`、Claude Code 的 `.claude/skills/`，以及 OpenClaw 的 `SKILL.md`。

**没有独立的 Tool 概念。** 脚本直接放在技能目录中，`SKILL.md` 描述如何调用它们。Coding Agent 原生就能执行任何脚本——不需要框架层面的"注册"。

## 4. 使用方式

所有方式内部共享相同的核心逻辑（`createAssistant` → `assistant.chat()`）。

### 方式一：CLI（最快上手）

```bash
npm install -g golembot

mkdir ~/my-assistant && cd ~/my-assistant
golembot init         # 交互式：选引擎、起名字、生成配置、拷贝默认技能
golembot run          # REPL 对话
```

想加技能？直接把技能文件夹放到 `skills/` 目录下——不需要任何命令。

### 方式二：库导入（开发者嵌入）

```typescript
import { createAssistant } from 'golembot';

const assistant = createAssistant({ dir: './my-agent' });

for await (const event of assistant.chat('分析竞品数据')) {
  if (event.type === 'text') process.stdout.write(event.content);
}
```

### 方式三：嵌入各种场景

Slack Bot：

```typescript
import { createAssistant } from 'golembot';
const assistant = createAssistant({ dir: './slack-agent' });

slackApp.message(async ({ message, say }) => {
  let reply = '';
  for await (const event of assistant.chat(message.text)) {
    if (event.type === 'text') reply += event.content;
  }
  await say(reply);
});
```

HTTP API：

```typescript
import { createAssistant } from 'golembot';
const agent = createAssistant({ dir: './api-agent' });

app.post('/api/chat', async (req, res) => {
  for await (const event of agent.chat(req.body.message)) {
    res.write(JSON.stringify(event) + '\n');
  }
  res.end();
});
```

Electron 桌面应用、Telegram 机器人、cron 定时任务……都是同一个模式：创建助手 → 调用 chat() → 处理事件流。

### 方式四：网关（IM + HTTP 统一服务）

```bash
golembot gateway              # 从 golem.yaml 读取频道配置，启动 IM 适配器 + HTTP 服务
golembot gateway --port 3000  # 覆盖端口
golembot gateway --verbose    # 详细日志
```

网关是一个**常驻服务**，内部复用 `createAssistant()` + `server.ts`，上面加了一层 IM 频道适配层。`golem.yaml` 中配了哪些频道，网关启动时就自动连接对应的 IM 平台：

- **飞书（Lark）**：WebSocket 长连接模式（无需公网 IP）
- **钉钉**：Stream 模式（WebSocket，无需公网 IP）
- **企业微信**：Webhook 回调模式（需要公网 URL）

IM 频道和 HTTP API 并行工作。一个频道崩溃不影响其他的。

### 方式五：引导式配置向导

```bash
mkdir my-bot && cd my-bot
golembot onboard
```

交互式引导配置（7 步）：选引擎 → 起名字 → 选 IM 频道 → 配频道凭据 → 选场景模板 → 生成配置 → 启动网关。自动生成 `golem.yaml`、`.env`、`.env.example` 和 `.gitignore`。

## 5. 架构

### 源文件结构

核心与 CLI 分离：

**核心库（可导入）：**

- **`index.ts`** — 公共 API：`createAssistant(opts) → Assistant`。协调工作区、引擎和会话。包含并发锁：对于同一个助手实例和同一个 sessionKey，同时只能执行一个 `chat()`；不同 sessionKey 可以并行。
- **`engine.ts`** — 引擎接口 + Cursor / Claude Code / OpenCode / Codex 四引擎实现。进程管理和技能注入是引擎内部细节。
- **`workspace.ts`** — 读取 `golem.yaml`（包括 `channels` 和 `gateway` 字段），扫描 `skills/` 目录，自动生成 `AGENTS.md`。`resolveEnvPlaceholders()` 解析 `${ENV_VAR}` 占位符。
- **`session.ts`** — 多用户会话存储：`.golem/sessions.json`，按 `sessionKey` 索引。
- **`server.ts`** — HTTP 服务：`createServer(assistant, opts) → http.Server`。`POST /chat`（SSE）、`POST /reset`、`GET /health`。
- **`channel.ts`** — `ChannelAdapter` 接口和 `ChannelMessage` 类型定义。`buildSessionKey()` 生成频道级会话 key，`stripMention()` 去除 @提及。
- **`channels/feishu.ts`** — 飞书适配器（`@larksuiteoapi/node-sdk` WebSocket 长连接模式）。
- **`channels/dingtalk.ts`** — 钉钉适配器（`dingtalk-stream` Stream 模式）。
- **`channels/wecom.ts`** — 企业微信适配器（`@wecom/crypto` + `xml2js` Webhook 回调模式）。
- **`gateway.ts`** — 网关常驻服务：读取 golem.yaml → 创建 Assistant → 启动 HTTP 服务 → 遍历频道配置启动适配器 → 将消息路由到 `assistant.chat()` → 回复。启动时自动注册到 Fleet 目录。
- **`dashboard.ts`** — 网关 Dashboard：指标收集、SSE 广播、HTML 渲染（频道状态、统计、活动流、快速测试）。
- **`ui-shared.ts`** — 共享 UI 常量（CSS、favicon、引擎配色、HTML 转义），供 Dashboard 和 Fleet 共用。
- **`fleet.ts`** — Fleet 多 bot 管理：文件系统注册表（`~/.golembot/fleet/`）、PID 存活检测、Fleet Dashboard HTML 渲染、Fleet HTTP 服务。

**CLI 薄壳：**

- **`cli.ts`** — 命令入口：`init`、`run`、`serve`、`gateway`、`onboard`、`status`、`skill`、`fleet`。自动加载 `.env` 文件。
- **`onboard.ts`** — 引导式配置向导（7 步交互）。生成 golem.yaml、.env、.env.example、.gitignore，可选安装场景模板。

**IM SDK 依赖策略**：`@larksuiteoapi/node-sdk`、`dingtalk-stream`、`@wecom/crypto` 和 `xml2js` 都是可选的 peerDependencies。网关启动时动态导入对应 SDK，缺少时给出安装提示。

### 核心 API

```typescript
export function createAssistant(opts: {
  dir: string;           // 助手目录路径
  engine?: string;       // 覆盖 golem.yaml 中的引擎配置
  model?: string;        // 覆盖模型配置
  apiKey?: string;       // Agent API key（Cursor: CURSOR_API_KEY, Claude Code: ANTHROPIC_API_KEY, OpenCode: 取决于提供商）
}): Assistant;

export interface Assistant {
  chat(message: string, opts?: { sessionKey?: string }): AsyncIterable<StreamEvent>;
  init(opts: { engine: string; name: string }): Promise<void>;
  resetSession(sessionKey?: string): Promise<void>;
}

export type StreamEvent =
  | { type: 'text'; content: string }
  | { type: 'tool_call'; name: string; args: string }
  | { type: 'tool_result'; content: string }
  | { type: 'error'; message: string }
  | { type: 'done'; sessionId?: string; durationMs?: number; costUsd?: number; numTurns?: number };
```

`costUsd` 和 `numTurns` 由 Claude Code 引擎提供；Cursor 引擎下为 `undefined`。

API 极简：`createAssistant` + `chat` + `init` + `resetSession`——仅此而已。

### 会话路由（sessionKey）

`chat()` 接受可选的 `sessionKey` 参数，用于多用户场景下的会话隔离：

```typescript
// 单用户（Phase 1 模式，完全向后兼容）
assistant.chat("你好")
// 等价于 assistant.chat("你好", { sessionKey: "default" })

// 多用户——每个用户获得独立的引擎会话
assistant.chat("你好", { sessionKey: "feishu:user_123" })
assistant.chat("查一下数据", { sessionKey: "slack:U456" })
```

存储结构变化：

```json
// Phase 1: .golem/sessions.json
{ "engineSessionId": "abc-123" }

// Phase 2: .golem/sessions.json
{
  "default": { "engineSessionId": "abc-123" },
  "feishu:user_123": { "engineSessionId": "def-456" },
  "slack:U456": { "engineSessionId": "ghi-789" }
}
```

设计原则：
- 默认 key 是 `"default"`——单用户场景无需感知 sessionKey
- 不同的 sessionKey 映射到不同的引擎会话，但**共享相同的技能和工作目录**
- 锁粒度从"一把全局锁"变为**按 sessionKey 加锁**：相同 key 排队，不同 key 并行
- `resetSession(key?)` 清除指定 key 的会话；省略则清除 `"default"`

### HTTP 服务（`golembot serve`）

内置轻量 HTTP 服务，可让任何 IM webhook 接入：

```bash
golembot serve --port 3000 --token my-secret
```

**接口设计：**

```
POST /chat
  Headers: Authorization: Bearer <token>
  Body: { "message": "你好", "sessionKey": "feishu:user_123" }
  Response: text/event-stream (SSE)
    data: {"type":"text","content":"你好"}
    data: {"type":"tool_call","name":"readFile","args":"{}"}
    data: {"type":"done","sessionId":"xxx"}

POST /reset
  Headers: Authorization: Bearer <token>
  Body: { "sessionKey": "feishu:user_123" }
  Response: 200 { "ok": true }

GET /health
  Response: 200 { "status": "ok", "name": "my-assistant" }
```

**设计原则：**
- 使用 Node.js 内置 `node:http`，零额外依赖
- SSE 协议（`text/event-stream`），所有语言/平台都能消费
- Bearer token 认证（`--token` 参数或 `GOLEM_TOKEN` 环境变量）
- `server.ts` 导出 `createServer()` 工厂函数，CLI 和第三方都能使用

**接入 IM 的典型流程：**

```
飞书 webhook → 你的 3 行转发脚本 → POST localhost:3000/chat → SSE → 推回飞书
Slack event  → 你的 3 行转发脚本 → POST localhost:3000/chat → SSE → 推回 Slack
```

**也可以直接导入库（不走 HTTP）：**

```typescript
import { createAssistant } from 'golembot';
const bot = createAssistant({ dir: './my-bot' });

slackApp.message(async ({ message, say }) => {
  let reply = '';
  for await (const ev of bot.chat(message.text, { sessionKey: `slack:${message.user}` })) {
    if (ev.type === 'text') reply += ev.content;
  }
  await say(reply);
});
```

### `init` 工作流

```
golembot init（或 assistant.init()）
1. 检查目录是否已有 golem.yaml → 有则报错
2. 交互提示：引擎类型（cursor/claude-code/opencode）、助手名称
3. 创建 golem.yaml
4. 创建 skills/ 目录
5. 将内置技能拷贝到 skills/（general + im-adapter）
6. 创建 .golem/ 目录（内部状态）
7. 生成 AGENTS.md
8. 生成 .gitignore（忽略 .golem/）
```

### 网关工作流

```
golembot gateway
1. 自动加载 .env（在 CLI 入口层）
2. 读取 golem.yaml（channels + gateway 配置）
3. resolveEnvPlaceholders() 解析 ${ENV_VAR} 占位符
4. 创建 Assistant 实例
5. 启动 HTTP 服务（Dashboard 位于 GET /，/api/status、/api/events 端点）
6. 遍历频道配置，动态导入并启动对应适配器
7. 注册到 Fleet 目录（~/.golembot/fleet/<name>-<port>.json）
8. 适配器收到消息 → buildSessionKey() → stripMention() → assistant.chat() → 回复
9. 流式响应拼接为完整文本后一次性发送（IM 平台不支持流式）
10. SIGINT/SIGTERM → 从 Fleet 注销 → 优雅关闭所有适配器和 HTTP 服务
```

### 数据流：一轮对话

无论通过 CLI 还是库导入调用，内部流程完全一致：

```
调用方 → assistant.chat(message)
  → index.ts: 获取并发锁
  → workspace.ts: ensureReady() — 扫描 skills/ + 生成 AGENTS.md
  → engine.ts: invoke(message, skillList, sessionId?)
    → 注入技能：
        Cursor    → .cursor/skills/ 软链接
        Claude    → .claude/skills/ 软链接 + CLAUDE.md
        OpenCode  → .opencode/skills/ 软链接 + opencode.json
    → 启动 Agent 进程：
        Cursor    → child_process.spawn
        Claude    → child_process.spawn
        OpenCode  → child_process.spawn
    → 逐行解析输出 → yield StreamEvent
  → index.ts: 保存会话 + 释放锁
  → 调用方收到 StreamEvent 流
```

### AGENTS.md 自动生成

`workspace.ts` 在每次 `ensureReady()` 调用时，基于扫描 `skills/` 目录，在助手目录中自动生成 `AGENTS.md`（注意：是在助手目录中，不是本项目的）：

```markdown
# Assistant Context

## Installed Skills
- general: 通用个人助手能力
- ops-xhs: 小红书运营助手（包含 xhs.py 脚本）

## Directory Structure
- skills/ — 技能目录（每个子目录是一个技能，包含 SKILL.md 和可选脚本）
- AGENTS.md — 本文件，由 GolemBot 自动生成

## Conventions
- 需要持久记住的信息应写入 notes.md
- 生成的报告/文件放入对应目录
```

这让 Coding Agent 一启动就能理解自己的环境和能力。

## 6. 多轮交互

- **引擎原生优先**：多轮上下文依赖 Coding Agent CLI 的原生会话机制（Cursor 和 Claude Code 都支持 `--resume`）
- **不支持 resume 的引擎按单轮处理**：工作区中的文件是唯一的跨轮记忆
- **无 TTL**：GolemBot 不主动过期会话；引擎自行管理会话生命周期
- **resume 失败自动回退**：如果引擎的 `--resume` 失败（引擎侧过期/损坏），自动启动新会话，对用户透明
- **手动重置**：用户可通过 `/reset`（CLI）或 `assistant.resetSession()`（API）显式清除会话
- **会话存储**：`.golem/sessions.json`，仅存储 `{ engineSessionId }`

## 7. 引擎接口

```typescript
interface AgentEngine {
  invoke(prompt: string, opts: {
    workspace: string;       // 助手目录路径
    skillPaths: string[];    // skills/ 下技能目录的绝对路径
    sessionId?: string;
    model?: string;
  }): AsyncIterable<StreamEvent>;
}

type StreamEvent =
  | { type: 'text'; content: string }
  | { type: 'tool_call'; name: string; args: string }
  | { type: 'tool_result'; content: string }
  | { type: 'error'; message: string }
  | { type: 'done'; sessionId?: string; durationMs?: number; costUsd?: number; numTurns?: number };
```

四个引擎实现，通过 `createEngine(type)` 工厂函数创建：

**CursorEngine** — 通过 child_process.spawn 调用 `agent` CLI：

```typescript
class CursorEngine implements AgentEngine {
  async *invoke(prompt, opts) {
    // 1. 注入技能：将 skillPaths 软链接到 .cursor/skills/
    // 2. spawn: agent -p <prompt> --output-format stream-json --stream-partial-output ...
    // 3. stripAnsi + 逐行解析 stream-json → yield StreamEvent
    // 4. segmentAccum 去重（Cursor 的摘要事件）
  }
}
```

**ClaudeCodeEngine** — 通过 child_process.spawn 调用 `claude` CLI：

```typescript
class ClaudeCodeEngine implements AgentEngine {
  async *invoke(prompt, opts) {
    // 1. 注入技能：将 skillPaths 软链接到 .claude/skills/ + 生成 CLAUDE.md
    // 2. spawn: claude -p <prompt> --output-format stream-json --verbose --dangerously-skip-permissions ...
    // 3. 逐行解析 stream-json → parseClaudeStreamLine() → yield StreamEvent[]
    // 4. 不需要 ANSI 清理或去重
  }
}
```

**OpenCodeEngine** — 通过 child_process.spawn 调用 `opencode` CLI：

```typescript
class OpenCodeEngine implements AgentEngine {
  async *invoke(prompt, opts) {
    // 1. 注入技能：将 skillPaths 软链接到 .opencode/skills/
    // 2. 生成/更新 opencode.json（权限配置 + 模型配置）
    // 3. spawn: opencode run "prompt" --format json [--model provider/model] [--session ses_xxx]
    // 4. 逐行解析 NDJSON → parseOpenCodeStreamLine() → yield StreamEvent[]
    // 5. 多提供商 API Key 通过 resolveOpenCodeEnv() 推断
  }
}
```

四个引擎的关键差异：

| | CursorEngine | ClaudeCodeEngine | OpenCodeEngine | CodexEngine |
|---|---|---|---|---|
| 启动方式 | child_process.spawn | child_process.spawn | child_process.spawn | child_process.spawn |
| 输出格式 | stream-json（带 ANSI） | stream-json（纯 JSON） | NDJSON（`--format json`） | JSON（`--json`） |
| 技能注入 | `.cursor/skills/` 软链接 | `.claude/skills/` + CLAUDE.md | `.opencode/skills/` + opencode.json | N/A（prompt 注入） |
| 会话恢复 | `--resume <uuid>` | `--resume <uuid>` | `--session <ses_xxx>` | `exec resume <thread_id>` |
| API Key | CURSOR_API_KEY | ANTHROPIC_API_KEY | 取决于提供商 | CODEX_API_KEY |
| 权限绕过 | `--force --trust --sandbox disabled` | `--dangerously-skip-permissions` | opencode.json permission | `--full-auto` |

但对外暴露的 `StreamEvent` 完全一致。

## 8. 关键设计决策

1. **库优先，CLI 是薄壳**：核心是可导入的库（`createAssistant`）；CLI 只是一个消费者。这使得 GolemBot 可嵌入任何场景。
2. **目录即助手**：助手住在目录里，目录是唯一的事实来源。Coding Agent 天然在目录中工作——这是与 OpenClaw（全局配置）的刻意差异。
3. **目录即技能列表**：`skills/` 里有什么就加载什么——技能不在配置文件中声明，消除配置与现实的不一致。
4. **只有两个概念**：助手目录 + 技能。没有 Tools、没有 Blueprints、没有 Registry。
5. **技能即能力**：知识（Markdown）和工具（脚本）都在技能目录中，不分开。Coding Agent 原生能执行脚本——不需要框架"注册"。
6. **技能注入是引擎的责任**：每个引擎自行决定如何注入技能（Cursor → `.cursor/skills/` 软链接，Claude Code → `.claude/skills/` 软链接 + `CLAUDE.md`，OpenCode → `.opencode/skills/` 软链接 + `opencode.json`）——核心层不关心。
7. **不做 Agent 该做的事**：不做上下文管理、不做工具调度、不做决策、不做会话 TTL。一切委托给 Coding Agent。
8. **并发安全**：同一个助手实例在任意时刻只允许执行一个 `chat()`，防止多个请求同时操作工作区。
9. **TypeScript**：成熟的频道生态（Telegram/Slack/Discord），且子进程调用与语言无关。

## 9. 演进路线

**Phase 1 — CLI 助手（当前）**

- `golembot init` + `golembot run` 两个命令
- Cursor 引擎（child_process.spawn + 技能注入）
- 技能目录扫描
- 会话管理（resume + 自动回退）
- 并发锁
- 4 个核心源文件 + 1 个 CLI 薄壳

**Phase 2 — 多用户 + HTTP 服务（当前）**

- 会话路由：`chat(msg, { sessionKey })` 支持多用户隔离
- 并发锁按 sessionKey 隔离：不同用户可并行
- `server.ts`：内置 HTTP 服务 + SSE 流式响应 + Bearer token 认证
- `golembot serve` CLI 命令
- 会话存储升级为按 key 索引的多用户结构

**Phase 3 — 多引擎** ✅

- ~~Claude Code 引擎~~ ✅（`ClaudeCodeEngine`，stream-json 解析，原生 `.claude/skills/` 注入）
- ~~OpenCode 引擎~~ ✅（`OpenCodeEngine`，NDJSON 解析，`.opencode/skills/` 注入，多提供商 API Key，`opencode.json` 权限配置）
- ~~Codex 引擎~~ ✅（`CodexEngine`，JSON 解析，`exec`/`exec resume` 子命令，`CODEX_API_KEY`）

**Phase 4 — 网关 + IM 频道** ✅

- ~~`ChannelAdapter` 接口 + `ChannelMessage` 类型~~ ✅
- ~~飞书适配器（WebSocket 长连接，`@larksuiteoapi/node-sdk`）~~ ✅
- ~~钉钉适配器（Stream，`dingtalk-stream`）~~ ✅
- ~~企业微信适配器（Webhook，`@wecom/crypto`）~~ ✅
- ~~网关常驻服务（`golembot gateway`）~~ ✅
- ~~`golem.yaml` 扩展 `channels` + `gateway` 字段~~ ✅
- ~~`${ENV_VAR}` 占位符解析~~ ✅
- ~~CLI `.env` 自动加载~~ ✅

**Phase 5 — 开箱即用** ✅

- ~~引导式配置向导（`golembot onboard`，7 步交互）~~ ✅
- ~~内置技能：`general`（增强版，含持久记忆约定）+ `im-adapter`（IM 回复约定）~~ ✅
- ~~模板系统（6 个场景模板：customer-support、data-analyst、code-reviewer、ops-assistant、meeting-notes、research）~~ ✅
- ~~Docker 部署（Dockerfile + docker-compose.yml）~~ ✅
- ~~README.md + LICENSE + CONTRIBUTING.md~~ ✅

**Phase 6 — 生态扩展**

- ~~技能仓库（`golembot skill search/install`，社区技能发现和安装）~~ ✅（ClawHub 集成）
- ~~多 bot Fleet Dashboard（`golembot fleet ls` / `golembot fleet serve`）~~ ✅（文件系统注册表，零配置发现）
- ~~单 bot Web Dashboard，实时指标和活动流~~ ✅
- 权限集成（`golem.yaml` 项目级权限配置）
- WebSocket 支持（双向通信）
