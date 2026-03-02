# Configuration

GolemBot uses a single configuration file: `golem.yaml` in the assistant directory root.

## Full Example

```yaml
name: my-assistant
engine: claude-code          # cursor | claude-code | opencode | codex
model: claude-sonnet         # optional, preferred model

# Optional: bypass agent permission prompts
skipPermissions: true

# Optional: role/persona definition — injected into AGENTS.md as a System Instructions
# section, read by the engine once per session (not prepended to every message)
systemPrompt: |
  You are a marketing assistant named Aria. Never introduce yourself as OpenCode
  or any coding assistant. Reply in the same language the user uses.

# Optional: production hardening
timeout: 120                 # engine timeout in seconds (default: 300)
maxConcurrent: 20            # max parallel chats (default: 10)
maxQueuePerSession: 2        # max queued requests per user (default: 3)
sessionTtlDays: 14           # prune idle sessions after N days (default: 30)

# Optional: IM channel configuration
channels:
  feishu:
    appId: ${FEISHU_APP_ID}
    appSecret: ${FEISHU_APP_SECRET}
  dingtalk:
    clientId: ${DINGTALK_CLIENT_ID}
    clientSecret: ${DINGTALK_CLIENT_SECRET}
  wecom:
    corpId: ${WECOM_CORP_ID}
    agentId: ${WECOM_AGENT_ID}
    secret: ${WECOM_SECRET}
    token: ${WECOM_TOKEN}
    encodingAESKey: ${WECOM_ENCODING_AES_KEY}
    port: 9000

# Optional: gateway service configuration
gateway:
  port: 3000
  host: 127.0.0.1
  token: ${GOLEM_TOKEN}
```

## Fields

### Required

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Assistant name |
| `engine` | `string` | Engine type: `cursor`, `claude-code`, `opencode`, or `codex` |

### Optional

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `model` | `string` | — | Preferred model. Format varies by engine — see each engine's docs for valid values |
| `skipPermissions` | `boolean` | `true` | Whether to bypass agent permission prompts |
| `timeout` | `number` | `300` | Engine invocation timeout in seconds. The underlying CLI process is killed and a `type: 'error'` event is emitted |
| `maxConcurrent` | `number` | `10` | Maximum number of parallel `chat()` calls across all sessions |
| `maxQueuePerSession` | `number` | `3` | Maximum number of requests that can be queued per session key |
| `sessionTtlDays` | `number` | `30` | Sessions not used for this many days are pruned at next startup |
| `systemPrompt` | `string` | — | Role/persona instructions injected into `AGENTS.md` as a `## System Instructions` section. The engine reads this once as system-level context — it is **not** prepended to every message, so token cost stays flat across multi-turn conversations |
| `channels` | `object` | — | IM channel configurations |
| `gateway` | `object` | — | Gateway service settings |

### `channels`

Configure one or more IM platforms. Only configured channels are started by the gateway.

- `channels.feishu` — see [Feishu setup](/channels/feishu)
- `channels.dingtalk` — see [DingTalk setup](/channels/dingtalk)
- `channels.wecom` — see [WeCom setup](/channels/wecom)

### `gateway`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `port` | `number` | `3000` | HTTP service port |
| `host` | `string` | `127.0.0.1` | Bind address |
| `token` | `string` | — | Bearer token for HTTP API authentication |

## Environment Variable Placeholders

Sensitive fields support `${ENV_VAR}` syntax. At load time, GolemBot resolves these against `process.env`.

```yaml
gateway:
  token: ${GOLEM_TOKEN}    # resolved from process.env.GOLEM_TOKEN
```

This works for all string values within `channels` and `gateway` blocks. Use a `.env` file alongside `golem.yaml` — the CLI auto-loads `.env` from the working directory at startup.

### `.env` Example

```sh
FEISHU_APP_ID=cli_xxxxxxxxxx
FEISHU_APP_SECRET=xxxxxxxxxx
GOLEM_TOKEN=my-secret-token
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxx
```

::: tip
Add `.env` to `.gitignore` and commit `.env.example` (without real values) for sharing.
:::

## Model Names by Engine

The `model` value format is different for each engine:

| Engine | Format | Example | Where to find values |
|--------|--------|---------|----------------------|
| `cursor` | Cursor model name | `claude-sonnet-4-5` | Cursor → Settings → Models |
| `claude-code` | Anthropic model ID | `claude-sonnet-4-6` | `claude models` |
| `opencode` | `provider/model` | `anthropic/claude-sonnet-4-5` | `opencode models` |
| `codex` | OpenAI model name | `codex-mini-latest` | `codex models` |

See the individual engine pages for full model tables and runtime override syntax.

## Skills Are Not Configured

Skills are **not** declared in `golem.yaml`. The `skills/` directory is the single source of truth — whatever skill directories exist, those capabilities are loaded. See [Skills](/skills/overview).

## GolemConfig TypeScript Type

```typescript
interface GolemConfig {
  name: string;
  engine: string;
  model?: string;
  skipPermissions?: boolean;
  timeout?: number;             // seconds, default 300
  maxConcurrent?: number;       // default 10
  maxQueuePerSession?: number;  // default 3
  sessionTtlDays?: number;      // default 30
  channels?: {
    feishu?: { appId: string; appSecret: string };
    dingtalk?: { clientId: string; clientSecret: string };
    wecom?: {
      corpId: string;
      agentId: string;
      secret: string;
      token: string;
      encodingAESKey: string;
      port?: number;
    };
  };
  gateway?: {
    port?: number;
    host?: string;
    token?: string;
  };
}
```
