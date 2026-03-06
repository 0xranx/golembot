# Discord

GolemBot connects to Discord via the **Gateway WebSocket** — no public URL required. The bot responds to DMs and server channel messages.

## Prerequisites

- A Discord account
- Node.js ≥ 18
- A Discord application with a Bot user

## Install the SDK

```bash
npm install discord.js
```

## Create a Bot

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and click **New Application**.
2. Under **Bot**, click **Add Bot**. Copy the **Bot Token** — you'll need it for `golem.yaml`.
3. Under **Privileged Gateway Intents**, enable **Message Content Intent** (required for the bot to read message text).
4. Under **OAuth2 → URL Generator**, select the `bot` scope and the following permissions:
   - **Read Messages/View Channels**
   - **Send Messages**
   - **Read Message History**
5. Copy the generated URL, paste it in your browser, and invite the bot to your server.

## Configure golem.yaml

```yaml
name: my-assistant
engine: claude-code

channels:
  discord:
    botToken: ${DISCORD_BOT_TOKEN}
    botName: my-assistant  # optional — see below
```

Set environment variables before running:

```bash
export DISCORD_BOT_TOKEN=your-token-here
golembot gateway
```

### `botName` field

`botName` is **optional**. Discord uses internal user IDs (`<@12345678>`) in message content rather than names. The adapter detects @mentions natively via these tokens — mention detection works correctly even without `botName`.

When `botName` is set, the adapter additionally replaces the `<@userId>` token with `@botName` before passing text to the engine, so the engine sees a human-readable mention. Set it to the same value as `name` in `golem.yaml`.

## How It Works

| Chat type | Behavior |
|-----------|----------|
| DM | Always responds |
| Server channel @mention (`@YourBot message`) | Detects mention, responds |
| Server channel message without @mention | Depends on `groupPolicy` (default: ignored) |

Each DM conversation and each server channel maintains its own session context.

::: tip Message Format
Discord natively supports Markdown — no conversion needed. GolemBot sends the AI response as-is and Discord renders bold, italic, code blocks, links, and other Markdown formatting automatically.
:::

## Message Limits

Discord messages are split at **2,000 characters** per chunk if the response is longer.

## Group Chat

Discord server channels are treated as **group** chats. Configure the response policy via `groupChat` in `golem.yaml`:

```yaml
groupChat:
  groupPolicy: mention-only  # mention-only (default) | smart | always
  historyLimit: 20
  maxTurns: 10
```

See the [Channel Overview](/channels/overview#group-chat-behaviour) for full details.
