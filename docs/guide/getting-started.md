# Getting Started

## Prerequisites

- **Node.js** >= 18
- A Coding Agent CLI installed **and authenticated**:
  - [Cursor](https://docs.cursor.com/agent) (`agent` CLI) — run `agent login` or set `CURSOR_API_KEY`
  - [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (`claude` CLI) — run `claude auth login` or set `ANTHROPIC_API_KEY`
  - [OpenCode](https://github.com/opencode-ai/opencode) (`opencode` CLI) — set API key for your provider (e.g. `ANTHROPIC_API_KEY`)
  - [Codex](https://developers.openai.com/codex/cli) (`codex` CLI) — run `codex login` or set `CODEX_API_KEY`

The `golembot onboard` wizard will detect existing authentication and guide you through setup if needed. You can also run `golembot doctor` at any time to verify your configuration.

## Install

```bash
npm install -g golembot
```

Or with pnpm / yarn:

```bash
pnpm add -g golembot
# or
yarn global add golembot
```

## Quick Start

### Option A: Guided Setup (Recommended)

```bash
mkdir my-bot && cd my-bot
golembot onboard
```

The onboard wizard walks you through engine selection, authentication, naming, IM channel setup, and scenario template selection in 8 interactive steps. Use `--template <name>` to skip template selection (e.g., `golembot onboard --template customer-support`).

### Option B: Manual Init

```bash
mkdir my-bot && cd my-bot
golembot init -e claude-code -n my-bot
```

This creates:
- `golem.yaml` — assistant configuration
- `skills/` — skill directory with built-in skills (`general` + `im-adapter`)
- `AGENTS.md` — auto-generated context for the Coding Agent
- `.golem/` — internal state directory (gitignored)

### Start a Conversation

```bash
golembot run
```

This opens an interactive REPL. Type your message and press Enter. The Coding Agent handles everything — reading files, running scripts, multi-step reasoning.

**REPL commands:**
- `/help` — show available commands
- `/status` — show current engine, model, and skills
- `/engine [name]` — show or switch engine
- `/model [list|name]` — show, list available, or switch model
- `/skill` — list installed skills
- `/cron` — manage scheduled tasks (list, run, enable, disable, history)
- `/reset` — clear the current session
- `/quit` or `/exit` — exit

### Start the Gateway Service

```bash
golembot gateway
```

This starts an HTTP API, a web Dashboard (at `http://localhost:3000/`), and any configured IM channel adapters. The Dashboard shows real-time metrics, channel status, and lets you test the API directly from the browser.

<img src="/assets/dashboard.png" alt="GolemBot Dashboard" style="border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,.1);margin:16px 0" />

To view all running bots at a glance:

```bash
golembot fleet ls          # list running bots (CLI)
golembot fleet serve       # start Fleet Dashboard (web, port 4000)
```

<img src="/assets/fleet-dashboard.png" alt="GolemBot Fleet Dashboard" style="border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,.1);margin:16px 0" />

GolemBot supports the following IM platforms out of the box:

| Platform | Connection Mode |
|----------|----------------|
| [Feishu (Lark)](/channels/feishu) | WebSocket (no public IP needed) |
| [DingTalk](/channels/dingtalk) | Stream mode (no public IP needed) |
| [WeCom](/channels/wecom) | Webhook (requires public URL) |
| [Slack](/channels/slack) | Socket Mode (no public IP needed) |
| [Telegram](/channels/telegram) | Polling (no public IP needed) |
| [Discord](/channels/discord) | Gateway API (no public IP needed) |

See [Channels Overview](/channels/overview) for setup instructions.

## Use as a Library

GolemBot's core is an importable TypeScript library:

```typescript
import { createAssistant } from 'golembot';

const assistant = createAssistant({ dir: './my-bot' });

for await (const event of assistant.chat('Analyze the sales data')) {
  if (event.type === 'text') process.stdout.write(event.content);
}
```

This pattern works for embedding into Slack bots, internal tools, SaaS products, or any Node.js application. See the [Embed in Your Product](/guide/embed) guide for Express, Next.js, background job, and Slack examples.

## What's Next

- [Configuration](/guide/configuration) — understand `golem.yaml` and `${ENV_VAR}` placeholders
- [Group Chat](/guide/group-chat) — response policies, @mention, quote reply, group memory
- [Inbox & History Fetch](/guide/inbox) — crash-safe queue, offline message catch-up
- [Engines](/engines/overview) — compare Cursor, Claude Code, OpenCode, and Codex
- [Embed in Your Product](/guide/embed) — library integration patterns (Express, Next.js, queues)
