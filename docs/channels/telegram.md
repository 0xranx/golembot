# Telegram

GolemBot connects to Telegram via **Long-Polling** — no public URL required. The bot responds to private messages and group @mentions.

## Prerequisites

- A Telegram account
- Node.js ≥ 18

## Install the SDK

```bash
npm install grammy
```

## Create a Bot

1. Open Telegram and message [@BotFather](https://t.me/BotFather).
2. Send `/newbot` and follow the prompts. You'll receive a **Bot Token** in the format `123456:ABCdef...`.
3. **Required for group @mention support**: send `/setprivacy` to @BotFather → select your bot → **Disable**. This allows the bot to receive group messages.

::: warning Privacy mode affects existing groups
After disabling privacy mode, the change only applies to groups the bot joins **after** the change. For groups the bot is already in, you must **remove the bot and re-invite it** for the new setting to take effect.
:::

## Configure golem.yaml

```yaml
name: my-assistant
engine: claude-code

channels:
  telegram:
    botToken: ${TELEGRAM_BOT_TOKEN}   # 123456:ABCdef...
```

Set environment variables before running:

```bash
export TELEGRAM_BOT_TOKEN=123456:ABCdef...
golem gateway
```

## How It Works

| Chat type | Behavior |
|-----------|----------|
| Private chat | Always responds |
| Group @mention (`@YourBot message`) | Strips `@botname`, then responds |
| Group message without @mention | Ignored |

Each conversation (private chat or group) maintains its own session context.

## Message Format

The adapter automatically converts standard Markdown to **Telegram HTML** format:

| Markdown | Telegram HTML |
|----------|--------------|
| `**bold**` | `<b>bold</b>` |
| `*italic*` | `<i>italic</i>` |
| `~~strike~~` | `<s>strike</s>` |
| `` `code` `` | `<code>code</code>` |
| ` ```lang ` | `<pre><code class="language-lang">` |
| `[text](url)` | `<a href="url">text</a>` |
| `# Heading` | `<b>Heading</b>` |
| `> quote` | `<blockquote>quote</blockquote>` |
| `- item` | `• item` |

Messages are sent with `parse_mode: 'HTML'`. Special characters are automatically escaped inside and outside code blocks.

## Message Limits

Telegram messages are split at **4,096 characters** per chunk if the response is longer.
