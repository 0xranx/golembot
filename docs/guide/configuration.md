# Configuration

GolemBot uses a single configuration file: `golem.yaml` in the assistant directory root.

## Minimal Config

A working `golem.yaml` only needs two lines:

```yaml
name: my-bot
engine: claude-code
```

Everything else below is optional — add fields as you need them.

## Full Example

```yaml
name: my-assistant
engine: claude-code          # cursor | claude-code | opencode | codex | grok
model: claude-sonnet         # optional, preferred model

# Optional: bypass agent permission prompts
skipPermissions: true

# Optional: Codex runtime mode (Codex engine only)
codex:
  mode: unrestricted         # optional shorthand: unrestricted | safe
  sandbox: workspace-write   # read-only | workspace-write | danger-full-access
  approval: on-request       # untrusted | on-request | never
  search: true
  addDirs:
    - ../shared-assets

# Optional: granular agent permissions (Cursor engine only)
permissions:
  allowedPaths:
    - ./src
    - ./tests
  deniedPaths:
    - ./.env
    - ./secrets
  allowedCommands:
    - npm test
    - npm run build
  deniedCommands:
    - rm -rf *

# Optional: role/persona definition — injected into AGENTS.md as a System Instructions
# section, read by the engine once per session (not prepended to every message)
systemPrompt: |
  You are a marketing assistant named Aria. Never introduce yourself as OpenCode
  or any coding assistant. Reply in the same language the user uses.

# Optional: production hardening
timeout: 120                 # engine timeout in seconds (default: 600)
maxConcurrent: 20            # max parallel chats (default: 10)
maxQueuePerSession: 2        # max queued requests per user (default: 3)
sessionTtlDays: 14           # prune idle sessions after N days (default: 30)

# Optional: streaming message delivery for IM channels
streaming:
  mode: streaming            # buffered (default) | streaming
  showToolCalls: true        # show 🔧 tool hints in IM (default: false)

# Optional: group chat behaviour (applies to all channels)
groupChat:
  groupPolicy: mention-only  # mention-only (default) | smart | always
  historyLimit: 20           # recent messages to inject as context (default: 20)
  maxTurns: 10               # max consecutive bot replies per group (default: 10)

# Optional: scheduled tasks
tasks:
  - id: daily-standup
    name: daily-standup
    schedule: "0 9 * * 1-5"
    prompt: |
      Summarize all git commits in the last 24 hours,
      grouped by author. Flag any breaking changes.
    enabled: true
    target:
      channel: feishu
      chatId: "oc_xxxxx"

# Optional: persistent message queue (crash-safe, sequential processing)
inbox:
  enabled: true
  retentionDays: 7             # days to keep completed entries (default: 7)

# Optional: catch up on missed messages after restart
historyFetch:
  enabled: true
  pollIntervalMinutes: 15      # periodic poll interval (default: 15)
  initialLookbackMinutes: 60   # first-run lookback window (default: 60)

# Optional: route engine to a third-party LLM provider
provider:
  baseUrl: "https://openrouter.ai/api"
  apiKey: "${OPENROUTER_API_KEY}"
  model: "anthropic/claude-sonnet-4"
  models:                            # per-engine overrides
    codex: "openai/gpt-4.1-mini"

# Optional: IM channel configuration
channels:
  feishu:
    appId: ${FEISHU_APP_ID}
    appSecret: ${FEISHU_APP_SECRET}
    # Optional: set to lark for Lark global tenants
    # domain: lark
    # Optional: WebSocket pong timeout in seconds
    # pingTimeout: 30
  dingtalk:
    clientId: ${DINGTALK_CLIENT_ID}
    clientSecret: ${DINGTALK_CLIENT_SECRET}
  wecom:
    botId: ${WECOM_BOT_ID}
    secret: ${WECOM_SECRET}

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
| `engine` | `string` | Engine type: `cursor`, `claude-code`, `opencode`, `codex`, or `grok` |

### Optional

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `model` | `string` | — | Preferred model. Format varies by engine — see each engine's docs for valid values |
| `skipPermissions` | `boolean` | `true` | Whether to bypass agent permission prompts |
| `codex` | `object` | — | Codex-specific runtime options — see [`codex`](#codex) section |
| `timeout` | `number` | `600` | Engine invocation timeout in seconds. The underlying CLI process is killed and a `type: 'error'` event is emitted |
| `maxConcurrent` | `number` | `10` | Maximum number of parallel `chat()` calls across all sessions |
| `maxQueuePerSession` | `number` | `3` | Maximum number of requests that can be queued per session key |
| `sessionTtlDays` | `number` | `30` | Sessions not used for this many days are pruned at next startup |
| `systemPrompt` | `string` | — | Role/persona instructions injected into `AGENTS.md` as a `## System Instructions` section. The engine reads this once as system-level context — it is **not** prepended to every message, so token cost stays flat across multi-turn conversations |
| `permissions` | `object` | — | Granular agent permissions — see [`permissions`](#permissions) section. Currently Cursor engine only |
| `streaming` | `object` | — | Streaming message delivery for IM channels |
| `tasks` | `array` | — | Scheduled tasks — see [`tasks`](#tasks) section |
| `channels` | `object` | — | IM channel configurations |
| `inbox` | `object` | — | Persistent message queue — see [`inbox`](#inbox) section |
| `historyFetch` | `object` | — | History fetch for missed messages — see [`historyFetch`](#historyfetch) section |
| `oauthToken` | `string` | — | Claude Max subscription token (from `claude setup-token`). Claude Code engine only — see [Claude Code](/engines/claude-code#claude-max-subscription) |
| `persona` | `object` | — | Structured agent identity — see [`persona`](#persona) section |
| `provider` | `object` | — | Third-party LLM provider routing — see [Provider Routing](/guide/provider-routing) |
| `gateway` | `object` | — | Gateway service settings |

### `permissions`

Granular agent access control. When configured, `golembot init` generates `.cursor/cli.json` and the Cursor engine omits `--trust` so the CLI enforces these rules.

::: warning Cursor only
Currently only the **Cursor** engine supports granular permissions via `.cursor/cli.json`. For other engines, this config is parsed but has no effect.
:::

```yaml
permissions:
  allowedPaths:
    - ./src
    - ./tests
  deniedPaths:
    - ./.env
    - ./secrets
  allowedCommands:
    - npm test
    - npm run build
  deniedCommands:
    - rm -rf *
```

| Field | Type | Description |
|-------|------|-------------|
| `allowedPaths` | `string[]` | Paths the agent is allowed to read/write (relative to workspace) |
| `deniedPaths` | `string[]` | Paths the agent must not access |
| `allowedCommands` | `string[]` | Shell commands the agent is allowed to run |
| `deniedCommands` | `string[]` | Shell commands the agent must not run |

All fields are optional. Empty or omitted arrays have no effect. Run `golembot init` after changing permissions to regenerate `.cursor/cli.json`.

### `codex`

Codex-specific execution settings.

```yaml
codex:
  mode: unrestricted
  sandbox: workspace-write
  approval: on-request
  search: false
  addDirs:
    - ../shared-assets
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `mode` | `string` | `unrestricted` | Compatibility shorthand. `unrestricted` runs Codex with `--dangerously-bypass-approvals-and-sandbox`. `safe` uses `--full-auto` |
| `sandbox` | `string` | — | Fine-grained sandbox control: `read-only`, `workspace-write`, or `danger-full-access` |
| `approval` | `string` | — | Fine-grained approval policy: `untrusted`, `on-request`, or `never` (passed before `exec`) |
| `search` | `boolean` | `false` | Enable Codex live web search (`--search`, passed before `exec`) |
| `addDirs` | `string[]` | — | Extra writable directories passed as `--add-dir` (resolved relative to the workspace when not absolute) |

If `sandbox` or `approval` is set, GolemBot uses explicit `--sandbox` / `--ask-for-approval` flags and does not use `mode`. `approval` and `search` are forwarded as top-level Codex CLI flags before `exec`; `sandbox` and `addDirs` remain on the `exec` subcommand. When only one of `sandbox` or `approval` is set, the other defaults to `workspace-write` / `on-request`.

### `persona`

Structured agent identity rendered into `AGENTS.md`. The `role` field is also propagated to fleet registration, enabling multi-bot peer awareness.

```yaml
persona:
  role: product analyst
```

| Field | Type | Description |
|-------|------|-------------|
| `role` | `string` | Agent's domain role (e.g. `"product analyst"`, `"customer support"`, `"user researcher"`) |
| `displayName` | `string` | Display name (defaults to `name`) |
| `tone` | `string` | Communication style (e.g. `"professional"`, `"casual"`) |
| `boundaries` | `string[]` | Topics or actions the agent should decline |

You can also set the role during initialization with `golembot init --role "product analyst"`.

### `streaming`

Controls how the gateway delivers messages to IM channels.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `mode` | `string` | `buffered` | `buffered` — accumulate the full reply and send once. `streaming` — send text incrementally at paragraph boundaries and tool call events |
| `showToolCalls` | `boolean` | `false` | When `true`, send a `🔧 toolName...` hint to the chat each time the agent invokes a tool |

In **buffered** mode (default), the bot waits until the agent finishes and sends one complete message. In **streaming** mode, the bot flushes text to IM at semantic boundaries:

- **Paragraph breaks** (`\n\n`) — completed paragraphs are sent immediately
- **Tool calls** — accumulated text is flushed before the tool hint
- **Done** — any remaining text is flushed

Streaming mode provides faster visual feedback for long, multi-step agent responses.

```yaml
streaming:
  mode: streaming
  showToolCalls: true
```

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

Controls how the bot participates in group chats — response policies, @mention handling, quote reply, and group memory.

```yaml
groupChat:
  groupPolicy: smart     # mention-only (default) | smart | always
  historyLimit: 30       # inject last 30 messages as context (default: 20)
  maxTurns: 5            # stop after 5 consecutive bot replies (default: 10)
```

See [Group Chat](/guide/group-chat) for full details on policies, mention handling, quote reply, and group memory.

### `tasks`

Define scheduled tasks that run automatically on a cron schedule. Each task sends a prompt to the engine and (optionally) delivers the result to an IM channel.

```yaml
tasks:
  - id: daily-standup
    name: daily-standup
    schedule: "0 9 * * 1-5"
    prompt: |
      Summarize all git commits in the last 24 hours,
      grouped by author. Flag any breaking changes.
    enabled: true
    target:
      channel: feishu
      chatId: "oc_xxxxx"
```

See [Scheduled Tasks](/guide/scheduled-tasks) for full configuration reference, schedule formats, management commands, and use case examples.

### Conversation History

GolemBot automatically records conversations and restores context when sessions are lost. No configuration needed. See [Memory](/guide/memory) for details.

### `provider`

Route any engine to a third-party LLM API. See [Provider Routing](/guide/provider-routing) for full documentation.

| Field | Type | Description |
|-------|------|-------------|
| `baseUrl` | `string` | Provider API endpoint |
| `apiKey` | `string` | API key (supports `${ENV_VAR}` placeholders) |
| `model` | `string` | Default model for all engines |
| `models` | `object` | Per-engine model overrides (key = engine name) |
| `fallback` | `object` | Secondary provider config — GolemBot switches to this after consecutive failures. Same fields as `provider` (except nested `fallback` is ignored) |
| `failoverThreshold` | `number` | Consecutive errors before activating fallback (default: `3`) |

### `gateway`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `port` | `number` | `3000` | HTTP service port |
| `host` | `string` | `127.0.0.1` | Bind address |
| `token` | `string` | — | Bearer token for HTTP API authentication |

### `inbox`

Persistent message queue — messages survive crashes and are consumed sequentially.

```yaml
inbox:
  enabled: true          # default: false
  retentionDays: 7       # days to keep completed entries
```

### `historyFetch`

Catch up on missed messages after restart with intelligent triage.

```yaml
historyFetch:
  enabled: true
  pollIntervalMinutes: 15
  initialLookbackMinutes: 60
```

See [Inbox & History Fetch](/guide/inbox) for full details on crash recovery, smart triage, platform support, and deduplication.

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
| `cursor` | Cursor model name | `sonnet-4.6` | Cursor → Settings → Models |
| `claude-code` | Anthropic model ID | `claude-sonnet-4-6` | `claude models` |
| `opencode` | `provider/model` | `anthropic/claude-sonnet-4-5` | `opencode models` |
| `codex` | OpenAI model name | `codex-mini-latest` | `codex models` |

See the individual engine pages for full model tables and runtime override syntax.

## Full Example

```yaml
name: my-bot
engine: claude-code

groupChat:
  groupPolicy: smart
  historyLimit: 30
  maxTurns: 5

inbox:
  enabled: true
  retentionDays: 7

historyFetch:
  enabled: true
  pollIntervalMinutes: 15
  initialLookbackMinutes: 60

channels:
  slack:
    botToken: ${SLACK_BOT_TOKEN}
    appToken: ${SLACK_APP_TOKEN}

gateway:
  port: 3000
  token: ${GOLEM_TOKEN}
```

## Dashboard Configuration Panel

When running `golembot gateway`, the web dashboard includes a **Configuration Panel** that displays all `golem.yaml` settings and supports **inline editing** — hover over a value, click the pencil button (✎), modify, and save. Changes are written to `golem.yaml` immediately.

For full details on the dashboard, inline editing workflow, and hot-reload vs restart behavior, see [Dashboard](/guide/dashboard).

## Skills Are Not Configured

Skills are **not** declared in `golem.yaml`. The `skills/` directory is the single source of truth — whatever skill directories exist, those capabilities are loaded. See [Skills](/skills/overview).

## GolemConfig TypeScript Type

```typescript
interface GolemConfig {
  name: string;
  engine: string;
  model?: string;
  skipPermissions?: boolean;
  codex?: {
    mode?: 'safe' | 'unrestricted';
    sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';
    approval?: 'untrusted' | 'on-request' | 'never';
    search?: boolean;
    addDirs?: string[];
  };
  timeout?: number;             // seconds, default 600
  maxConcurrent?: number;       // default 10
  maxQueuePerSession?: number;  // default 3
  sessionTtlDays?: number;      // default 30
  systemPrompt?: string;
  permissions?: {
    allowedPaths?: string[];
    deniedPaths?: string[];
    allowedCommands?: string[];
    deniedCommands?: string[];
  };
  streaming?: {
    mode?: 'buffered' | 'streaming';  // default: 'buffered'
    showToolCalls?: boolean;          // default: false
  };
  groupChat?: {
    groupPolicy?: 'mention-only' | 'smart' | 'always';  // default: 'mention-only'
    historyLimit?: number;   // default: 20
    maxTurns?: number;       // default: 10
  };
  tasks?: Array<{
    id: string;
    name: string;
    schedule: string;
    prompt: string;
    enabled?: boolean;       // default: true
    target?: {
      channel: string;
      chatId: string;
    };
  }>;
  channels?: {
    feishu?: { appId: string; appSecret: string; domain?: string; pingTimeout?: number };
    dingtalk?: { clientId: string; clientSecret: string };
    wecom?: {
      botId: string; secret: string; websocketUrl?: string;
    };
    slack?: { botToken: string; appToken: string };
    telegram?: { botToken: string };
    discord?: { botToken: string; botName?: string };
    // Custom adapter: any key with _adapter field
    [key: string]: { _adapter: string; [k: string]: unknown } | undefined;
  };
  inbox?: {
    enabled?: boolean;           // default: false
    retentionDays?: number;      // default: 7
  };
  historyFetch?: {
    enabled?: boolean;           // default: false
    pollIntervalMinutes?: number;    // default: 15
    initialLookbackMinutes?: number; // default: 60
  };
  provider?: {
    baseUrl?: string;
    apiKey?: string;
    model?: string;
    models?: Record<string, string>;
    fallback?: {                 // secondary provider for automatic failover
      baseUrl?: string;
      apiKey?: string;
      model?: string;
    };
    failoverThreshold?: number;  // default: 3
  };
  oauthToken?: string;           // Claude Max setup-token (claude-code engine only)
  gateway?: {
    port?: number;
    host?: string;
    token?: string;
  };
}
```
