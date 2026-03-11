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

## Message Format Conversion

GolemBot automatically converts standard Markdown to each platform's native format:

| Channel | Output Format | Conversion |
|---------|--------------|------------|
| Feishu | Card v2 (interactive) | Native Markdown rendering — headings, lists, code blocks, tables |
| Slack | mrkdwn | `**bold**` → `*bold*`, `*italic*` → `_italic_`, links rewritten |
| Telegram | HTML | `**bold**` → `<b>`, code blocks → `<pre><code>`, blockquotes → `<blockquote>` |
| Discord | Markdown (native) | No conversion needed — Discord renders Markdown natively |
| DingTalk | Markdown (native) | Passed through as-is |
| WeCom | Plain text | Markdown stripped (WeCom text API has limited formatting) |

The AI agent is encouraged to use standard Markdown syntax (headings, lists, bold, code blocks, etc.) — each adapter handles the platform-specific conversion automatically.

## Group Chat, Mentions & Quote Reply

GolemBot supports group chat response policies (mention-only / smart / always), incoming and outgoing @mention resolution, and quote reply on supported platforms.

See [Group Chat](/guide/group-chat) for full details.

## Inbox & History Fetch

When enabled, messages are queued persistently and the bot catches up on missed messages after restart via intelligent triage.

See [Inbox & History Fetch](/guide/inbox) for the full guide and platform support table.

## Custom Adapters

Connect any platform by writing an adapter class and referencing it with `_adapter` in `golem.yaml`:

```yaml
channels:
  my-platform:
    _adapter: ./adapters/my-platform.mjs   # or npm package name
    token: ${MY_PLATFORM_TOKEN}
```

See [Channel Adapter API](/api/channel-adapter) for the full interface, implementation guide, and examples.

## Image Support (Multimodal)

GolemBot supports **image messages** across all 6 built-in channels. When a user sends an image (photo, screenshot, file attachment), the adapter downloads it and passes it through the full pipeline:

```
User sends image → Adapter downloads to Buffer → gateway passes to assistant.chat()
→ image saved to .golem/images/ → file path appended to prompt → agent reads the file
→ cleanup after response
```

| Channel | Image Source | Caption/Text |
|---------|-------------|-------------|
| Feishu | `image` messages + inline images in `post` (rich text) | Post text content extracted |
| Slack | File attachments with image content type | Message text preserved |
| Telegram | `message.photo` (picks largest size) | `message.caption` used as text |
| Discord | `message.attachments` with image content type | Message text preserved |
| DingTalk | `picture` messages + images in `richText` | Rich text content extracted |
| WeCom | `image` messages via media API | Text set to `(image)` |

**How it works:** Images are saved as temporary files in `.golem/images/` and referenced by absolute path in the prompt. This works universally with all engines (Cursor, Claude Code, OpenCode, Codex) since every coding CLI can read local files. Files are automatically cleaned up after the agent responds.

**HTTP API:** The `POST /chat` endpoint also accepts base64-encoded images — see [HTTP API](/api/http-api#post-chat).

## Proactive Messaging (Scheduled Tasks)

Beyond responding to incoming messages, GolemBot can **proactively send messages** to IM channels on a schedule. Define tasks in `golem.yaml` and the agent will execute prompts automatically, pushing results to your IM channels.

See [Scheduled Tasks](/guide/scheduled-tasks) for full configuration, management commands, and use case examples.

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
