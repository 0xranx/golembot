# Channel Overview

GolemBot's gateway connects your assistant to IM platforms. Each platform is handled by a **channel adapter** that translates between the IM SDK and GolemBot's `assistant.chat()` API.

## Supported Channels

| Channel | Transport | Public IP Required | SDK |
|---------|-----------|-------------------|-----|
| [Feishu (Lark)](/channels/feishu) | WebSocket | No | `@larksuiteoapi/node-sdk` |
| [DingTalk](/channels/dingtalk) | Stream (WebSocket) | No | `dingtalk-stream` |
| [WeCom](/channels/wecom) | Webhook HTTP | **Yes** | `@wecom/crypto` + `xml2js` |
| [Slack](/channels/slack) | Socket Mode (WebSocket) | No | `@slack/bolt` |
| [Telegram](/channels/telegram) | Long-polling | No | `grammy` |
| [Discord](/channels/discord) | Gateway WebSocket | No | `discord.js` |
| Custom | Any | Depends | Your own adapter class |

## Architecture

```
IM Platform → Channel Adapter → assistant.chat() → text response → adapter.reply()
```

The gateway:

1. Reads `channels` config from `golem.yaml`
2. Dynamically imports the SDK for each configured channel
3. Starts all adapters in parallel alongside the HTTP service
4. Routes incoming messages through session key resolution → context building → `assistant.chat()`
5. Accumulates the full text response, splits it within platform limits, and sends chunk by chunk

## Message Limits

Each platform has a maximum message length. GolemBot automatically splits long responses:

| Channel | Max length | Split behavior |
|---------|-----------|---------------|
| Feishu | 4,000 chars | Multi-message |
| DingTalk | 4,000 chars | Multi-message |
| WeCom | 2,048 chars | Multi-message |
| Slack | 4,000 chars | Multi-message |
| Telegram | 4,096 chars | Multi-message |
| Discord | 2,000 chars | Multi-message |
| Custom | Configurable via `maxMessageLength` | Multi-message |

## Session Routing

**DM messages** use a per-user key: `${channelType}:${chatId}:${senderId}` — each user gets their own independent conversation. The gateway injects a context line so the bot knows it's in a private conversation and who it's talking to.

**Group messages** use a shared key: `${channelType}:${chatId}` — all users in the same group share a single session, so the agent has full group context including recent message history.

## Group Chat Behaviour

Configure how the bot responds in group chats via `groupChat` in `golem.yaml`:

```yaml
groupChat:
  groupPolicy: mention-only   # mention-only (default) | smart | always
  historyLimit: 20            # recent messages injected as context
  maxTurns: 10                # max consecutive bot replies (safety valve)
```

| Policy | Agent called | When bot replies |
|--------|-------------|-----------------|
| `mention-only` | Only on @mention | Only when @mentioned (zero cost otherwise) |
| `smart` | Every message | Agent decides — outputs `[PASS]` to stay silent |
| `always` | Every message | Every message unconditionally |

See the [Configuration guide](/guide/configuration#groupchat) for full details.

## Mention Handling

### Incoming @mentions

GolemBot strips `@` mentions from incoming messages before passing them to the agent. This handles patterns like `<at user_id="xxx">BotName</at>` (Feishu XML) and `@BotName` (plain text).

Mention detection (used for `mention-only` and `smart` policies) checks both formats and is word-boundary-aware — `@mybot` will not trigger on `@mybotplus`.

### Outgoing @mentions

When the AI reply contains `@name` patterns matching known group members, the gateway resolves them into native platform mentions. This requires the adapter to implement the optional `getGroupMembers()` method.

Currently supported:
- **Feishu** — auto-discovers group members via API, converts to native `at` elements (post mode) or `<at>` tags (card mode). Requires `im:chat:readonly` permission.
- **Slack / Discord** — `<@USER_ID>` in text is rendered as native mentions by the platform.

For adapters without `getGroupMembers()`, `@name` is sent as plain text.

## Custom Adapters

You can connect any platform — including internal tools, custom bots, or platforms not yet built-in — by writing a simple adapter class and referencing it with `_adapter` in `golem.yaml`.

### Adapter interface

```typescript
interface ChannelAdapter {
  readonly name: string;
  readonly maxMessageLength?: number;  // optional, overrides default 4000
  start(onMessage: (msg: ChannelMessage) => void | Promise<void>): Promise<void>;
  reply(msg: ChannelMessage, text: string, options?: ReplyOptions): Promise<void>;
  stop(): Promise<void>;
  typing?(msg: ChannelMessage): Promise<void>;           // optional, send "typing…" indicator
  getGroupMembers?(chatId: string): Promise<Map<string, string>>;  // optional, for @mention support
}
```

### Writing a custom adapter

```js
// adapters/my-platform.mjs
export default class MyPlatformAdapter {
  constructor(config) {
    this.name = config.channelName ?? 'my-platform';
    this.token = config.token;
  }

  async start(onMessage) {
    // connect to your platform, call onMessage for each incoming message
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

  // Optional: show "typing…" indicator while AI is processing
  async typing(originalMsg) {
    await this._client.sendTyping(originalMsg.chatId).catch(() => {});
  }
}
```

### Registering in golem.yaml

```yaml
channels:
  my-platform:                          # any key name
    _adapter: ./adapters/my-platform.mjs  # relative path or npm package name
    channelName: my-platform              # passed as config to the constructor
    token: ${MY_PLATFORM_TOKEN}          # any other fields go to config too
```

**Path resolution:**
- Paths starting with `./` or `/` are resolved relative to the `golem.yaml` directory
- Other values are treated as npm package names and imported as-is

The adapter class must be the **default export** of the module.

### npm packages as adapters

You can also publish an adapter as an npm package and reference it by package name:

```yaml
channels:
  my-platform:
    _adapter: golembot-adapter-myplatform
    token: ${TOKEN}
```

## Starting the Gateway

```bash
golembot gateway --verbose
```

The `--verbose` flag enables per-channel log lines, useful for debugging.

## SDK Dependencies

Channel SDKs are **optional peer dependencies**. Install only what you need:

```bash
# Feishu
pnpm add @larksuiteoapi/node-sdk

# DingTalk
pnpm add dingtalk-stream

# WeCom
pnpm add @wecom/crypto xml2js

# Slack
pnpm add @slack/bolt

# Telegram
pnpm add grammy

# Discord
pnpm add discord.js
```

If a configured channel's SDK is not installed, the gateway will print an error with installation instructions.
