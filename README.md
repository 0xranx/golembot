# GolemBot — Local-First AI Assistant Platform

> **Coding Agent = the soul, GolemBot = the body of clay.**
>
> Use the Coding Agents you already have (Cursor / Claude Code / OpenCode) as the brain — so they can do more than just chat, they can actually get things done.

GolemBot is a TypeScript library + CLI that wraps Coding Agent CLIs into a unified AI assistant engine. One command spins up an intelligent assistant connected to Feishu, DingTalk, or WeCom — running locally, fully transparent, and engine-swappable.

## Features

- **Three Engines** — Cursor / Claude Code / OpenCode, switch with a single config line
- **Built-in IM Channels** — Native adapters for Feishu, DingTalk, and WeCom, no code required
- **Library First** — `createAssistant()` API embeds into any Node.js project
- **Directory = Assistant** — `ls` the directory to see what the assistant knows, what it can do, and what it has done
- **Skill = Capability** — Drop Markdown + scripts into the `skills/` directory, and the assistant gains new abilities automatically
- **Multi-User Isolation** — Routes by sessionKey, each user gets an independent session
- **HTTP Service** — Built-in SSE streaming API with Bearer token auth
- **Docker Deployment** — One-click deploy to the cloud

## Quick Start

```bash
# Install
npm install -g golembot

# Guided setup (recommended)
mkdir my-assistant && cd my-assistant
golembot onboard

# Or initialize manually
golembot init

# Start the gateway (IM channels + HTTP service)
golembot gateway
```

Try it in 30 seconds:

```bash
mkdir my-bot && cd my-bot
golembot init -e claude-code -n my-bot
golembot run
# > Write a Python script to calculate file sizes in the current directory
```

## Architecture

```
Feishu / DingTalk / WeCom / HTTP API
         │
         ▼
┌─────────────────────────┐
│     Gateway Service     │
│  (Channel adapters +    │
│   HTTP service)         │
└────────────┬────────────┘
             │
     createAssistant()
             │
     ┌───────┼───────┐
     ▼       ▼       ▼
  Cursor  Claude   OpenCode
          Code
```

Core design: The Gateway is a long-running service that reuses the `createAssistant()` library API internally, with an IM channel adapter layer on top.

## Engine Comparison

| | Cursor | Claude Code | OpenCode |
|---|---|---|---|
| Spawn Method | child_process.spawn | child_process.spawn | child_process.spawn |
| Skill Injection | `.cursor/skills/` | `.claude/skills/` + CLAUDE.md | `.opencode/skills/` + opencode.json |
| Session Resume | `--resume` | `--resume` | `--session` |
| API Key | CURSOR_API_KEY | ANTHROPIC_API_KEY | Depends on Provider |

The exposed `StreamEvent` interface is identical across engines — switching engines requires zero changes to your application code.

## Usage

### Option 1: CLI (fastest way to get started)

```bash
golembot init         # Initialize an assistant
golembot run          # REPL conversation
golembot gateway      # Start IM + HTTP service
golembot onboard      # Guided setup
```

### Option 2: Library Import

```typescript
import { createAssistant } from 'golembot';

const assistant = createAssistant({ dir: './my-agent' });

for await (const event of assistant.chat('Analyze the competitor data')) {
  if (event.type === 'text') process.stdout.write(event.content);
}
```

### Option 3: Embed Anywhere

```typescript
import { createAssistant } from 'golembot';
const bot = createAssistant({ dir: './slack-bot' });

slackApp.message(async ({ message, say }) => {
  let reply = '';
  for await (const event of bot.chat(message.text, {
    sessionKey: `slack:${message.user}`,
  })) {
    if (event.type === 'text') reply += event.content;
  }
  await say(reply);
});
```

## Configuration

`golem.yaml` — the single config file for an assistant:

```yaml
name: my-assistant
engine: claude-code
model: openrouter/anthropic/claude-sonnet-4

channels:
  feishu:
    appId: ${FEISHU_APP_ID}
    appSecret: ${FEISHU_APP_SECRET}
  dingtalk:
    clientId: ${DINGTALK_CLIENT_ID}
    clientSecret: ${DINGTALK_CLIENT_SECRET}

gateway:
  port: 3000
  token: ${GOLEM_TOKEN}
```

Sensitive fields support `${ENV_VAR}` references to environment variables.

## Skill System

A Skill is the unit of assistant capability — a directory containing `SKILL.md` (knowledge and instructions) and optional supporting files (scripts, templates, etc.).

```
skills/
├── general/          # General assistant (built-in)
│   └── SKILL.md
├── im-adapter/       # IM reply conventions (built-in)
│   └── SKILL.md
└── my-custom-skill/  # Your own Skill
    ├── SKILL.md
    └── analyze.py
```

Want to add a capability? Drop a folder into `skills/`. Want to remove one? Delete the folder. `ls skills/` is the complete list of what the assistant can do.

## Docker Deployment

```bash
# In the assistant directory
docker compose up -d
```

Or use a Dockerfile:

```dockerfile
FROM node:22-slim
RUN npm install -g golembot
WORKDIR /assistant
COPY . .
EXPOSE 3000
CMD ["golembot", "gateway"]
```

## Development

```bash
git clone https://github.com/0xranx/golembot.git
cd golembot
pnpm install
pnpm run build
pnpm run test          # Unit tests
pnpm run e2e:opencode  # End-to-end tests (requires API Key)
```

## License

[MIT](LICENSE)
