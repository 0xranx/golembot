# Group Chat

GolemBot can participate in group chats across all IM channels. Configure how the bot responds, handles @mentions, and maintains group memory.

## Response Policies

Control when the bot speaks in group chats via `groupChat.groupPolicy` in `golem.yaml`:

```yaml
groupChat:
  groupPolicy: smart     # mention-only (default) | smart | always
  historyLimit: 30       # recent messages injected as context (default: 20)
  maxTurns: 5            # max consecutive bot replies (default: 10)
```

| Policy | Agent called | When bot replies | Use case |
|--------|-------------|-----------------|---------|
| `mention-only` | Only on @mention | Only when @mentioned | Low noise, lowest cost |
| `smart` | Every message | Agent decides (outputs `[PASS]` to stay silent) | Bot observes all and builds memory continuously |
| `always` | Every message | Every message | High-interaction small groups |

### Smart mode

In `smart` mode the agent runs on **every** group message — even when it stays silent by outputting `[PASS]`. This means:

- The agent reads and understands all messages in real time
- Group memory is updated continuously (see [Group Memory](#group-memory) below)
- The agent has full conversation context when it does decide to reply
- When the bot is @mentioned in smart mode, the message is always processed (never skipped)

In `mention-only` mode, the agent only runs when @mentioned. Memory and context are only updated at those moments.

### Configuration reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `groupPolicy` | `string` | `mention-only` | Response policy |
| `historyLimit` | `number` | `20` | Recent messages injected as context |
| `maxTurns` | `number` | `10` | Max consecutive bot replies per group (safety valve) |

## Mention Handling

### Incoming @mentions

GolemBot strips `@` mentions from incoming messages before passing them to the agent. This handles:

- XML-style: `<at user_id="xxx">BotName</at>` (Feishu)
- Plain text: `@BotName`

Mention detection is word-boundary-aware — `@mybot` will not trigger on `@mybotplus`.

### Outgoing @mentions

When the AI reply contains `@name` patterns matching known group members, the gateway resolves them into native platform mentions. This requires the adapter to implement the optional `getGroupMembers()` method.

| Channel | Outgoing @mention | How it works |
|---------|:-:|------|
| **Feishu** | ✅ | Auto-discovers group members via API, converts to native `<at>` tags in card v2 messages. Requires `im:chat:readonly` permission. |
| **Slack** | ✅ | Fetches channel members via `conversations.members`, converts `@Name` to native `<@USER_ID>` mentions. |
| **Discord** | ✅ | Fetches guild members, converts `@Name` to native `<@USER_ID>` mentions. Requires the **Server Members Intent** (privileged) enabled in Discord Developer Portal. |
| DingTalk | ❌ | `@name` sent as plain text |
| WeCom | ❌ | `@name` sent as plain text |
| Telegram | ❌ | `@name` sent as plain text |

## Quote Reply

The bot replies as a **quote reply** (referencing the original message) instead of posting a standalone message. This makes conversation threads clearer in busy group chats.

| Channel | Quote Reply | Mechanism |
|---------|:-:|-----------|
| **Feishu** | ✅ | `im.v1.message.reply` (native quote) |
| **Telegram** | ✅ | `reply_to_message_id` parameter |
| **Slack** | ✅ | Thread reply via `thread_ts` |
| **Discord** | ✅ | Native `message.reply()` |
| **DingTalk** | ❌ | Webhook mode doesn't support quote reply |
| **WeCom** | ❌ | API doesn't support quote reply |

No configuration needed — quote reply is enabled automatically for supported channels.

## Group Memory

The agent maintains per-group memory files at:

```
memory/groups/<group-key>.md
```

The group key is derived from the channel type and chat ID (e.g., `slack-C123`, `telegram--100456`). GolemBot creates the `memory/groups/` directory automatically.

### File structure

```markdown
# Group: slack-C123

## Members
- Alice: frontend lead
- Bob: backend engineer

## Project Context
- Building a dashboard for monitoring API latency
- Using React + Go stack

## Decisions
- [2026-03-01] Chose Prometheus over Datadog for cost reasons
- [2026-03-03] Sprint deadline moved to March 15
```

### How policies affect memory

| Policy | Agent runs on | Memory updates |
|--------|--------------|----------------|
| `smart` | Every message (even when staying silent) | Continuous — agent observes all messages and updates memory in real time |
| `mention-only` | Only when @mentioned | Intermittent — memory only updates when the bot is invoked |
| `always` | Every message | Continuous |

## Session Routing

**DM messages** use a per-user key: `${channelType}:${chatId}:${senderId}` — each user gets their own independent conversation.

**Group messages** use a shared key: `${channelType}:${chatId}` — all users in the same group share a single session, so the agent has full group context.
