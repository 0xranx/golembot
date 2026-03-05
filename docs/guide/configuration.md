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

# Optional: group chat behaviour (applies to all channels)
groupChat:
  groupPolicy: mention-only  # mention-only (default) | smart | always
  historyLimit: 20           # recent messages to inject as context (default: 20)
  maxTurns: 10               # max consecutive bot replies per group (default: 10)

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
- `channels.slack` — see [Slack setup](/channels/slack)
- `channels.telegram` — see [Telegram setup](/channels/telegram)
- `channels.discord` — see [Discord setup](/channels/discord)
- Any other key with `_adapter: <path>` — see [Custom Adapters](/channels/overview#custom-adapters)

### `groupChat`

Controls how the bot participates in group chats across all channels.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `groupPolicy` | `string` | `mention-only` | Response policy — see below |
| `historyLimit` | `number` | `20` | Recent messages to inject as context |
| `maxTurns` | `number` | `10` | Max consecutive bot replies per group (safety valve) |

**`groupPolicy` values:**

| Value | Agent called | Replies when | Use case |
|-------|-------------|-------------|---------|
| `mention-only` | Only on @mention | Only when @mentioned | Low noise, lowest cost |
| `smart` | Every message | Agent decides (outputs `[PASS]` to stay silent) | Bot observes all and builds memory continuously |
| `always` | Every message | Every message | High-interaction small groups |

::: tip Smart mode and group memory
In `smart` mode the agent runs on every group message — even when it stays silent by outputting `[PASS]`. This means the agent can read and update its group memory file (`memory/groups/<group>.md`) continuously, giving it full context of the conversation at all times.

In `mention-only` mode the agent only runs when @mentioned, so memory is only updated at those moments.
:::

```yaml
groupChat:
  groupPolicy: smart     # mention-only (default) | smart | always
  historyLimit: 30       # inject last 30 messages as context (default: 20)
  maxTurns: 5            # stop after 5 consecutive bot replies (default: 10)
```

### Conversation History

GolemBot automatically records conversations to `.golem/history/{sessionKey}.jsonl` and restores context when sessions are lost (engine switch, expiry, or resume failure). No configuration needed.

See [Memory](/guide/memory) for the full details on conversation history, personal memory (`notes.md`), and group memory.

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

## Full Example with Group Chat

```yaml
name: my-bot
engine: claude-code

groupChat:
  groupPolicy: smart
  historyLimit: 30
  maxTurns: 5

channels:
  slack:
    botToken: ${SLACK_BOT_TOKEN}
    appToken: ${SLACK_APP_TOKEN}
  # Custom adapter example:
  my-platform:
    _adapter: ./adapters/my-platform.mjs
    apiKey: ${MY_PLATFORM_API_KEY}

gateway:
  port: 3000
  token: ${GOLEM_TOKEN}
```

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
  systemPrompt?: string;
  groupChat?: {
    groupPolicy?: 'mention-only' | 'smart' | 'always';  // default: 'mention-only'
    historyLimit?: number;   // default: 20
    maxTurns?: number;       // default: 10
  };
  channels?: {
    feishu?: { appId: string; appSecret: string; sendMarkdownAsCard?: boolean };
    dingtalk?: { clientId: string; clientSecret: string };
    wecom?: {
      corpId: string; agentId: string; secret: string;
      token: string; encodingAESKey: string; port?: number;
    };
    slack?: { botToken: string; appToken: string };
    telegram?: { botToken: string };
    discord?: { botToken: string; botName?: string };
    // Custom adapter: any key with _adapter field
    [key: string]: { _adapter: string; [k: string]: unknown } | undefined;
  };
  gateway?: {
    port?: number;
    host?: string;
    token?: string;
  };
}
```
