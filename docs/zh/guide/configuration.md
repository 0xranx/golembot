# 配置说明

GolemBot 使用一个配置文件：助手目录根目录下的 `golem.yaml`。

## 完整示例

```yaml
name: my-assistant
engine: claude-code          # cursor | claude-code | opencode | codex
model: claude-sonnet         # 可选，首选模型

# 可选：跳过 Agent 权限确认
skipPermissions: true

# 可选：细粒度 Agent 权限控制（仅 Cursor 引擎）
permissions:
  allowedPaths:
    - ./src
    - ./tests
  deniedPaths:
    - ./.env
    - ./secrets
  allowedCommands:
    - npm test
    - npm run build
  deniedCommands:
    - rm -rf *

# 可选：角色/人设定义 — 写入 AGENTS.md 的 System Instructions 节，
# 引擎每次会话读取一次（不是每条消息前都拼接）
systemPrompt: |
  你是「运营小助手」，团队的专属运营伙伴，专注用户运营、内容运营和活动策划。
  你不是 OpenCode，不是编程助手，永远不要用 OpenCode 的身份介绍自己。
  在 IM 场景中回复时，不要在消息中包含原始 URL。

# 可选：生产可用性配置
timeout: 120                 # 引擎超时（秒，默认：300）
maxConcurrent: 20            # 最大并发 chat() 数（默认：10）
maxQueuePerSession: 2        # 每个用户最大排队数（默认：3）
sessionTtlDays: 14           # 闲置会话保留天数（默认：30）

# 可选：IM 通道流式消息投递
streaming:
  mode: streaming            # buffered（默认）| streaming
  showToolCalls: true        # 在 IM 中显示 🔧 工具提示（默认：false）

# 可选：群聊行为配置（适用于所有通道）
groupChat:
  groupPolicy: mention-only  # mention-only（默认）| smart | always
  historyLimit: 20           # 注入最近多少条消息作为上下文（默认：20）
  maxTurns: 10               # 每个群最多连续回复次数（默认：10，防死循环）

# 可选：定时任务
tasks:
  - id: daily-standup
    name: daily-standup
    schedule: "0 9 * * 1-5"
    prompt: |
      汇总过去 24 小时的所有 git commit，
      按作者分组，标注 breaking changes。
    enabled: true
    target:
      channel: feishu
      chatId: "oc_xxxxx"

# 可选：持久化消息队列（防崩溃丢消息，顺序消费）
inbox:
  enabled: true
  retentionDays: 7             # 已完成条目保留天数（默认：7）

# 可选：重启后抓取离线消息
historyFetch:
  enabled: true
  pollIntervalMinutes: 15      # 定时轮询间隔（默认：15）
  initialLookbackMinutes: 60   # 首次启动回看时长（默认：60）

# 可选：IM 通道配置
channels:
  feishu:
    appId: ${FEISHU_APP_ID}
    appSecret: ${FEISHU_APP_SECRET}
  dingtalk:
    clientId: ${DINGTALK_CLIENT_ID}
    clientSecret: ${DINGTALK_CLIENT_SECRET}
  wecom:
    corpId: ${WECOM_CORP_ID}
    agentId: ${WECOM_AGENT_ID}
    secret: ${WECOM_SECRET}
    token: ${WECOM_TOKEN}
    encodingAESKey: ${WECOM_ENCODING_AES_KEY}
    port: 9000

# 可选：Gateway 服务配置
gateway:
  port: 3000
  host: 127.0.0.1
  token: ${GOLEM_TOKEN}
```

## 字段说明

### 必填

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | `string` | 助手名称 |
| `engine` | `string` | 引擎类型：`cursor`、`claude-code`、`opencode` 或 `codex` |

### 可选

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `model` | `string` | — | 首选模型，格式因引擎而异 — 详见各引擎文档 |
| `skipPermissions` | `boolean` | `true` | 是否跳过 Agent 权限确认 |
| `timeout` | `number` | `300` | 引擎调用超时（秒）。超时后 CLI 进程被终止并触发 `type: 'error'` 事件 |
| `maxConcurrent` | `number` | `10` | 全局最大并发 `chat()` 调用数 |
| `maxQueuePerSession` | `number` | `3` | 每个 sessionKey 最大排队请求数 |
| `sessionTtlDays` | `number` | `30` | 闲置会话超过此天数后在下次启动时清理 |
| `systemPrompt` | `string` | — | 角色/人设指令，写入 `AGENTS.md` 的 `## System Instructions` 节，引擎将其作为系统级上下文读取一次。**不会**拼接到每条用户消息前，多轮对话的 token 消耗保持平稳 |
| `permissions` | `object` | — | 细粒度 Agent 权限控制，详见 [`permissions`](#permissions)。目前仅 Cursor 引擎支持 |
| `streaming` | `object` | — | IM 通道流式消息投递配置 |
| `tasks` | `array` | — | 定时任务列表，详见 [`tasks`](#tasks) |
| `channels` | `object` | — | IM 通道配置 |
| `inbox` | `object` | — | 持久化消息队列，详见 [`inbox`](#inbox) |
| `historyFetch` | `object` | — | 历史消息抓取，详见 [`historyFetch`](#historyfetch) |
| `gateway` | `object` | — | Gateway 服务设置 |

### `permissions`

细粒度 Agent 访问控制。配置后，`golembot init` 会生成 `.cursor/cli.json`，Cursor 引擎不再传 `--trust`，由 CLI 强制执行权限规则。

::: warning 仅 Cursor 引擎
目前仅 **Cursor** 引擎通过 `.cursor/cli.json` 支持细粒度权限。其他引擎会解析此配置但不会生效。
:::

```yaml
permissions:
  allowedPaths:
    - ./src
    - ./tests
  deniedPaths:
    - ./.env
    - ./secrets
  allowedCommands:
    - npm test
    - npm run build
  deniedCommands:
    - rm -rf *
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `allowedPaths` | `string[]` | Agent 可以读写的路径（相对于工作区） |
| `deniedPaths` | `string[]` | Agent 不可访问的路径 |
| `allowedCommands` | `string[]` | Agent 可以执行的 Shell 命令 |
| `deniedCommands` | `string[]` | Agent 不可执行的 Shell 命令 |

所有字段可选。空数组或未提供不产生影响。修改 permissions 后需重新运行 `golembot init` 以重新生成 `.cursor/cli.json`。

### `streaming`

控制 Gateway 如何向 IM 通道投递消息。

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `mode` | `string` | `buffered` | `buffered` — 等待完整回复后一次性发送。`streaming` — 在段落边界和工具调用事件处增量发送 |
| `showToolCalls` | `boolean` | `false` | 为 `true` 时，Agent 每次调用工具前会向聊天发送 `🔧 toolName...` 提示 |

**buffered** 模式（默认）下，bot 等 Agent 执行完毕后发送一条完整消息。**streaming** 模式下，bot 在语义边界处将文本刷新到 IM：

- **段落分隔**（`\n\n`）— 已完成的段落立即发送
- **工具调用** — 在发送工具提示前刷新已积累的文本
- **完成** — 刷新剩余文本

Streaming 模式为多步骤 Agent 长回复提供更快的视觉反馈。

```yaml
streaming:
  mode: streaming
  showToolCalls: true
```

### `channels`

配置一个或多个 IM 平台。Gateway 只会启动已配置的通道。

- `channels.feishu` — 见[飞书配置](/zh/channels/feishu)
- `channels.dingtalk` — 见[钉钉配置](/zh/channels/dingtalk)
- `channels.wecom` — 见[企业微信配置](/zh/channels/wecom)
- `channels.slack` — 见[Slack 配置](/zh/channels/slack)
- `channels.telegram` — 见[Telegram 配置](/zh/channels/telegram)
- `channels.discord` — 见[Discord 配置](/zh/channels/discord)
- 任意 key 加 `_adapter: <路径>` — 见[自定义 Adapter](/zh/channels/overview#自定义-adapter)

### `groupChat`

控制 bot 在群聊中的响应策略、@mention 处理、引用回复和群记忆。

```yaml
groupChat:
  groupPolicy: smart     # mention-only（默认）| smart | always
  historyLimit: 30       # 注入最近 30 条历史（默认：20）
  maxTurns: 5            # 连续回复超过 5 次后自动沉默（默认：10）
```

详见[群聊](/zh/guide/group-chat)，了解策略、Mention 处理、引用回复和群记忆的完整说明。

### 会话历史

GolemBot 自动记录对话并在 session 丢失时恢复上下文。无需配置。详见[记忆系统](/zh/guide/memory)。

### `gateway`

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `port` | `number` | `3000` | HTTP 服务端口 |
| `host` | `string` | `127.0.0.1` | 绑定地址 |
| `token` | `string` | — | HTTP API 认证 Bearer Token |

### `inbox`

持久化消息队列——消息不丢失，顺序消费。

```yaml
inbox:
  enabled: true          # 默认：false
  retentionDays: 7       # 已完成条目保留天数
```

### `historyFetch`

重启后智能追回离线消息。

```yaml
historyFetch:
  enabled: true
  pollIntervalMinutes: 15
  initialLookbackMinutes: 60
```

详见[消息队列与离线追回](/zh/guide/inbox)，了解崩溃恢复、智能分诊、平台支持和去重机制的完整说明。

### `tasks`

配置定时任务（Cron Jobs），Gateway 会按计划自动执行。

```yaml
tasks:
  - id: daily-standup
    name: daily-standup
    schedule: "0 9 * * 1-5"
    prompt: |
      汇总过去 24 小时的所有 git commit，
      按作者分组，标注 breaking changes。
    enabled: true
    target:
      channel: feishu
      chatId: "oc_xxxxx"
```

详见[定时任务](/zh/guide/scheduled-tasks)，了解完整配置参考、调度格式、管理命令和使用场景。

## 环境变量占位符

敏感字段支持 `${ENV_VAR}` 语法。加载时，GolemBot 会从 `process.env` 中解析这些值。

```yaml
gateway:
  token: ${GOLEM_TOKEN}    # 从 process.env.GOLEM_TOKEN 解析
```

这适用于 `channels` 和 `gateway` 中的所有字符串值。在 `golem.yaml` 旁放一个 `.env` 文件 — CLI 启动时会自动加载。

### `.env` 示例

```sh
FEISHU_APP_ID=cli_xxxxxxxxxx
FEISHU_APP_SECRET=xxxxxxxxxx
GOLEM_TOKEN=my-secret-token
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxx
```

::: tip
将 `.env` 加入 `.gitignore`，提交 `.env.example`（不含真实值）用于共享。
:::

## 各引擎模型名称格式

`model` 字段的格式因引擎不同而不同：

| 引擎 | 格式 | 示例 | 查看可用值 |
|------|------|------|------------|
| `cursor` | Cursor 模型名称 | `sonnet-4.6` | Cursor → Settings → Models |
| `claude-code` | Anthropic model ID | `claude-sonnet-4-6` | `claude models` |
| `opencode` | `provider/model` | `anthropic/claude-sonnet-4-5` | `opencode models` |
| `codex` | OpenAI 模型名称 | `codex-mini-latest` | `codex models` |

详见各引擎页面中的完整模型表格和运行时覆盖用法。

## 技能不在配置中声明

技能**不**在 `golem.yaml` 中声明。`skills/` 目录是唯一的事实来源 — 目录里有什么技能，助手就有什么能力。详见[技能](/zh/skills/overview)。

## GolemConfig TypeScript 类型

```typescript
interface GolemConfig {
  name: string;
  engine: string;
  model?: string;
  skipPermissions?: boolean;
  timeout?: number;             // 秒，默认 300
  maxConcurrent?: number;       // 默认 10
  maxQueuePerSession?: number;  // 默认 3
  sessionTtlDays?: number;      // 默认 30
  systemPrompt?: string;
  permissions?: {
    allowedPaths?: string[];
    deniedPaths?: string[];
    allowedCommands?: string[];
    deniedCommands?: string[];
  };
  streaming?: {
    mode?: 'buffered' | 'streaming';  // 默认：'buffered'
    showToolCalls?: boolean;          // 默认：false
  };
  groupChat?: {
    groupPolicy?: 'mention-only' | 'smart' | 'always';  // 默认：'mention-only'
    historyLimit?: number;   // 默认：20
    maxTurns?: number;       // 默认：10
  };
  channels?: {
    feishu?: { appId: string; appSecret: string };
    dingtalk?: { clientId: string; clientSecret: string };
    wecom?: {
      corpId: string; agentId: string; secret: string;
      token: string; encodingAESKey: string; port?: number;
    };
    slack?: { botToken: string; appToken: string };
    telegram?: { botToken: string };
    discord?: { botToken: string; botName?: string };
    // 自定义 adapter：任意 key，需包含 _adapter 字段
    [key: string]: { _adapter: string; [k: string]: unknown } | undefined;
  };
  tasks?: Array<{
    id: string;
    name: string;
    schedule: string;
    prompt: string;
    enabled?: boolean;           // 默认 true
    target?: {
      channel: string;
      chatId: string;
    };
  }>;
  inbox?: {
    enabled?: boolean;           // 默认：false
    retentionDays?: number;      // 默认：7
  };
  historyFetch?: {
    enabled?: boolean;           // 默认：false
    pollIntervalMinutes?: number;    // 默认：15
    initialLookbackMinutes?: number; // 默认：60
  };
  gateway?: {
    port?: number;
    host?: string;
    token?: string;
  };
}
```
