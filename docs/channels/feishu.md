# Feishu (Lark)

Connect your GolemBot assistant to Feishu (Lark) using WebSocket long-connection mode. No public IP required.

## Prerequisites

```bash
pnpm add @larksuiteoapi/node-sdk
```

## Feishu Open Platform Setup

1. Go to [Feishu Open Platform](https://open.feishu.cn/) and create a new app
2. Under **Credentials**, copy the **App ID** and **App Secret**
3. Under **Event Subscriptions**:
   - Enable the **WebSocket** connection mode
   - Subscribe to `im.message.receive_v1`
4. Under **Permissions**, add the scopes listed in the [permissions table](#permissions) below
5. Under **Data Permissions** → **Contact Scope**, set to "All members" (or at minimum include your team)
6. Publish the app version and have an admin approve it

### Permissions

| Permission Scope | Required | Purpose | Without it |
|-----------------|----------|---------|------------|
| `im:message` | **Yes** | Send messages to users and groups | Bot cannot reply |
| `im:message:readonly` | **Yes** | Receive messages via WebSocket events | Bot receives no messages |
| `im:message.group_at_msg:readonly` | **Yes** | Receive group messages where the bot is @mentioned | Bot is invisible in group chats |
| `contact:user.base:readonly` | **Yes** | Read basic user info (display name) from contact API | Bot cannot resolve sender names |
| `contact:contact.base:readonly` | **Yes** | Read contact base info (needed alongside the above) | Bot cannot resolve sender names |
| `im:chat:readonly` | Optional | List group members for outgoing @mention support | `@name` in replies is sent as plain text instead of native Feishu mention |

::: tip
Without the two `contact:` permissions, the bot still works but will see users as `ou_xxxxx` IDs instead of display names — it won't know who it's talking to.
:::

## Configuration

```yaml
# golem.yaml
channels:
  feishu:
    appId: ${FEISHU_APP_ID}
    appSecret: ${FEISHU_APP_SECRET}
```

```sh
# .env
FEISHU_APP_ID=cli_xxxxxxxxxx
FEISHU_APP_SECRET=xxxxxxxxxxxxxxxxxx
```

### Message Format

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `appId` | `string` | — | Feishu App ID (required) |
| `appSecret` | `string` | — | Feishu App Secret (required) |

The adapter automatically detects whether the AI reply contains Markdown formatting:

- **Plain text** — sent as `msg_type: "text"` (no conversion)
- **Markdown** — sent as interactive card (`msg_type: "interactive"`) using Feishu card v2 with native Markdown rendering. Supports headings, lists, bold/italic, code blocks with syntax highlighting, blockquotes, tables, and links

Standard Markdown syntax is automatically converted — no configuration needed.

## How It Works

- **Transport**: WebSocket long-connection via `WSClient` from `@larksuiteoapi/node-sdk`
- **Events**: Listens for `im.message.receive_v1` events (text messages only)
- **Reply**: Sends messages via `client.im.v1.message.create()` — format is auto-selected based on content
- **Chat types**: Supports both DMs and group chats
- **DM context**: In private chats, the gateway injects the sender's display name so the bot knows who it's talking to
- **Group @mention filter**: In group chats the bot only responds when directly @mentioned. The @mention key is automatically stripped from the message text before it is passed to the engine
- **Group @mention in replies**: When the AI reply contains `@name` matching a known group member, the adapter converts it to a native Feishu @mention (blue clickable tag). Group members are auto-discovered via API and cached for 10 minutes. Requires `im:chat:readonly` permission

## Start

```bash
golembot gateway --verbose
```

The adapter connects to Feishu via WebSocket on startup. Messages appear in logs with `[feishu]` prefix when `--verbose` is enabled.

## Read Receipts

The Feishu adapter supports tracking when users read messages sent by the bot. When a user opens a chat containing unread bot messages, the adapter receives an `im.message.message_read_v1` event with the reader's ID, message IDs, and read timestamp.

To enable read receipts:

1. In **Event Subscriptions**, subscribe to `im.message.message_read_v1`
2. The adapter will emit `ReadReceipt` events that can be consumed by custom handlers

This is a passive tracking feature — it tells you when users have seen your bot's messages. No additional permissions are required beyond the existing `im:message` scope.

## Notes

- WebSocket mode means the bot works behind NAT/firewalls without port forwarding
- Only text messages are processed; images, files, and other types are ignored
- The adapter automatically handles connection lifecycle
- In group chats with `mention-only` policy (default), the bot only responds to messages that directly @mention it — other group traffic is ignored (configurable via `groupPolicy`)
- See the [permissions table](#permissions) for details on required vs. optional scopes and their degradation behavior
