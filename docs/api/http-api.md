# HTTP API

GolemBot includes a built-in HTTP server with SSE streaming, accessible via `golembot serve` or `createGolemServer()`.

## Endpoints

### `POST /chat`

Send a message and receive a Server-Sent Events (SSE) stream.

**Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Body:**
```json
{
  "message": "Analyze the sales data",
  "sessionKey": "user-123",
  "images": [
    {
      "mimeType": "image/png",
      "data": "<base64-encoded image data>",
      "fileName": "screenshot.png"
    }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `message` | `string` | Yes* | The user's message (*optional when `images` is provided) |
| `sessionKey` | `string` | No | Session identifier (default: `"default"`) |
| `images` | `array` | No | Array of base64-encoded image attachments |
| `images[].mimeType` | `string` | No | MIME type (default: `"image/png"`) |
| `images[].data` | `string` | Yes | Base64-encoded image data |
| `images[].fileName` | `string` | No | Original filename |

When `images` are provided without a `message`, the message defaults to `"(image)"`. Images are saved to `.golem/images/`, referenced by path in the prompt, and cleaned up after the response.

**Response:** `text/event-stream`

```
data: {"type":"text","content":"Let me look at "}

data: {"type":"text","content":"the data..."}

data: {"type":"tool_call","name":"readFile","args":"{\"path\":\"sales.csv\"}"}

data: {"type":"tool_result","content":"date,revenue\n2026-01,..."}

data: {"type":"text","content":"Here's the analysis..."}

data: {"type":"done","sessionId":"abc-123","durationMs":8500}

data: {"type":"completion","status":"completed","finalText":"Here's the analysis...","sessionId":"abc-123","durationMs":8500}

```

Each event is a JSON-encoded [StreamEvent](/api/stream-events).

`completion` is the terminal contract for `/chat`. SSE clients should treat it as the authoritative final outcome. The lower-level `done` event is still included for compatibility and engine metadata.

**Slash commands:** When the message starts with `/`, it is handled as a slash command and returns a JSON response (not SSE):

```bash
curl -X POST http://localhost:3000/chat \
  -H "Authorization: Bearer my-secret" \
  -H "Content-Type: application/json" \
  -d '{"message": "/model list"}'
```

```json
{
  "type": "command",
  "engine": "claude-code",
  "models": ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
  "text": "Available models for claude-code (3):\n  claude-opus-4-6\n  ..."
}
```

Available slash commands: `/help`, `/status`, `/engine [name]`, `/model [list|name]`, `/skill`, `/cron`, `/reset`, `/stop`.

**Scheduled task management via HTTP:**

The `/cron` slash commands work via `POST /chat` like any other slash command. For example, to list all scheduled tasks:

```bash
curl -X POST http://localhost:3000/chat \
  -H "Authorization: Bearer my-secret" \
  -H "Content-Type: application/json" \
  -d '{"message":"/cron list"}'
```

Subcommands: `list`, `run <id>`, `enable <id>`, `disable <id>`, `del <id>`, `history <id>`.

::: warning Error events in SSE
The `/chat` endpoint always returns `200 OK` — errors are delivered as events inside the stream:

```
data: {"type":"error","message":"Server busy: too many concurrent requests (limit: 10). Try again later."}
data: {"type":"error","message":"Too many pending requests for this session (limit: 3). Try again later."}
data: {"type":"error","message":"Agent invocation timed out"}
```

Always check for `type === "error"` in your SSE handler.
:::

::: tip Prefer `completion` for terminal handling
For robust clients, keep reading until you receive `type === "completion"`. A turn now resolves into one of four terminal states:
- `completed`
- `silent`
- `failed`
- `aborted`
:::

### `POST /command`

Invoke a **native engine command** — e.g. an OpenCode custom slash command like
`review`, `plan`, or `implement` defined in `~/.config/opencode/commands/` or
`.opencode/commands/` — and receive a Server-Sent Events (SSE) stream, using
the same event/response model as `/chat`.

This is materially different from sending `"/review ..."` as a normal chat
message: `/chat` either intercepts Golem's own control commands (`/help`,
`/status`, `/reset`, etc.) or forwards the text to the engine as an ordinary
prompt, where it is interpreted semantically rather than executed as a real
command. `/command` calls the engine's native command execution path
directly, so the command's own configured agent/model/instructions take
effect exactly as they would running `opencode run --command review` by hand.

**Currently supported engines:** `opencode` only. Other engines return a
clear error (see below) rather than silently converting the command to a
prompt.

**Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Body:**
```json
{
  "command": "review",
  "arguments": "the current changes",
  "sessionKey": "user-123"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `command` | `string` | Yes | The native command name (e.g. `review`, `plan`, `implement`), without a leading `/` |
| `arguments` | `string` | No | Text passed to the command as its arguments (e.g. OpenCode's `$ARGUMENTS`) |
| `sessionKey` | `string` | No | Session identifier (default: `"default"`), matching `/chat`'s `sessionKey` semantics — reuses the same saved engine session for that key if one exists |

**Response:** `text/event-stream`, using the same [StreamEvent](/api/stream-events) contract as `/chat`:

```
data: {"type":"text","content":"Reviewing the diff..."}

data: {"type":"tool_call","name":"readFile","args":"{\"path\":\"src/foo.ts\"}"}

data: {"type":"done","sessionId":"ses_abc123"}

data: {"type":"completion","status":"completed","finalText":"Reviewing the diff...","sessionId":"ses_abc123"}

```

**Unsupported engine:**

If the configured engine does not implement native commands, `/command` still
returns `200 OK` with an SSE stream (consistent with `/chat`'s error
contract), but the stream contains an `error` event followed by a failed
`completion` — it never falls back to sending the command as prompt text:

```
data: {"type":"error","message":"Engine \"cursor\" does not support native commands"}

data: {"type":"completion","status":"failed","message":"Engine \"cursor\" does not support native commands"}
```

::: tip Requires OpenCode with native command support
`/command` shells out to `opencode run --format json --command <name>`.
Requires an OpenCode CLI version that supports the `--command` flag
(verified against OpenCode 1.18.30).
:::

### `POST /reset`

Clear a session and its accumulated history.

**Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Body:**
```json
{
  "sessionKey": "user-123"
}
```

**Response:**
```json
{ "ok": true }
```

### `POST /abort`

Cancel the current in-flight task for a session without clearing its history.

**Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Body:**
```json
{
  "sessionKey": "user-123"
}
```

`sessionKey` is optional. When omitted, GolemBot cancels the default session.

**Response:**
```json
{ "ok": true, "aborted": true }
```

If there is no running task for that session, the response is:

```json
{ "ok": true, "aborted": false }
```

### `GET /health`

Health check endpoint (no authentication required).

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-03-01T12:00:00.000Z"
}
```

### `GET /` (Dashboard)

When running in gateway mode (`golembot gateway`), the root path serves an HTML Dashboard with:
- Bot status, engine, model, and uptime
- **Configuration Panel** — all `golem.yaml` settings at a glance (engine, model, codex.mode, timeout, gateway, provider, group chat, streaming, permissions, MCP servers, system prompt, inbox, escalation)
- **Fleet Peers** — multi-bot visibility when running multiple GolemBot instances
- Channel connection status (connected / failed / not configured)
- Real-time message statistics and cost tracking
- Live activity feed via SSE
- Skill Inventory
- Escalation panel (card-based design)
- Quick Test panel for sending messages directly from the browser
- HTTP API and embed SDK code examples with copy buttons

No authentication required (landing page).

### `GET /api/status`

Returns the current bot status and metrics as JSON. Requires authentication.

**Response:**
```json
{
  "name": "my-bot",
  "engine": "claude-code",
  "model": "claude-opus-4-6",
  "version": "0.13.1",
  "uptime": 3600000,
  "channels": [
    { "type": "telegram", "status": "connected" },
    { "type": "slack", "status": "not_configured" }
  ],
  "skills": [{ "name": "general", "description": "General assistant" }],
  "metrics": {
    "totalMessages": 42,
    "totalCostUsd": 1.23,
    "avgDurationMs": 2000,
    "messagesBySource": { "telegram": 30, "http": 12 }
  },
  "recentMessages": []
}
```

### `POST /api/send`

Send a proactive message to an IM channel (group or DM). Requires authentication.

**Body:**
```json
{
  "channel": "feishu",
  "chatId": "oc_xxxx",
  "text": "Meeting moved to 3pm"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `channel` | `string` | Yes | Channel name: `feishu`, `dingtalk`, `wecom`, `slack`, `telegram`, `discord` |
| `chatId` | `string` | Yes | Chat/group/user ID on the target platform |
| `text` | `string` | Yes | Message content (Markdown supported) |

**Response:**
```json
{ "ok": true }
```

**Error responses:**

| Status | Reason |
|--------|--------|
| `400` | Missing required fields |
| `404` | Channel not found (response includes available channels) |
| `501` | Channel adapter does not support proactive send |
| `503` | No channel adapters available |

### `PATCH /api/config`

Update `golem.yaml` settings remotely. Requires authentication.

**Body:** Partial `GolemConfig` JSON — only include the fields you want to change.

```json
{
  "timeout": 180,
  "codex": { "mode": "safe" },
  "groupChat": { "groupPolicy": "smart" }
}
```

**Response:**
```json
{
  "ok": true,
  "config": { /* full GolemConfig after merge */ },
  "needsRestart": false
}
```

The `needsRestart` flag indicates whether the change takes effect immediately or requires a gateway restart:

| Hot-reloadable (immediate) | Restart required |
|---|---|
| `timeout`, `maxConcurrent`, `sessionTtlDays`, `groupChat`, `streaming`, `persona`, `permissions`, `systemPrompt` | `engine`, `model`, `codex`, `channels`, `gateway`, `mcp`, `provider.baseUrl`, `provider.apiKey`, `provider.fallback` |

**Example:**

```bash
curl -X PATCH http://localhost:3000/api/config \
  -H "Authorization: Bearer my-secret" \
  -H "Content-Type: application/json" \
  -d '{"timeout": 180, "streaming": {"mode": "streaming"}}'
```

### `GET /api/channels`

List available IM channels and whether they support proactive send. Requires authentication.

**Response:**
```json
{
  "channels": [
    { "name": "feishu", "canSend": true },
    { "name": "slack", "canSend": true },
    { "name": "dingtalk", "canSend": false }
  ]
}
```

### `GET /api/events`

Real-time activity stream via Server-Sent Events. Each message processed by the gateway is broadcast as an SSE event. Requires authentication.

**Response:** `text/event-stream`

```
data: {"ts":"2026-03-07T12:00:00Z","source":"telegram","sender":"alice","messagePreview":"hello","responsePreview":"hi there","durationMs":1500,"costUsd":0.01}
```

When authentication is enabled, pass the token as a query parameter (since `EventSource` cannot set headers):

```
GET /api/events?token=my-secret
```

## Authentication

All endpoints except `/health` require a Bearer token:

```
Authorization: Bearer <token>
```

The token is configured via:
- `--token` CLI flag
- `GOLEM_TOKEN` environment variable
- `gateway.token` in `golem.yaml`

## CORS

The server allows all origins with `GET`, `POST`, `PATCH`, `DELETE`, `OPTIONS` methods and `Content-Type` + `Authorization` headers.

## Using the Server Programmatically

### `createGolemServer()`

```typescript
import { createAssistant, createGolemServer } from 'golembot';

const assistant = createAssistant({ dir: './my-bot' });
const server = createGolemServer(assistant, {
  port: 3000,
  token: 'my-secret',
  hostname: '127.0.0.1',
});
```

### `startServer()`

```typescript
import { createAssistant, startServer } from 'golembot';

const assistant = createAssistant({ dir: './my-bot' });
await startServer(assistant, { port: 3000, token: 'my-secret' });
```

### `ServerOpts`

```typescript
interface ServerOpts {
  port?: number;       // default: 3000 or GOLEM_PORT env
  token?: string;      // bearer token; also reads GOLEM_TOKEN env
  hostname?: string;   // default: '127.0.0.1'
}
```

## SSE Client Example

### curl

```bash
curl -N -X POST http://localhost:3000/chat \
  -H "Authorization: Bearer my-secret" \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello"}'
```

### JavaScript

```javascript
const response = await fetch('http://localhost:3000/chat', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer my-secret',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ message: 'Hello' }),
});

const reader = response.body.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  const text = decoder.decode(value);
  // Parse SSE lines: "data: {...}\n\n"
  for (const line of text.split('\n')) {
    if (line.startsWith('data: ')) {
      const event = JSON.parse(line.slice(6));
      console.log(event);
    }
  }
}
```
