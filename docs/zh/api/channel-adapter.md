# Channel Adapter

`ChannelAdapter` 接口定义 GolemBot 如何连接 IM 平台。

## ChannelAdapter 接口

```typescript
interface MentionTarget {
  name: string;        // 显示名称（如 "小舟"）
  platformId: string;  // 平台用户 ID
}

interface ReplyOptions {
  mentions?: MentionTarget[];  // 已解析的 @mention 目标，用于原生渲染
}

interface ChannelAdapter {
  readonly name: string;
  /** 可选：覆盖该 channel 的默认消息分割长度限制（默认 4000 字符）。 */
  readonly maxMessageLength?: number;
  start(onMessage: (msg: ChannelMessage) => void | Promise<void>): Promise<void>;
  reply(msg: ChannelMessage, text: string, options?: ReplyOptions): Promise<void>;
  stop(): Promise<void>;
  /** 可选：向聊天发送"正在输入…"指示器。在 AI 调用前触发，每 4 秒刷新一次，
   *  AI 回复完毕后自动停止。 */
  typing?(msg: ChannelMessage): Promise<void>;
  /** 可选：获取群成员列表用于 @mention 支持。
   *  返回 displayName → platformId 的 Map。
   *  当 AI 回复包含 @name 时由 Gateway 调用。 */
  getGroupMembers?(chatId: string): Promise<Map<string, string>>;
  /** 可选：用户阅读 bot 消息时的回调。目前飞书适配器支持。 */
  readReceiptHandler?: (receipt: ReadReceipt) => void;
  /** 可选：主动发送消息到指定会话（无需入站消息上下文）。
   *  被定时任务系统用于将结果推送到 IM 通道。 */
  send?(chatId: string, text: string): Promise<void>;
  /** 该 Adapter 是否支持主动 send()。未定义时默认为 send() 存在则为 true。 */
  readonly canSend?: boolean;
  /** 可选：拉取 since 之后的历史消息，用于重启后的离线消息追回。 */
  fetchHistory?(chatId: string, since: Date, limit?: number): Promise<ChannelMessage[]>;
  /** 可选：列出 Bot 加入的所有会话，用于历史抓取时发现需要轮询的会话。 */
  listChats?(): Promise<Array<{ chatId: string; chatType: 'dm' | 'group' }>>;
}
```

## ReadReceipt 类型

```typescript
interface ReadReceipt {
  channelType: string;   // 'feishu'
  messageId: string;     // 被阅读的消息 ID
  readerId: string;      // 阅读者用户 ID
  chatId: string;        // 会话 ID
  readTime: string;      // 时间戳（毫秒级 epoch）
}
```

## ImageAttachment 类型

```typescript
interface ImageAttachment {
  mimeType: string;    // 如 'image/png'、'image/jpeg'、'image/webp'
  data: Buffer;        // 原始图片字节数据
  fileName?: string;   // 原始文件名（如果有）
}
```

用于 `ChannelMessage.images` 和 `assistant.chat()` 的 opts 参数。全部 6 个内置 Adapter 在用户发送图片消息时都会填充此字段。

## ChannelMessage 类型

```typescript
interface ChannelMessage {
  channelType: string;     // 'feishu' | 'dingtalk' | 'wecom' | 'slack' | 'telegram' | 'discord' | …
  senderId: string;        // 平台上的用户 ID
  senderName?: string;     // 显示名称
  chatId: string;          // 会话/群组 ID
  chatType: 'dm' | 'group';
  text: string;            // 消息文本
  messageId?: string;      // 平台原生消息 ID（用于引用回复）
  images?: ImageAttachment[];  // 图片附件（如果有）
  raw: unknown;            // 原始 SDK 事件对象
  /**
   * 由能通过平台原生方式检测到 @mention 的 Adapter 设置（如 Discord 的 <@userId> token）。
   * 设置后，Gateway 将该消息视为 @mention，无需依赖文本模式匹配。
   */
  mentioned?: boolean;
}
```

## 辅助函数

### `buildSessionKey(msg)`

从通道消息生成会话 Key：`${channelType}:${chatId}:${senderId}`

### `stripMention(text)`

移除消息中的 `@` 提及，处理 `<at ...>...</at>` XML 格式和 `@BotName` 纯文本格式。

## 通过 golem.yaml 配置自定义 Adapter

不需要修改框架代码，任何消息源（邮件、GitHub Issue、Cron 触发等）都可以接入 GolemBot。在 `golem.yaml` 里声明自定义 channel，并用 `_adapter` 字段指向你的适配器文件或 npm 包：

```yaml
name: my-assistant
engine: claude-code

channels:
  # 内置 channel（无需 _adapter）
  slack:
    botToken: ${SLACK_BOT_TOKEN}
    appToken: ${SLACK_APP_TOKEN}

  # 自定义 channel — 本地文件（相对 assistant 目录解析）
  my-email:
    _adapter: ./adapters/email-adapter.js
    host: imap.gmail.com
    token: ${EMAIL_TOKEN}

  # 自定义 channel — npm 包
  my-teams:
    _adapter: golembot-teams-adapter
    tenantId: ${TEAMS_TENANT_ID}
    clientSecret: ${TEAMS_CLIENT_SECRET}
```

**路径解析规则：**
- 以 `.` 或 `/` 开头 → 相对 assistant 目录解析
- 其他情况 → 视为 npm 包名，由 Node.js 负责解析

### 编写 Adapter

Adapter 文件需要 `export default` 一个实现 `ChannelAdapter` 接口的类。`golem.yaml` 中的所有配置字段都会作为构造函数参数传入：

```typescript
import type { ChannelAdapter, ChannelMessage } from 'golembot';

export default class EmailAdapter implements ChannelAdapter {
  readonly name: string;
  readonly maxMessageLength = 10000; // 可选，覆盖默认的 4000 字符限制

  constructor(private config: Record<string, unknown>) {
    this.name = (config.channelName as string) ?? 'email';
  }

  async start(onMessage: (msg: ChannelMessage) => void | Promise<void>): Promise<void> {
    // 开始监听（IMAP、Webhook、轮询等）
    // 收到消息时调用 onMessage：
    onMessage({
      channelType: 'email',
      senderId: email.from,
      senderName: email.fromName,
      chatId: email.threadId,
      chatType: 'dm',
      text: email.body,
      raw: email,
    });
  }

  async reply(msg: ChannelMessage, text: string): Promise<void> {
    // 发送回复（SMTP、API 调用等）
  }

  async stop(): Promise<void> {
    // 清理连接资源
  }

  // 可选：在 AI 处理期间发送"正在输入…"指示器
  async typing(msg: ChannelMessage): Promise<void> {
    await this.client.sendTyping(msg.chatId).catch(() => {});
  }
}
```

Adapter 加载后，GolemBot 自动处理消息路由、Session 管理和长消息分割，无需额外配置。

## 在代码中手动集成 Adapter

如果你是在自己的应用里嵌入 GolemBot，也可以不通过 `golem.yaml`，直接实现接口并配合 `createAssistant()` 使用：

```typescript
import type { ChannelAdapter, ChannelMessage } from 'golembot';
import { createAssistant, buildSessionKey, stripMention } from 'golembot';

class MyAdapter implements ChannelAdapter {
  readonly name = 'my-channel';

  async start(onMessage: (msg: ChannelMessage) => void | Promise<void>) {
    // 连接并监听，收到消息时调用 onMessage
  }

  async reply(msg: ChannelMessage, text: string) {
    // 发送回复
  }

  async stop() { /* 断开连接 */ }
}

const assistant = createAssistant({ dir: './my-bot' });
const adapter = new MyAdapter();

await adapter.start(async (msg) => {
  let reply = '';
  for await (const ev of assistant.chat(stripMention(msg.text), {
    sessionKey: buildSessionKey(msg),
  })) {
    if (ev.type === 'text') reply += ev.content;
  }
  await adapter.reply(msg, reply);
});
```

## 内置 Adapter

| Adapter | Channel 类型 | SDK |
|---------|-------------|-----|
| `FeishuAdapter` | `feishu` | `@larksuiteoapi/node-sdk` |
| `DingtalkAdapter` | `dingtalk` | `dingtalk-stream` |
| `WecomAdapter` | `wecom` | `@wecom/crypto` + `xml2js` |
| `SlackAdapter` | `slack` | `@slack/bolt` |
| `TelegramAdapter` | `telegram` | `grammy` |
| `DiscordAdapter` | `discord` | `discord.js` |

内置 Adapter 由 gateway 服务内部使用。在 `golem.yaml` 里配置对应的 channel 类型即可，无需写 `_adapter` 字段。

### 历史抓取支持

| Adapter | `fetchHistory` | `listChats` | 说明 |
|---------|:-:|:-:|------|
| Feishu | ✅ | ✅ | `im.v1.message.list` + `im.v1.chat.list` |
| Slack | ✅ | ✅ | `conversations.history` + `conversations.list` |
| Discord | ✅ | ✅ | `channel.messages.fetch` + `guilds.cache` |
| Telegram | ❌ | ❌ | Bot API 无历史消息接口 |
| DingTalk | ❌ | ❌ | 暂未实现 |
| WeCom | ❌ | ❌ | 暂未实现 |

未实现这些方法的 Adapter 会被历史抓取器静默跳过。
