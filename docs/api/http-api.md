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

```

Each event is a JSON-encoded [StreamEvent](/api/stream-events).

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

Available slash commands: `/help`, `/status`, `/engine [name]`, `/model [list|name]`, `/skill`, `/cron`, `/reset`.

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

### `POST /reset`

Clear a session.

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
- Channel connection status (connected / failed / not configured)
- Real-time message statistics and cost tracking
- Live activity feed via SSE
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

The server allows all origins with `GET`, `POST`, `OPTIONS` methods and `Content-Type` + `Authorization` headers.

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
