# 配置说明

GolemBot 使用一个配置文件：助手目录根目录下的 `golem.yaml`。

## 完整示例

```yaml
name: my-assistant
engine: claude-code          # cursor | claude-code | opencode | codex
model: claude-sonnet         # 可选，首选模型

# 可选：跳过 Agent 权限确认
skipPermissions: true

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
| `channels` | `object` | — | IM 通道配置 |
| `gateway` | `object` | — | Gateway 服务设置 |

### `channels`

配置一个或多个 IM 平台。Gateway 只会启动已配置的通道。

- `channels.feishu` — 见[飞书配置](/zh/channels/feishu)
- `channels.dingtalk` — 见[钉钉配置](/zh/channels/dingtalk)
- `channels.wecom` — 见[企业微信配置](/zh/channels/wecom)

### `gateway`

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `port` | `number` | `3000` | HTTP 服务端口 |
| `host` | `string` | `127.0.0.1` | 绑定地址 |
| `token` | `string` | — | HTTP API 认证 Bearer Token |

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
| `cursor` | Cursor 模型名称 | `claude-sonnet-4-5` | Cursor → Settings → Models |
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
  channels?: {
    feishu?: { appId: string; appSecret: string };
    dingtalk?: { clientId: string; clientSecret: string };
    wecom?: {
      corpId: string;
      agentId: string;
      secret: string;
      token: string;
      encodingAESKey: string;
      port?: number;
    };
  };
  gateway?: {
    port?: number;
    host?: string;
    token?: string;
  };
}
```
