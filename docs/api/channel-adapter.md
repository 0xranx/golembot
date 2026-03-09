# Channel Adapter

The `ChannelAdapter` interface defines how GolemBot connects to IM platforms.

## ChannelAdapter Interface

```typescript
interface MentionTarget {
  name: string;        // Display name (e.g. "Alice")
  platformId: string;  // Platform-specific user ID
}

interface ReplyOptions {
  mentions?: MentionTarget[];  // Resolved @mentions to render natively
}

interface ChannelAdapter {
  readonly name: string;
  /** Optional: override the default 4000-char message split limit for this channel. */
  readonly maxMessageLength?: number;
  start(onMessage: (msg: ChannelMessage) => void | Promise<void>): Promise<void>;
  reply(msg: ChannelMessage, text: string, options?: ReplyOptions): Promise<void>;
  stop(): Promise<void>;
  /** Optional: send a platform "typing…" indicator. Called before the AI invocation
   *  and refreshed every 4 seconds so users see feedback during long waits. */
  typing?(msg: ChannelMessage): Promise<void>;
  /** Optional: resolve group members for @mention support.
   *  Returns a map of display name → platform-specific user ID.
   *  Called by the gateway when the AI reply contains @mentions. */
  getGroupMembers?(chatId: string): Promise<Map<string, string>>;
  /** Optional: handler called when a user reads a message sent by the bot.
   *  Currently supported by the Feishu adapter. */
  readReceiptHandler?: (receipt: ReadReceipt) => void;
  /** Optional: proactively send a message to a chat (no incoming message context needed).
   *  Used by the scheduled task system to push results to IM channels. */
  send?(chatId: string, text: string): Promise<void>;
  /** Whether this adapter supports proactive send(). Defaults to true if send() is defined. */
  readonly canSend?: boolean;
}
```

| Property / Method | Description |
|-------------------|-------------|
| `name` | Adapter name (e.g., `'feishu'`, `'dingtalk'`, `'my-email'`) |
| `maxMessageLength` | *(optional)* Override the default 4000-char split limit for long replies |
| `start(onMessage)` | Connect to the platform and begin listening. Call `onMessage` for each incoming message. |
| `reply(msg, text, options?)` | Send a text reply. `options.mentions` contains resolved @mention targets for native rendering. |
| `stop()` | Gracefully disconnect |
| `typing(msg)` | *(optional)* Send a "typing…" indicator to the chat. Called before the AI call and refreshed every 4 s. Implement for better UX on platforms that support it (e.g. Telegram `sendChatAction`, Discord `sendTyping`). |
| `getGroupMembers(chatId)` | *(optional)* Return a `Map<displayName, platformId>` of group members. The gateway calls this when an AI reply contains `@name` patterns to resolve them into native mentions. Implementations should cache results for performance. |
| `send(chatId, text)` | *(optional)* Proactively send a message to a chat without an incoming message context. Used by the scheduled task system (`/cron`) to push task results to IM channels. |
| `canSend` | *(optional, read-only)* Whether the adapter supports proactive `send()`. Defaults to `true` if `send()` is defined. |

## ReadReceipt Type

```typescript
interface ReadReceipt {
  channelType: string;   // 'feishu'
  messageId: string;     // Message ID that was read
  readerId: string;      // User ID of the reader
  chatId: string;        // Chat/conversation ID
  readTime: string;      // Timestamp (milliseconds since epoch)
}
```

## ImageAttachment Type

```typescript
interface ImageAttachment {
  mimeType: string;    // e.g. 'image/png', 'image/jpeg', 'image/webp'
  data: Buffer;        // Raw image bytes
  fileName?: string;   // Original filename (if available)
}
```

Used in `ChannelMessage.images` and `assistant.chat()` opts. All 6 built-in adapters populate this when users send image messages.

## ChannelMessage Type

```typescript
interface ChannelMessage {
  channelType: string;     // 'feishu' | 'dingtalk' | 'wecom' | 'slack' | 'telegram' | 'discord' | …
  senderId: string;        // User ID on the platform
  senderName?: string;     // Display name (if available)
  chatId: string;          // Chat/conversation ID
  chatType: 'dm' | 'group';
  text: string;            // Message text content
  images?: ImageAttachment[];  // Image attachments (if any)
  raw: unknown;            // Raw SDK event object
  /**
   * Set to `true` by adapters that can detect a bot @mention through
   * platform-native means (e.g. Discord's `<@userId>` token). When set,
   * the gateway treats the message as an @mention regardless of text matching.
   */
  mentioned?: boolean;
}
```

## Helper Functions

### `buildSessionKey(msg)`

Generate a session key from a channel message:

```typescript
function buildSessionKey(msg: ChannelMessage): string;
// Returns: `${channelType}:${chatId}:${senderId}`
```

Example: `"feishu:oc_xxx:ou_yyy"`

### `stripMention(text)`

Remove `@` mentions from message text:

```typescript
function stripMention(text: string): string;
```

Handles:
- XML-style: `<at user_id="xxx">BotName</at>`
- Plain text: `@BotName`

## Custom Adapters via golem.yaml

You can plug any message source into GolemBot — email, GitHub Issues, cron triggers, or anything else — without touching the framework code. Declare a custom channel in `golem.yaml` with an `_adapter` field pointing to your adapter file or npm package:

```yaml
name: my-assistant
engine: claude-code

channels:
  # Built-in channel (unchanged)
  slack:
    botToken: ${SLACK_BOT_TOKEN}
    appToken: ${SLACK_APP_TOKEN}

  # Custom channel — local file (relative to the assistant directory)
  my-email:
    _adapter: ./adapters/email-adapter.js
    host: imap.gmail.com
    token: ${EMAIL_TOKEN}

  # Custom channel — npm package
  my-teams:
    _adapter: golembot-teams-adapter
    tenantId: ${TEAMS_TENANT_ID}
    clientSecret: ${TEAMS_CLIENT_SECRET}
```

**Path resolution rules:**
- Starts with `.` or `/` → resolved relative to the assistant directory
- Anything else → treated as an npm package name (resolved by Node.js module resolution)

### Writing an Adapter

Your adapter file must export a default class that implements the `ChannelAdapter` interface. All config fields from `golem.yaml` are passed to the constructor:

```typescript
import type { ChannelAdapter, ChannelMessage } from 'golembot';

export default class EmailAdapter implements ChannelAdapter {
  readonly name: string;
  readonly maxMessageLength = 10000; // optional — overrides the default 4000

  constructor(private config: Record<string, unknown>) {
    this.name = (config.channelName as string) ?? 'email';
  }

  async start(onMessage: (msg: ChannelMessage) => void | Promise<void>): Promise<void> {
    // Start listening (IMAP, webhook, polling, etc.)
    // Call onMessage() for each incoming message:
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
    // Send the reply (SMTP, API call, etc.)
  }

  async stop(): Promise<void> {
    // Clean up connections
  }

  // Optional: send typing indicator while the AI is thinking
  async typing(msg: ChannelMessage): Promise<void> {
    await this.client.sendTyping(msg.chatId).catch(() => {});
  }
}
```

GolemBot handles all message routing, session management, and reply splitting automatically once your adapter is loaded.

## Implementing a Custom Adapter Programmatically

If you're embedding GolemBot in your own application and want to wire up a channel manually (without `golem.yaml`), implement the interface and integrate with `createAssistant()` directly:

```typescript
import type { ChannelAdapter, ChannelMessage } from 'golembot';

class MyAdapter implements ChannelAdapter {
  readonly name = 'my-channel';

  async start(onMessage: (msg: ChannelMessage) => void | Promise<void>) {
    // Connect and call onMessage for each incoming message
  }

  async reply(msg: ChannelMessage, text: string) {
    // Send reply
  }

  async stop() {
    // Disconnect
  }
}
```

```typescript
import { createAssistant, buildSessionKey, stripMention } from 'golembot';

const assistant = createAssistant({ dir: './my-bot' });
const adapter = new MyAdapter();

await adapter.start(async (msg) => {
  const sessionKey = buildSessionKey(msg);
  const text = stripMention(msg.text);

  let reply = '';
  for await (const event of assistant.chat(text, { sessionKey })) {
    if (event.type === 'text') reply += event.content;
  }
  await adapter.reply(msg, reply);
});
```

## Built-in Adapters

| Adapter | Channel type | SDK |
|---------|--------------|-----|
| `FeishuAdapter` | `feishu` | `@larksuiteoapi/node-sdk` |
| `DingtalkAdapter` | `dingtalk` | `dingtalk-stream` |
| `WecomAdapter` | `wecom` | `@wecom/crypto` + `xml2js` |
| `SlackAdapter` | `slack` | `@slack/bolt` |
| `TelegramAdapter` | `telegram` | `grammy` |
| `DiscordAdapter` | `discord` | `discord.js` |

These are used internally by the gateway service. To use them, configure the corresponding channel type in `golem.yaml` — no `_adapter` field needed.
