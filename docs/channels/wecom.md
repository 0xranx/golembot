# WeCom (WeChat Work)

Connect your GolemBot assistant to WeCom using the official AI Bot SDK with WebSocket. **No public IP required.**

## Prerequisites

```bash
pnpm add @wecom/aibot-node-sdk
```

## WeCom Admin Setup

1. Go to [WeCom Admin Console](https://work.weixin.qq.com/) → **App Management** → create a new AI Bot
2. Note down the **Bot ID** and **Secret**
3. The SDK uses WebSocket — no callback URL configuration needed

## Configuration

```yaml
# golem.yaml
channels:
  wecom:
    botId: ${WECOM_BOT_ID}
    secret: ${WECOM_SECRET}
    # websocketUrl: wss://custom-endpoint  # optional, for private deployments
```

```sh
# .env
WECOM_BOT_ID=xxxxxxxxxx
WECOM_SECRET=xxxxxxxxxxxxxxxxxx
```

## How It Works

- **Transport**: WebSocket long-connection via `@wecom/aibot-node-sdk`
- **Connection**: The SDK establishes and maintains a WebSocket connection to WeCom servers
- **Reconnection**: Automatic reconnection and heartbeat are handled by the SDK
- **Messages**: Incoming messages are received via WebSocket events and emitted as `ChannelMessage` (text only)
- **Sending media**: The bot can send images and files when the agent outputs a `[SEND_IMAGE: <path>]` or `[SEND_FILE: <path>]` marker line. Images and files are delivered as separate media messages — the bot sends media messages first, then the completion marker ("mission complete") after a short confirmation delay, so media appears before the marker in the WeCom UI. Agents should save files to the `temp_file/` workspace directory (auto-created at gateway startup). Minimum file size is 5 bytes. Images must be PNG, JPG, or GIF and ≤10MB; files ≤20MB. Paths can be relative to the assistant workspace or absolute paths inside it; paths outside the workspace are rejected.
- **Reply**: Sends messages via the SDK's built-in reply method
- **Proactive messaging**: `send()` is supported — the adapter can proactively send messages to any chat
- **Chat type**: Always `dm` (WeCom bot messages are direct messages)

## Start

```bash
golembot gateway --verbose
```

The adapter connects to WeCom via WebSocket automatically. No port forwarding or public IP needed.

## Notes

- Like Feishu and DingTalk, WeCom now uses **WebSocket** — no public IP or reverse proxy required
- The `@wecom/aibot-node-sdk` handles reconnection and heartbeat automatically
- The max message length is 2,048 characters; longer responses are automatically split
- Only text messages are received; the bot can send images (PNG, JPG, GIF; ≤10MB) and files (≤20MB, min 5 bytes) as separate media messages via `[SEND_IMAGE: <path>]` / `[SEND_FILE: <path>]` markers, delivered right before the completion marker. Agents save to `temp_file/` (workspace-relative) by default; paths outside the workspace are rejected.
