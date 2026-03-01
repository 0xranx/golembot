[English](README.md) | [中文](README.zh-CN.md)

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/0xranx/golembot/main/docs/assets/logo-golem-light.svg">
    <img src="https://raw.githubusercontent.com/0xranx/golembot/main/docs/assets/logo-golem-dark.svg" alt="GolemBot" width="560">
  </picture>
</p>

<p align="center">
  <a href="https://github.com/0xranx/golembot/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/0xranx/golembot/ci.yml?branch=main&style=for-the-badge" alt="CI"></a>
  <a href="https://www.npmjs.com/package/golembot"><img src="https://img.shields.io/npm/v/golembot.svg?style=for-the-badge" alt="npm version"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge" alt="MIT License"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg?style=for-the-badge" alt="Node.js"></a>
</p>

<p align="center"><strong>Your Coding Agent is trapped in a terminal. GolemBot sets it free.</strong></p>

---

Cursor, Claude Code, OpenCode — these Coding Agents can already write code, run scripts, analyze data, and reason through complex tasks. But they're stuck in an IDE or a terminal window.

**GolemBot gives them a body.** One command connects your Coding Agent to Feishu, DingTalk, WeCom, or any HTTP client. Or embed it into your own product with 5 lines of code. No AI framework, no prompt engineering — the agent you already have *is* the brain.

## Run Your Coding Agent Everywhere

### On IM — your team's 24/7 AI teammate

```bash
golembot init -e claude-code -n my-bot
golembot gateway    # connects to Feishu / DingTalk / WeCom
```

Your colleagues @ the bot in group chat. It can write code, analyze files, answer questions — because behind it is a real Coding Agent, not a thin API wrapper.

### In your product — full agent power, 5 lines of code

```typescript
import { createAssistant } from 'golembot';
const bot = createAssistant({ dir: './my-agent' });

for await (const event of bot.chat('Analyze last month sales data')) {
  if (event.type === 'text') process.stdout.write(event.content);
}
```

Embed into Slack bots, internal tools, SaaS products, customer support — anything that speaks Node.js.

## Why GolemBot, not another AI framework?

| | GolemBot | Traditional AI Frameworks |
|---|---|---|
| **AI brain** | Cursor / Claude Code / OpenCode — battle-tested, full coding ability | You wire up LLM APIs + tools from scratch |
| **Setup** | `golembot init` → done | Chains, RAG, vector DB, prompt tuning... |
| **Auto-upgrade** | Agent gets smarter? Your assistant gets smarter. Zero code changes. | You maintain everything yourself |
| **Transparency** | `ls` the directory = see what the assistant knows and does | Black box pipelines |
| **Engine lock-in** | Change one line in config to swap engines | Rewrite everything |

## Quick Start

```bash
npm install -g golembot

mkdir my-bot && cd my-bot
golembot onboard      # guided setup (recommended)

# Or manually:
golembot init -e claude-code -n my-bot
golembot run          # REPL conversation
golembot gateway      # start IM + HTTP service
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

## Engine Comparison

| | Cursor | Claude Code | OpenCode |
|---|---|---|---|
| Skill Injection | `.cursor/skills/` | `.claude/skills/` + CLAUDE.md | `.opencode/skills/` + opencode.json |
| Session Resume | `--resume` | `--resume` | `--session` |
| API Key | CURSOR_API_KEY | ANTHROPIC_API_KEY | Depends on Provider |

The `StreamEvent` interface is identical across all engines — switching requires zero code changes.

## Configuration

`golem.yaml` — the single config file:

```yaml
name: my-assistant
engine: claude-code

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

Sensitive fields support `${ENV_VAR}` references.

## Skill System

A Skill is a directory containing `SKILL.md` + optional scripts. Drop it in, the assistant gains new abilities. Remove it, the ability is gone.

```
skills/
├── general/          # Built-in: general assistant
│   └── SKILL.md
├── im-adapter/       # Built-in: IM reply conventions
│   └── SKILL.md
└── my-custom-skill/  # Your own
    ├── SKILL.md
    └── analyze.py
```

`ls skills/` is the complete list of what your assistant can do.

## Docker Deployment

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
pnpm run test          # Unit tests (600+)
pnpm run e2e:opencode  # End-to-end tests
```

## License

[MIT](LICENSE)
