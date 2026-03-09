[English](README.md) | [中文](README.zh-CN.md)

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/0xranx/golembot/main/docs/assets/logo-golem-light.svg">
    <img src="https://raw.githubusercontent.com/0xranx/golembot/main/docs/assets/logo-golem-dark.svg" alt="GolemBot" width="560">
  </picture>
</p>

<p align="center">
  <a href="https://0xranx.github.io/golembot/"><img src="https://img.shields.io/badge/docs-0xranx.github.io%2Fgolembot-blue?style=for-the-badge" alt="Documentation"></a>
  <a href="https://github.com/0xranx/golembot/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/0xranx/golembot/ci.yml?branch=main&style=for-the-badge" alt="CI"></a>
  <a href="https://www.npmjs.com/package/golembot"><img src="https://img.shields.io/npm/v/golembot.svg?style=for-the-badge" alt="npm version"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge" alt="MIT License"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg?style=for-the-badge" alt="Node.js"></a>
  <a href="https://discord.gg/tgU5FXChgM"><img src="https://img.shields.io/badge/Discord-Join-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord"></a>
</p>

<p align="center"><strong>Your Coding Agent is trapped in a terminal. GolemBot sets it free.</strong></p>

<p align="center">
  <a href="https://clawhub.ai"><img src="https://raw.githubusercontent.com/0xranx/golembot/main/docs/public/icons/clawhub.png" alt="ClawHub" width="28" valign="middle"></a>
  Compatible with <a href="https://clawhub.ai"><strong>13,000+ OpenClaw community skills</strong></a> — the largest AI agent skill ecosystem. One command to search and install.
</p>

<p align="center">
  📖 <a href="https://0xranx.github.io/golembot/"><strong>Documentation & Guides → 0xranx.github.io/golembot</strong></a>
</p>

<p align="center">
  <video src="https://github.com/user-attachments/assets/7abddbd6-56c8-4ae3-8e5b-72e6f0104257" width="720" autoplay muted loop playsinline>
    <a href="https://github.com/user-attachments/assets/7abddbd6-56c8-4ae3-8e5b-72e6f0104257">Watch the demo</a>
  </video>
</p>
<p align="center"><em>One command to connect your Coding Agent to Telegram & Discord</em></p>

---

Cursor, Claude Code, OpenCode, Codex — these Coding Agents can already write code, run scripts, analyze data, and reason through complex tasks. But they're stuck in an IDE or a terminal window.

**GolemBot gives them a body.** One command connects your Coding Agent to Slack, Telegram, Discord, Feishu, DingTalk, WeCom, or any HTTP client. Write a custom adapter to plug in email, GitHub Issues, or any other message source. Or embed into your own product with 5 lines of code. No AI framework, no prompt engineering — the agent you already have *is* the brain.

## Run Your Coding Agent Everywhere

### On IM — your team's 24/7 AI teammate

```bash
golembot init -e claude-code -n my-bot
golembot gateway    # Slack, Telegram, Discord, Feishu, DingTalk, WeCom
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
| **AI brain** | Cursor / Claude Code / OpenCode / Codex — battle-tested, full coding ability | You wire up LLM APIs + tools from scratch |
| **Setup** | `golembot init` → done | Chains, RAG, vector DB, prompt tuning... |
| **Auto-upgrade** | Agent gets smarter? Your assistant gets smarter. Zero code changes. | You maintain everything yourself |
| **Transparency** | `ls` the directory = see what the assistant knows and does | Black box pipelines |
| **Engine lock-in** | Change one line in config to swap engines | Rewrite everything |
| **Skills** | 13,000+ community skills from ClawHub, one command to install | Write your own tools and prompts from scratch |
| **Scheduled tasks** | Built-in cron scheduler — daily standups, dependency audits, test reports pushed to IM | Build your own job system |
| **Multimodal** | Image messages from IM → saved to disk → agent reads and analyzes. All 6 channels supported. | Parse platform APIs yourself |

## Quick Start

```bash
npm install -g golembot

mkdir my-bot && cd my-bot
golembot onboard      # guided setup (recommended)

# Or manually:
golembot init -e claude-code -n my-bot
golembot run          # REPL conversation
golembot gateway      # start IM + HTTP service + Dashboard
golembot fleet ls     # list all running bots
golembot skill search "data analysis"  # browse 13,000+ ClawHub skills
```

### Dashboard & Fleet

Every `golembot gateway` instance comes with a built-in web Dashboard showing real-time metrics, channel status, and a quick-test console:

<p align="center">
  <img src="https://raw.githubusercontent.com/0xranx/golembot/main/docs/assets/dashboard.png" alt="GolemBot Dashboard" width="720">
</p>

Running multiple bots? `golembot fleet serve` aggregates them into a single Fleet Dashboard:

<p align="center">
  <img src="https://raw.githubusercontent.com/0xranx/golembot/main/docs/assets/fleet-dashboard.png" alt="GolemBot Fleet Dashboard" width="720">
</p>

## Architecture

```
Slack / Telegram / Discord / Feishu / DingTalk / WeCom / HTTP API
    Custom Adapters (email, GitHub Issues, ...)
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
          ┌───────┬───────┬───────┐
          ▼       ▼       ▼       ▼
       Cursor  Claude  OpenCode  Codex
               Code
```

## Engine Comparison

| | Cursor | Claude Code | OpenCode | Codex |
|---|---|---|---|---|
| Skill Injection | `.cursor/skills/` | `.claude/skills/` + CLAUDE.md | `.opencode/skills/` + opencode.json | `AGENTS.md` at workspace root |
| Session Resume | `--resume` | `--resume` | `--session` | `exec resume <thread_id>` |
| API Key | CURSOR_API_KEY | ANTHROPIC_API_KEY | Depends on Provider | OPENAI_API_KEY or ChatGPT OAuth |

The `StreamEvent` interface is identical across all engines — switching requires zero code changes.

## Configuration

`golem.yaml` — the single config file:

```yaml
name: my-assistant
engine: claude-code

channels:
  slack:
    botToken: ${SLACK_BOT_TOKEN}
    appToken: ${SLACK_APP_TOKEN}
  telegram:
    botToken: ${TELEGRAM_BOT_TOKEN}
  discord:
    botToken: ${DISCORD_BOT_TOKEN}
    botName: my-assistant        # optional — normalizes @mention tokens in channel messages
  feishu:
    appId: ${FEISHU_APP_ID}
    appSecret: ${FEISHU_APP_SECRET}
  # Custom adapter — local file or npm package
  my-email:
    _adapter: ./adapters/email-adapter.js
    token: ${EMAIL_TOKEN}

gateway:
  port: 3000
  token: ${GOLEM_TOKEN}
```

Sensitive fields support `${ENV_VAR}` references. Custom channel adapters can be local `.js`/`.mjs` files or npm packages — [see the adapter guide](https://0xranx.github.io/golembot/api/channel-adapter).

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

## 13,000+ Skills from ClawHub

GolemBot is fully compatible with [ClawHub](https://clawhub.ai) — the largest AI agent skill marketplace by OpenClaw. The `SKILL.md` format is 100% compatible, so all 13,000+ community skills work out of the box.

```bash
golembot skill search "data analysis"       # discover skills
golembot skill add clawhub:data-analysis    # one command to install
```

**Agent-powered skill discovery:** Your agent can search and install skills autonomously during conversations. Ask it "find me a good code review skill" — it searches ClawHub, shows results, and installs on your confirmation.

All skill commands support `--json` for programmatic access. The pluggable registry interface supports additional skill sources beyond ClawHub.

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
pnpm run test          # Unit tests (1252+)
pnpm run e2e:opencode  # End-to-end tests (OpenCode)
pnpm run e2e:codex     # End-to-end tests (Codex)
```

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[MIT](LICENSE)
