# GolemBot Architecture Design

> **Why "GolemBot"?** A Golem is a body shaped from clay in legend — write a true name (shem) on it and it comes to life.
> Our project works the same way: inject a Coding Agent as the soul into a directory, and it becomes your AI assistant.

> This document is the core architecture reference for the GolemBot project. All implementations should stay consistent with this document.
> When implementation conflicts with the architecture, or changes and optimizations are needed, **this document must be updated first**, before modifying code.

## 1. Product Positioning

**GolemBot is a local-first personal AI assistant — it uses the Coding Agent you already have as its brain, enabling it to not just chat, but actually get things done.**

The use case aligns with OpenClaw (personal assistant, multi-channel access, skill extensions), with the core difference being the brain:

- OpenClaw: directly calls LLM APIs + custom tool system → the brain is a stateless API
- GolemBot: uses Coding Agent CLI as the engine → **the brain is a stateful Coding Agent that lives inside a directory**

This leads to a key experience difference: **OpenClaw's assistant is global, while GolemBot's assistant is directory-bound.** Because a Coding Agent naturally works within a directory — skills, scripts, memory, and work artifacts all live inside it.

Unique advantages:

- **More capable**: Coding Agents can natively read/write files, run code, operate browsers, and perform multi-step reasoning
- **Choice of engine**: Cursor / Claude Code / Codex — use whichever you prefer
- **Fully transparent**: just `ls` the assistant directory to see what it knows, what it can do, and what it has done
- **Version-controllable**: the entire assistant can be managed, shared, and cloned via git

## 2. Core Philosophy

**Coding Agent = Soul, GolemBot = Body of Clay.**

GolemBot does not implement LLM reasoning, tool invocation, or context management. It only does three things:

1. Prepare the workspace (inject skills)
2. Invoke the Coding Agent CLI (pass in the user's message)
3. Return the response to the user

All the complex work (decision-making, planning, execution) is delegated to the Coding Agent.

### Library-First, CLI Is Just a Thin Shell

GolemBot's core is an **importable TypeScript library**, not a CLI tool. The CLI is just one consumer of this library.

```
              golembot core library (index.ts)
             createAssistant() → Assistant
            /        |         \         \
       CLI thin    library    HTTP       Bot
        shell      import    wrapper    wrapper
      (cli.ts)  (3rd-party) (3rd-party) (3rd-party)
```

All invocation methods share the same core logic with zero duplication. This makes GolemBot easy to **embed in any scenario**, serving as the core engine for Agent solutions across various domains.

## 3. Two Core Concepts

The entire framework has only two concepts — no more:

### 1. Assistant Directory

A directory is an assistant (a GolemBot). Directory structure:

```
~/my-assistant/
├── golem.yaml             # Assistant config (only engine type and name)
├── skills/                # Skills directory — whatever is here gets loaded
│   ├── general/
│   │   └── SKILL.md       # General assistant skill
│   └── ops-xhs/
│       ├── SKILL.md       # Xiaohongshu operations skill
│       ├── xhs.py         # Script bundled with the skill
│       └── brand-voice.md # Supporting knowledge document
├── AGENTS.md              # Auto-generated context document by Golem
├── .golem/                # Internal state (sessions, etc., gitignored)
└── ...                    # Any files produced during Agent work (notes, data, reports, etc.)
```

The config file `golem.yaml` is minimal — only configures the engine, not skills:

```yaml
name: my-assistant
engine: cursor              # cursor | claude-code | opencode
model: claude-sonnet        # Optional, preferred model

# Optional: IM channel configuration (gateway connects whichever channels are configured)
channels:
  feishu:
    appId: ${FEISHU_APP_ID}
    appSecret: ${FEISHU_APP_SECRET}
  dingtalk:
    clientId: ${DINGTALK_CLIENT_ID}
    clientSecret: ${DINGTALK_CLIENT_SECRET}

# Optional: gateway service configuration
gateway:
  port: 3000
  token: ${GOLEM_TOKEN}
```

Sensitive fields support `${ENV_VAR}` placeholder references to environment variables (resolved by `resolveEnvPlaceholders()` at load time). Both `channels` and `gateway` are optional — when not configured, behavior is identical to pure CLI mode.

**Skills are not declared in the config.** The `skills/` directory is the single source of truth — whatever skills are inside, the assistant has those capabilities. Want to add a skill? Drop the folder in. Want to remove one? Delete the folder. `ls skills/` shows the assistant's full capability set.

### 2. Skill

A Skill is the carrier of an assistant's capabilities. A Skill is a directory containing:

- `SKILL.md`: knowledge and instructions (required)
- Any supporting files: knowledge documents, scripts, config templates, etc. (optional)

The format is fully compatible with Cursor's `.cursor/skills/`, Claude Code's `.claude/skills/`, and OpenClaw's `SKILL.md`.

**There is no separate Tool concept.** Scripts are placed directly in the Skill directory, and `SKILL.md` describes how to invoke them. Coding Agents can natively execute any script — no framework-level "registration" is needed.

## 4. Usage Methods

All methods internally share the same core logic (`createAssistant` → `assistant.chat()`).

### Method 1: CLI (Quickest Start)

```bash
npm install -g golembot

mkdir ~/my-assistant && cd ~/my-assistant
golembot init         # Interactive: choose engine, pick a name, generate config, copy default skills
golembot run          # REPL conversation
```

Want to add a skill? Just drop the Skill folder into the `skills/` directory — no commands needed.

### Method 2: Library Import (Developer Embedding)

```typescript
import { createAssistant } from 'golembot';

const assistant = createAssistant({ dir: './my-agent' });

for await (const event of assistant.chat('Analyze the competitor data')) {
  if (event.type === 'text') process.stdout.write(event.content);
}
```

### Method 3: Embedding in Various Scenarios

Slack Bot:

```typescript
import { createAssistant } from 'golembot';
const assistant = createAssistant({ dir: './slack-agent' });

slackApp.message(async ({ message, say }) => {
  let reply = '';
  for await (const event of assistant.chat(message.text)) {
    if (event.type === 'text') reply += event.content;
  }
  await say(reply);
});
```

HTTP API:

```typescript
import { createAssistant } from 'golembot';
const agent = createAssistant({ dir: './api-agent' });

app.post('/api/chat', async (req, res) => {
  for await (const event of agent.chat(req.body.message)) {
    res.write(JSON.stringify(event) + '\n');
  }
  res.end();
});
```

Electron desktop apps, Telegram bots, cron scheduled tasks... all follow the same pattern: create assistant → call chat() → handle the event stream.

### Method 4: Gateway (IM + HTTP Unified Service)

```bash
golembot gateway              # Reads channels config from golem.yaml, starts IM adapters + HTTP service
golembot gateway --port 3000  # Override port
golembot gateway --verbose    # Verbose logging
```

Gateway is a **long-running service** that internally reuses `createAssistant()` + `server.ts`, with an IM channel adapter layer on top. Whichever channels are configured in `golem.yaml`, Gateway automatically connects to the corresponding IM platforms at startup:

- **Feishu (Lark)**: WebSocket long-connection mode (no public IP required)
- **DingTalk**: Stream mode (WebSocket, no public IP required)
- **WeCom (WeChat Work)**: Webhook callback mode (requires a public URL)

IM channels and HTTP API work in parallel. One channel crashing does not affect the others.

### Method 5: Onboard Setup Wizard

```bash
mkdir my-bot && cd my-bot
golembot onboard
```

Interactive guided setup (7 steps): choose engine → pick a name → select IM channels → configure channel credentials → choose scenario template → generate config → start Gateway. Automatically generates `golem.yaml`, `.env`, `.env.example`, and `.gitignore`.

## 5. Architecture

### Source File Structure

Core and CLI are separated:

**Core library (importable):**

- **`index.ts`** — Public API: `createAssistant(opts) → Assistant`. Coordinates workspace, engine, and session. Includes a concurrency lock: for the same assistant instance and same sessionKey, only one `chat()` can execute at a time; different sessionKeys can run in parallel.
- **`engine.ts`** — Engine interface + Cursor / Claude Code / OpenCode three-engine implementation. Process management and skill injection are internal engine details.
- **`workspace.ts`** — Reads `golem.yaml` (including `channels` and `gateway` fields), scans the `skills/` directory, and auto-generates `AGENTS.md`. `resolveEnvPlaceholders()` resolves `${ENV_VAR}` placeholders.
- **`session.ts`** — Multi-user session storage: `.golem/sessions.json`, indexed by `sessionKey`.
- **`server.ts`** — HTTP service: `createServer(assistant, opts) → http.Server`. `POST /chat` (SSE), `POST /reset`, `GET /health`.
- **`channel.ts`** — `ChannelAdapter` interface and `ChannelMessage` type definitions. `buildSessionKey()` generates channel-level session keys, `stripMention()` removes @mentions.
- **`channels/feishu.ts`** — Feishu (Lark) adapter (`@larksuiteoapi/node-sdk` WebSocket long-connection mode).
- **`channels/dingtalk.ts`** — DingTalk adapter (`dingtalk-stream` Stream mode).
- **`channels/wecom.ts`** — WeCom adapter (`@wecom/crypto` + `xml2js` Webhook callback mode).
- **`gateway.ts`** — Gateway long-running service: reads golem.yaml → creates Assistant → starts HTTP service → iterates channels config to start adapters → routes messages to `assistant.chat()` → replies.

**CLI thin shell:**

- **`cli.ts`** — Command entry points: `init`, `run`, `serve`, `gateway`, `onboard`, `status`, `skill`. Automatically loads `.env` files.
- **`onboard.ts`** — Guided configuration wizard (7-step interactive). Generates golem.yaml, .env, .env.example, .gitignore, and optionally installs scenario templates.

**IM SDK dependency strategy**: `@larksuiteoapi/node-sdk`, `dingtalk-stream`, `@wecom/crypto`, and `xml2js` are all optional peerDependencies. Gateway dynamically imports the corresponding SDK at startup, providing installation prompts if missing.

### Core API

```typescript
export function createAssistant(opts: {
  dir: string;           // Assistant directory path
  engine?: string;       // Override engine config from golem.yaml
  model?: string;        // Override model config
  apiKey?: string;       // Agent API key (Cursor: CURSOR_API_KEY, Claude Code: ANTHROPIC_API_KEY, OpenCode: depends on Provider)
}): Assistant;

export interface Assistant {
  chat(message: string, opts?: { sessionKey?: string }): AsyncIterable<StreamEvent>;
  init(opts: { engine: string; name: string }): Promise<void>;
  resetSession(sessionKey?: string): Promise<void>;
}

export type StreamEvent =
  | { type: 'text'; content: string }
  | { type: 'tool_call'; name: string; args: string }
  | { type: 'tool_result'; content: string }
  | { type: 'error'; message: string }
  | { type: 'done'; sessionId?: string; durationMs?: number; costUsd?: number; numTurns?: number };
```

`costUsd` and `numTurns` are provided by the Claude Code engine; they are `undefined` for the Cursor engine.

The API is minimal: `createAssistant` + `chat` + `init` + `resetSession` — that's it.

### Session Routing (sessionKey)

`chat()` accepts an optional `sessionKey` parameter for session isolation in multi-user scenarios:

```typescript
// Single user (Phase 1 mode, fully backward compatible)
assistant.chat("Hello")
// Equivalent to assistant.chat("Hello", { sessionKey: "default" })

// Multi-user — each user gets an independent engine session
assistant.chat("Hello", { sessionKey: "feishu:user_123" })
assistant.chat("Look up the data", { sessionKey: "slack:U456" })
```

Storage structure changes:

```json
// Phase 1: .golem/sessions.json
{ "engineSessionId": "abc-123" }

// Phase 2: .golem/sessions.json
{
  "default": { "engineSessionId": "abc-123" },
  "feishu:user_123": { "engineSessionId": "def-456" },
  "slack:U456": { "engineSessionId": "ghi-789" }
}
```

Design principles:
- Default key is `"default"` — single-user scenarios need not be aware of sessionKey
- Different sessionKeys map to different engine sessions, but **share the same skills and working directory**
- Lock granularity changed from "one global lock" to **per-sessionKey locking**: same key queues, different keys run in parallel
- `resetSession(key?)` clears the session for the specified key; omitting it clears `"default"`

### HTTP Service (`golembot serve`)

Built-in lightweight HTTP service, allowing any IM webhook to connect:

```bash
golembot serve --port 3000 --token my-secret
```

**Endpoint design:**

```
POST /chat
  Headers: Authorization: Bearer <token>
  Body: { "message": "Hello", "sessionKey": "feishu:user_123" }
  Response: text/event-stream (SSE)
    data: {"type":"text","content":"Hello"}
    data: {"type":"tool_call","name":"readFile","args":"{}"}
    data: {"type":"done","sessionId":"xxx"}

POST /reset
  Headers: Authorization: Bearer <token>
  Body: { "sessionKey": "feishu:user_123" }
  Response: 200 { "ok": true }

GET /health
  Response: 200 { "status": "ok", "name": "my-assistant" }
```

**Design principles:**
- Uses Node.js built-in `node:http`, zero extra dependencies
- SSE protocol (`text/event-stream`), consumable by all languages/platforms
- Bearer token authentication (`--token` parameter or `GOLEM_TOKEN` environment variable)
- `server.ts` exports a `createServer()` factory, usable by both CLI and third parties

**Typical flow for connecting IM:**

```
Feishu webhook → your 3-line forwarding script → POST localhost:3000/chat → SSE → push back to Feishu
Slack event   → your 3-line forwarding script → POST localhost:3000/chat → SSE → push back to Slack
```

**You can also import the library directly (no HTTP):**

```typescript
import { createAssistant } from 'golembot';
const bot = createAssistant({ dir: './my-bot' });

slackApp.message(async ({ message, say }) => {
  let reply = '';
  for await (const ev of bot.chat(message.text, { sessionKey: `slack:${message.user}` })) {
    if (ev.type === 'text') reply += ev.content;
  }
  await say(reply);
});
```

### `init` Workflow

```
golembot init (or assistant.init())
1. Check if directory already has golem.yaml → error if yes
2. Interactive prompts: engine type (cursor/claude-code/opencode), assistant name
3. Create golem.yaml
4. Create skills/ directory
5. Copy built-in skills to skills/ (general + im-adapter)
6. Create .golem/ directory (internal state)
7. Generate AGENTS.md
8. Generate .gitignore (ignoring .golem/)
```

### Gateway Workflow

```
golembot gateway
1. Auto-load .env (at CLI entry layer)
2. Read golem.yaml (channels + gateway config)
3. resolveEnvPlaceholders() resolves ${ENV_VAR} placeholders
4. Create Assistant instance
5. Start HTTP service (preserving /chat, /reset, /health endpoints)
6. Iterate channels config, dynamically import + start corresponding adapters
7. Adapter receives message → buildSessionKey() → stripMention() → assistant.chat() → reply
8. Streaming response concatenated into complete text before sending at once (IM platforms don't support streaming)
9. SIGINT/SIGTERM → gracefully shut down all adapters and HTTP service
```

### Data Flow: One Conversation Turn

Whether invoked via CLI or library import, the internal flow is exactly the same:

```
Caller → assistant.chat(message)
  → index.ts: acquire concurrency lock
  → workspace.ts: ensureReady() — scan skills/ + generate AGENTS.md
  → engine.ts: invoke(message, skillList, sessionId?)
    → Inject Skills:
        Cursor    → .cursor/skills/ symlink
        Claude    → .claude/skills/ symlink + CLAUDE.md
        OpenCode  → .opencode/skills/ symlink + opencode.json
    → Start Agent process:
        Cursor    → child_process.spawn
        Claude    → child_process.spawn
        OpenCode  → child_process.spawn
    → Parse output line by line → yield StreamEvent
  → index.ts: save session + release lock
  → Caller receives StreamEvent stream
```

### AGENTS.md Auto-Generation

`workspace.ts` auto-generates `AGENTS.md` in the assistant directory (note: this is in the assistant directory, not this project's) during each `ensureReady()` call, based on scanning the `skills/` directory:

```markdown
# Assistant Context

## Installed Skills
- general: General personal assistant capabilities
- ops-xhs: Xiaohongshu operations assistant (includes xhs.py script)

## Directory Structure
- skills/ — Skills directory (each subdirectory is a skill, containing SKILL.md and optional scripts)
- AGENTS.md — This file, auto-generated by GolemBot

## Conventions
- Information that needs to be remembered persistently should be written to notes.md
- Generated reports/files go into the corresponding directory
```

This lets the Coding Agent understand its environment and capabilities from the moment it starts.

## 6. Multi-Turn Interaction

- **Engine-native first**: Multi-turn context relies on the Coding Agent CLI's native session mechanism (both Cursor and Claude Code support `--resume`)
- **Engines without resume support are treated as single-turn**: Files in the workspace serve as the only cross-turn memory
- **No TTL**: GolemBot does not proactively expire sessions; the engine manages session lifecycle itself
- **Auto-fallback on resume failure**: If the engine's `--resume` fails (engine-side expiration/corruption), a new session is automatically started, transparent to the user
- **Manual reset**: Users can explicitly clear sessions via `/reset` (CLI) or `assistant.resetSession()` (API)
- **Session storage**: `.golem/sessions.json`, stores only `{ engineSessionId }`

## 7. Engine Interface

```typescript
interface AgentEngine {
  invoke(prompt: string, opts: {
    workspace: string;       // Assistant directory path
    skillPaths: string[];    // Absolute paths of skill directories under skills/
    sessionId?: string;
    model?: string;
  }): AsyncIterable<StreamEvent>;
}

type StreamEvent =
  | { type: 'text'; content: string }
  | { type: 'tool_call'; name: string; args: string }
  | { type: 'tool_result'; content: string }
  | { type: 'error'; message: string }
  | { type: 'done'; sessionId?: string; durationMs?: number; costUsd?: number; numTurns?: number };
```

Three engines are implemented, created via the `createEngine(type)` factory function:

**CursorEngine** — Invokes `agent` CLI via child_process.spawn:

```typescript
class CursorEngine implements AgentEngine {
  async *invoke(prompt, opts) {
    // 1. Inject Skills: symlink skillPaths to .cursor/skills/
    // 2. spawn: agent -p <prompt> --output-format stream-json --stream-partial-output ...
    // 3. stripAnsi + parse stream-json line by line → yield StreamEvent
    // 4. segmentAccum deduplication (Cursor's summary events)
  }
}
```

**ClaudeCodeEngine** — Invokes `claude` CLI via child_process.spawn:

```typescript
class ClaudeCodeEngine implements AgentEngine {
  async *invoke(prompt, opts) {
    // 1. Inject Skills: symlink skillPaths to .claude/skills/ + generate CLAUDE.md
    // 2. spawn: claude -p <prompt> --output-format stream-json --verbose --dangerously-skip-permissions ...
    // 3. Parse stream-json line by line → parseClaudeStreamLine() → yield StreamEvent[]
    // 4. No ANSI stripping or deduplication needed
  }
}
```

**OpenCodeEngine** — Invokes `opencode` CLI via child_process.spawn:

```typescript
class OpenCodeEngine implements AgentEngine {
  async *invoke(prompt, opts) {
    // 1. Inject Skills: symlink skillPaths to .opencode/skills/
    // 2. Generate/update opencode.json (permission config + model config)
    // 3. spawn: opencode run "prompt" --format json [--model provider/model] [--session ses_xxx]
    // 4. Parse NDJSON line by line → parseOpenCodeStreamLine() → yield StreamEvent[]
    // 5. Multi-Provider API Key inferred via resolveOpenCodeEnv()
  }
}
```

Key differences between the three engines:

| | CursorEngine | ClaudeCodeEngine | OpenCodeEngine |
|---|---|---|---|
| Spawn method | child_process.spawn | child_process.spawn | child_process.spawn |
| Output format | stream-json (with ANSI) | stream-json (pure JSON) | NDJSON (`--format json`) |
| Skill injection | `.cursor/skills/` symlink | `.claude/skills/` + CLAUDE.md | `.opencode/skills/` + opencode.json |
| Session resume | `--resume <uuid>` | `--resume <uuid>` | `--session <ses_xxx>` |
| API Key | CURSOR_API_KEY | ANTHROPIC_API_KEY | Depends on Provider |
| Permission bypass | `--force --trust --sandbox disabled` | `--dangerously-skip-permissions` | opencode.json permission |

But the externally exposed `StreamEvent` is completely consistent.

## 8. Key Design Decisions

1. **Library-first, CLI is a thin shell**: The core is an importable library (`createAssistant`); the CLI is just one consumer. This makes GolemBot embeddable in any scenario.
2. **Directory is the assistant**: The assistant lives in a directory, and the directory is the single source of truth. Coding Agents naturally work within directories — this is a deliberate difference from OpenClaw (global config).
3. **Directory is the skill list**: Whatever is in `skills/` gets loaded — skills are not declared in a config file, eliminating config-vs-reality mismatches.
4. **Only two concepts**: assistant directory + Skill. No Tools, no Blueprints, no Registry.
5. **Skill is capability**: Knowledge (Markdown) and tools (scripts) both live in the Skill directory, not separated. Coding Agents can natively execute scripts — no framework "registration" needed.
6. **Skill injection is the engine's responsibility**: Each engine decides how to inject Skills (Cursor → `.cursor/skills/` symlink, Claude Code → `.claude/skills/` symlink + `CLAUDE.md`, OpenCode → `.opencode/skills/` symlink + `opencode.json`) — the core layer doesn't care.
7. **Don't do anything the Agent should do**: No context management, no tool scheduling, no decision-making, no session TTL. Everything is delegated to the Coding Agent.
8. **Concurrency safety**: The same assistant instance allows only one `chat()` execution at any given time, preventing multiple requests from simultaneously operating on the workspace.
9. **TypeScript**: Mature channel ecosystem (Telegram/Slack/Discord), and subprocess invocation is language-agnostic.

## 9. Evolution Roadmap

**Phase 1 — CLI Assistant (Current)**

- `golembot init` + `golembot run` two commands
- Cursor Engine (child_process.spawn + Skill injection)
- Skills directory scanning
- Session management (resume + auto-fallback)
- Concurrency lock
- 4 core source files + 1 CLI thin shell

**Phase 2 — Multi-User + HTTP Service (Current)**

- Session routing: `chat(msg, { sessionKey })` supports multi-user isolation
- Concurrency lock isolated by sessionKey: different users can run in parallel
- `server.ts`: built-in HTTP service + SSE streaming response + Bearer token authentication
- `golembot serve` CLI command
- Session storage upgraded to per-key indexed multi-user structure

**Phase 3 — Multi-Engine** ✅

- ~~Claude Code Engine~~ ✅ (`ClaudeCodeEngine`, stream-json parsing, native `.claude/skills/` injection)
- ~~OpenCode Engine~~ ✅ (`OpenCodeEngine`, NDJSON parsing, `.opencode/skills/` injection, multi-Provider API Key, `opencode.json` permission config)
- Codex Engine (to be implemented)

**Phase 4 — Gateway + IM Channels** ✅

- ~~`ChannelAdapter` interface + `ChannelMessage` type~~ ✅
- ~~Feishu adapter (WebSocket long-connection, `@larksuiteoapi/node-sdk`)~~ ✅
- ~~DingTalk adapter (Stream, `dingtalk-stream`)~~ ✅
- ~~WeCom adapter (Webhook, `@wecom/crypto`)~~ ✅
- ~~Gateway long-running service (`golembot gateway`)~~ ✅
- ~~`golem.yaml` extended with `channels` + `gateway` fields~~ ✅
- ~~`${ENV_VAR}` placeholder resolution~~ ✅
- ~~CLI `.env` auto-loading~~ ✅

**Phase 5 — Out-of-the-Box** ✅

- ~~Onboard setup wizard (`golembot onboard`, 7-step interactive)~~ ✅
- ~~Built-in Skills: `general` (enhanced, with persistent memory conventions) + `im-adapter` (IM reply conventions)~~ ✅
- ~~Template system (6 scenario templates: customer-support, data-analyst, code-reviewer, ops-assistant, meeting-notes, research)~~ ✅
- ~~Docker deployment (Dockerfile + docker-compose.yml)~~ ✅
- ~~README.md + LICENSE + CONTRIBUTING.md~~ ✅

**Phase 6 — Ecosystem Expansion (To Be Implemented)**

- Skill repository (`golembot skill search/install`, community skill discovery and installation)
- Codex Engine
- Permissions integration (`golem.yaml` project-level permission config)
- WebSocket support (bidirectional communication)
- Multi-assistant routing (single Gateway serving multiple assistants)
