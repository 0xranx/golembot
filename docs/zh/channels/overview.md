# 通道概览

GolemBot 的 Gateway 将你的助手接入 IM 平台。每个平台由一个**通道适配器**处理，在 IM SDK 和 GolemBot 的 `assistant.chat()` API 之间转换。

## 支持的通道

| 通道 | 传输方式 | 需要公网 IP | SDK |
|------|----------|------------|-----|
| [飞书](/zh/channels/feishu) | WebSocket | 否 | `@larksuiteoapi/node-sdk` |
| [钉钉](/zh/channels/dingtalk) | Stream（WebSocket） | 否 | `dingtalk-stream` |
| [企业微信](/zh/channels/wecom) | Webhook HTTP | **是** | `@wecom/crypto` + `xml2js` |
| [Slack](/zh/channels/slack) | Socket Mode（WebSocket） | 否 | `@slack/bolt` |
| [Telegram](/zh/channels/telegram) | Long-polling | 否 | `grammy` |
| [Discord](/zh/channels/discord) | Gateway WebSocket | 否 | `discord.js` |
| 自定义 | 任意 | 视实现而定 | 你自己的 Adapter 类 |

## 架构

```
IM 平台 → 通道 Adapter → assistant.chat() → 文本回复 → adapter.reply()
```

Gateway 流程：

1. 从 `golem.yaml` 读取 `channels` 配置
2. 动态 import 每个已配置通道的 SDK
3. 所有 Adapter 与 HTTP 服务并行启动
4. 对每条入站消息：解析 session key → 构建上下文 → `assistant.chat()`
5. 累积完整文本回复，按平台字数限制拆分后逐段发送

## 消息长度限制

每个平台有最大消息长度。GolemBot 自动拆分长回复：

| 通道 | 最大长度 | 拆分方式 |
|------|----------|----------|
| 飞书 | 4,000 字符 | 多条消息 |
| 钉钉 | 4,000 字符 | 多条消息 |
| 企业微信 | 2,048 字符 | 多条消息 |
| Slack | 4,000 字符 | 多条消息 |
| Telegram | 4,096 字符 | 多条消息 |
| Discord | 2,000 字符 | 多条消息 |
| 自定义 | 可通过 `maxMessageLength` 配置 | 多条消息 |

## 会话路由

**私聊消息**使用 per-user key：`${channelType}:${chatId}:${senderId}` — 每个用户拥有独立的对话上下文。Gateway 会注入上下文让 bot 知道自己在私聊中、对方是谁。

**群消息**使用 group-scoped key：`${channelType}:${chatId}` — 同一个群里的所有用户共享一个 session，agent 能看到完整的群对话上下文，包括最近的消息历史。

## 群聊行为

通过 `golem.yaml` 中的 `groupChat` 字段配置 bot 在群聊中的响应策略：

```yaml
groupChat:
  groupPolicy: mention-only   # mention-only（默认）| smart | always
  historyLimit: 20            # 注入最近多少条消息作为上下文
  maxTurns: 10                # 最大连续 bot 回复次数（安全阀）
```

| 策略 | Agent 调用时机 | Bot 何时回复 |
|------|--------------|------------|
| `mention-only` | 仅被 @mention 时 | 仅被 @mention 时（零成本跳过） |
| `smart` | 所有群消息 | Agent 自己决定（输出 `[PASS]` 保持沉默） |
| `always` | 所有群消息 | 每条消息都回复 |

详见[配置说明](/zh/guide/configuration#groupchat)。

## Mention 处理

### 入站 @mention

GolemBot 在将消息传给 agent 前会自动去除 @mention 标记，兼容飞书 XML 格式（`<at user_id="xxx">BotName</at>`）和纯文本格式（`@BotName`）。

Mention 检测支持词边界——`@mybot` 不会误触发 `@mybotplus`。

### 出站 @mention

当 AI 回复中包含 `@名字` 且匹配已知群成员时，Gateway 自动将其转换为平台原生 mention。这需要 Adapter 实现可选的 `getGroupMembers()` 方法。

目前支持：
- **飞书** — 通过 API 自动获取群成员，转换为原生 `at` 元素（post 模式）或 `<at>` 标签（card 模式）。需要 `im:chat:readonly` 权限。
- **Slack / Discord** — 文本中的 `<@USER_ID>` 由平台原生渲染为 mention。

未实现 `getGroupMembers()` 的 Adapter，`@名字` 将作为纯文本发送。

## 自定义 Adapter

通过编写一个简单的 Adapter 类并在 `golem.yaml` 中用 `_adapter` 引用，可以接入任意平台：内部工具、自建 bot、或尚未内置的 IM 平台。

### Adapter 接口

```typescript
interface ChannelAdapter {
  readonly name: string;
  readonly maxMessageLength?: number;  // 可选，覆盖默认的 4000 字符限制
  start(onMessage: (msg: ChannelMessage) => void | Promise<void>): Promise<void>;
  reply(msg: ChannelMessage, text: string, options?: ReplyOptions): Promise<void>;
  stop(): Promise<void>;
  typing?(msg: ChannelMessage): Promise<void>;           // 可选，发送"正在输入…"指示器
  getGroupMembers?(chatId: string): Promise<Map<string, string>>;  // 可选，用于 @mention
}
```

### 编写自定义 Adapter

```js
// adapters/my-platform.mjs
export default class MyPlatformAdapter {
  constructor(config) {
    this.name = config.channelName ?? 'my-platform';
    this.token = config.token;
  }

  async start(onMessage) {
    this._client = new MyPlatformClient(this.token);
    this._client.on('message', (raw) => {
      onMessage({
        channelType: 'my-platform',
        senderId: raw.userId,
        senderName: raw.userName,
        chatId: raw.roomId,
        chatType: raw.isGroup ? 'group' : 'dm',
        text: raw.content,
        raw,
      });
    });
  }

  async reply(originalMsg, text) {
    await this._client.send(originalMsg.chatId, text);
  }

  async stop() {
    await this._client.disconnect();
  }

  // 可选：在 AI 处理期间显示"正在输入…"指示器
  async typing(originalMsg) {
    await this._client.sendTyping(originalMsg.chatId).catch(() => {});
  }
}
```

### 在 golem.yaml 中注册

```yaml
channels:
  my-platform:                              # 任意 key
    _adapter: ./adapters/my-platform.mjs   # 相对路径或 npm 包名
    channelName: my-platform               # 构造函数 config 参数
    token: ${MY_PLATFORM_TOKEN}            # 其他字段也会传入 config
```

**路径解析规则：**
- 以 `./` 或 `/` 开头的路径相对于 `golem.yaml` 所在目录解析
- 其他值视为 npm 包名直接 import

Adapter 类必须作为模块的 **default export**。

### npm 包形式的 Adapter

也可以将 Adapter 发布为 npm 包，通过包名引用：

```yaml
channels:
  my-platform:
    _adapter: golembot-adapter-myplatform
    token: ${TOKEN}
```

## 启动 Gateway

```bash
golembot gateway --verbose
```

`--verbose` 参数开启每通道的详细日志，便于调试。

## SDK 依赖

通道 SDK 是**可选的 peer 依赖**。只安装你需要的：

```bash
# 飞书
pnpm add @larksuiteoapi/node-sdk

# 钉钉
pnpm add dingtalk-stream

# 企业微信
pnpm add @wecom/crypto xml2js

# Slack
pnpm add @slack/bolt

# Telegram
pnpm add grammy

# Discord
pnpm add discord.js
```

如果已配置的通道 SDK 未安装，Gateway 会打印错误信息和安装指引。
