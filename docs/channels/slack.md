# Slack

GolemBot connects to Slack via **Socket Mode** — no public URL required. The bot responds to direct messages and group channel @mentions.

## Prerequisites

- A Slack workspace where you have permission to install apps
- Node.js ≥ 18

## Install the SDK

```bash
npm install @slack/bolt
```

## Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and click **Create New App → From scratch**.
2. Under **Socket Mode**, enable it and generate an **App-Level Token** (scope: `connections:write`). Copy the `xapp-...` token.
3. Under **OAuth & Permissions → Bot Token Scopes**, add:
   - `chat:write` — send messages
   - `im:history` — read DMs
   - `channels:history` — read channel messages (for @mentions)
4. Under **Event Subscriptions → Subscribe to bot events**, add:
   - `message.im` — DMs
   - `app_mention` — group @mentions
5. Install the app to your workspace and copy the **Bot Token** (`xoxb-...`).

## Configure golem.yaml

```yaml
name: my-assistant
engine: claude-code

channels:
  slack:
    botToken: ${SLACK_BOT_TOKEN}   # xoxb-...
    appToken: ${SLACK_APP_TOKEN}   # xapp-...
```

Set environment variables before running:

```bash
export SLACK_BOT_TOKEN=xoxb-...
export SLACK_APP_TOKEN=xapp-...
golem gateway
```

## How It Works

| Chat type | Behavior |
|-----------|----------|
| Direct message | Always responds |
| Channel @mention (`@YourBot message`) | Strips `<@BOT_ID>` prefix, then responds |
| Channel message without @mention | Ignored |

DM conversations maintain a per-user session. Channel messages share a per-channel session — all users in the same channel share one context.

> **Note:** Thread replies are delivered to the top-level channel, not inside the thread.

## Message Limits

Slack messages are split at **4,000 characters** per chunk if the response is longer.
