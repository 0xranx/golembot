# Inbox & History Fetch

GolemBot can work like a real employee — when busy, messages queue up and get processed one by one; after being offline, it catches up on missed messages intelligently.

## Overview

```
IM message arrives
    ↓
adapter.onMessage()
    ↓
inbox.enqueue()  →  persisted to .golem/inbox.jsonl
    ↓
Consumer Loop (sequential)
    ├── Take next pending entry
    ├── handleMessage() → assistant.chat() → adapter.reply()
    └── Mark as done

On startup / periodic poll
    ↓
History Fetcher
    ├── adapter.listChats() → discover all conversations
    ├── adapter.fetchHistory(chatId, since) → pull missed messages
    ├── Group by chat, build triage prompt
    └── inbox.enqueue() → enters normal consumer flow
```

## Persistent Message Queue (Inbox)

When enabled, incoming IM messages are written to `.golem/inbox.jsonl` and consumed sequentially. No messages are lost, even if the process crashes mid-response.

### How it works

1. **Enqueue** — each incoming message is appended to the JSONL file as a `pending` entry
2. **Consume** — the consumer picks entries one by one, marks them `processing`, runs the agent, then marks `done`
3. **Crash recovery** — on restart, any `processing` entries are automatically reset to `pending`
4. **Dedup** — messages are keyed by `channelType + messageId` to prevent double-processing
5. **Compaction** — completed entries older than `retentionDays` are periodically cleaned up

### Configuration

```yaml
inbox:
  enabled: true          # default: false (backward compatible)
  retentionDays: 7       # days to keep completed entries
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `boolean` | `false` | Enable persistent message queue |
| `retentionDays` | `number` | `7` | Days to keep completed entries before compaction |

::: tip When inbox is disabled
With `inbox.enabled: false` (default), the gateway behaves exactly as before — messages are processed inline with concurrency limits. Enable inbox when you need crash safety and guaranteed delivery.
:::

## History Fetch

After a restart, the bot can automatically catch up on messages it missed while offline.

### How it works

1. **Discover** — calls `adapter.listChats()` to find all conversations the bot has joined
2. **Fetch** — calls `adapter.fetchHistory(chatId, since)` for each chat, pulling messages since the last known watermark
3. **Triage** — groups messages by chat and builds a single triage prompt per chat
4. **Enqueue** — the triage prompt is enqueued into the inbox for normal processing
5. **Watermark** — updates `.golem/watermarks.json` so the same messages aren't fetched again

### Smart triage

Multiple missed messages per chat are combined into a single prompt:

```
[System: You have been offline for a while. Below are the messages you missed
in chat feishu:oc_xxx. Review each and decide how to respond:
- Batch-reply to related messages together
- Skip or briefly acknowledge messages that have been resolved
- If none need a reply, respond with exactly: [SKIP]]

[2026-03-11T10:00:00Z] Alice: Can you review this PR?
[2026-03-11T10:05:00Z] Bob: What's the deploy status?
[2026-03-11T10:30:00Z] Alice: Never mind, I merged it myself.
```

The agent reviews the full context and decides how to respond — it might skip Alice's resolved PR request and only answer Bob's question. If nothing needs a reply, the agent outputs `[SKIP]` and the bot stays silent.

### Periodic polling

Beyond startup, the history fetcher runs on a timer to guard against WebSocket disconnects that might silently drop messages.

### Configuration

```yaml
historyFetch:
  enabled: true
  pollIntervalMinutes: 15      # periodic poll interval (default: 15)
  initialLookbackMinutes: 60   # first-run lookback window (default: 60)
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `boolean` | `false` | Enable history fetch |
| `pollIntervalMinutes` | `number` | `15` | How often to poll for missed messages |
| `initialLookbackMinutes` | `number` | `60` | On first run (no watermark), how far back to look |

::: info Requires inbox
`historyFetch` depends on `inbox` — fetched messages are enqueued into the inbox for sequential processing.
:::

## Platform Support

Not all channels support history fetch — it depends on whether the platform API provides message history and chat listing endpoints.

| Channel | `fetchHistory` | `listChats` | Notes |
|---------|:-:|:-:|-------|
| Feishu | ✅ | ✅ | Best support — `im.v1.message.list` + `im.v1.chat.list` |
| Slack | ✅ | ✅ | `conversations.history` + `conversations.list` |
| Discord | ✅ | ✅ | `channel.messages.fetch` + `guilds.cache` |
| Telegram | ❌ | ❌ | Bot API has no history endpoint |
| DingTalk | ❌ | ❌ | Not implemented |
| WeCom | ❌ | ❌ | Not implemented |
| Custom | Optional | Optional | Implement `fetchHistory()` and `listChats()` in your [adapter](/api/channel-adapter) |

Adapters without these methods are silently skipped.

## Deduplication

Three layers prevent double-processing:

1. **Adapter layer** — real-time `seenMsgIds` Set (existing mechanism)
2. **Inbox layer** — `channelType + messageId` check against all entries in the queue
3. **Watermark** — only fetches messages after the last known timestamp

## File Layout

```
.golem/
├── inbox.jsonl          ← persistent message queue
└── watermarks.json      ← per-chat fetch timestamps
```

Both files are inside `.golem/` and are gitignored.

## Full Example

```yaml
name: my-bot
engine: claude-code

inbox:
  enabled: true
  retentionDays: 7

historyFetch:
  enabled: true
  pollIntervalMinutes: 15
  initialLookbackMinutes: 60

channels:
  feishu:
    appId: ${FEISHU_APP_ID}
    appSecret: ${FEISHU_APP_SECRET}
  slack:
    botToken: ${SLACK_BOT_TOKEN}
    appToken: ${SLACK_APP_TOKEN}

gateway:
  port: 3000
```
