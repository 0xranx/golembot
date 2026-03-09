# CLI Commands

GolemBot provides a set of CLI commands for managing and running your assistant.

## `golembot init`

Initialize a new assistant directory.

```bash
golembot init [-e <engine>] [-n <name>]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-e, --engine <engine>` | Engine type (`cursor`, `claude-code`, `opencode`, `codex`) | `cursor` |
| `-n, --name <name>` | Assistant name | Interactive prompt |

Creates `golem.yaml`, `skills/` (with built-in skills), `AGENTS.md`, `.golem/`, and `.gitignore`.

## `golembot run`

Start an interactive REPL conversation.

```bash
golembot run [-d <dir>] [--api-key <key>]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-d, --dir <dir>` | Assistant directory | `.` |
| `--api-key <key>` | Agent API key | From env |

**REPL slash commands:**

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/status` | Show current engine, model, and skills |
| `/engine [name]` | Show or switch engine |
| `/model [list\|name]` | Show, list available, or switch model |
| `/skill` | List installed skills |
| `/cron list` | List all scheduled tasks and their status |
| `/cron run <id>` | Trigger a scheduled task immediately |
| `/cron enable <id>` | Enable a scheduled task |
| `/cron disable <id>` | Disable a scheduled task |
| `/cron del <id>` | Delete a scheduled task |
| `/cron history <id>` | Show recent execution history for a task |
| `/reset` | Clear current session |
| `/quit`, `/exit` | Exit the REPL |

These slash commands also work in IM channels (Feishu, Telegram, Slack, etc.) and via the HTTP API (`POST /chat` with a slash command as the message returns a JSON response instead of an SSE stream).

Supports multi-line input with `"""` delimiters. Displays duration and cost (when available) on completion.

## `golembot serve`

Start the HTTP SSE server.

```bash
golembot serve [-d <dir>] [-p <port>] [-t <token>] [--host <host>] [--api-key <key>]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-d, --dir <dir>` | Assistant directory | `.` |
| `-p, --port <port>` | HTTP port | `3000` |
| `-t, --token <token>` | Bearer auth token | `GOLEM_TOKEN` env |
| `--host <host>` | Bind address | `127.0.0.1` |
| `--api-key <key>` | Agent API key | From env |

See [HTTP API](/api/http-api) for endpoint details.

## `golembot gateway`

Start the IM + HTTP unified gateway service.

```bash
golembot gateway [-d <dir>] [-p <port>] [-t <token>] [--host <host>] [--api-key <key>] [--verbose]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-d, --dir <dir>` | Assistant directory | `.` |
| `-p, --port <port>` | HTTP port | `3000` |
| `-t, --token <token>` | Bearer auth token | `GOLEM_TOKEN` env |
| `--host <host>` | Bind address | `127.0.0.1` |
| `--api-key <key>` | Agent API key | From env |
| `--verbose` | Enable channel log output | `false` |

Reads `channels` config from `golem.yaml` and starts the corresponding IM adapters alongside the HTTP service.

The gateway also:
- Serves a **web Dashboard** at `GET /` with real-time metrics, channel status, and a Quick Test panel.
- Auto-registers with the **Fleet directory** (`~/.golembot/fleet/`) so `golembot fleet ls` can discover it.

## `golembot fleet`

Manage and view all running GolemBot instances.

### `golembot fleet ls`

List all running bot instances discovered from `~/.golembot/fleet/`.

```bash
golembot fleet ls [--json]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--json` | Output JSON with full instance details and metrics | `false` |

Each gateway automatically registers itself on startup and unregisters on shutdown. Stale entries (crashed processes) are cleaned up automatically via PID liveness checks.

**Example output:**

```
  Running GolemBot Instances (2)

  ●  alpha-bot (claude-code) claude-opus-4-6
     Port 3000 · PID 12345 · 42 msgs

  ●  beta-bot (cursor) claude-4.6-sonnet
     Port 3001 · PID 12346 · 7 msgs
```

When there are stopped bots (stopped via `fleet stop`), they also appear:

```
  Stopped Instances (1)

  ○  beta-bot (cursor)
     Port 3001 · /path/to/beta-bot
```

### `golembot fleet stop`

Stop a running bot instance by sending SIGTERM. The bot is saved as a stopped entry and can be restarted with `fleet start`.

```bash
golembot fleet stop <name> [--json]
```

| Option | Description | Default |
|--------|-------------|---------|
| `<name>` | Bot name (as shown in `fleet ls`) | — |
| `--json` | Output JSON (agent-friendly) | `false` |

### `golembot fleet start`

Restart a previously stopped bot instance. The bot is respawned in its original directory on the same port.

```bash
golembot fleet start <name> [--json]
```

| Option | Description | Default |
|--------|-------------|---------|
| `<name>` | Bot name (as shown in `fleet ls` stopped section) | — |
| `--json` | Output JSON (agent-friendly) | `false` |

### `golembot fleet serve`

Start the Fleet Dashboard web server — an aggregate view of all running bots.

```bash
golembot fleet serve [-p <port>] [--host <host>]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-p, --port <port>` | HTTP port | `4000` |
| `--host <host>` | Bind address | `127.0.0.1` |

**Fleet Dashboard features:**
- Auto-discovers all running bots from `~/.golembot/fleet/`
- Shows engine, model, uptime, message count, and cost per bot
- Stop/Start buttons on each bot card
- Stopped bots shown with dashed border and Start button
- Links to each bot's individual Dashboard
- Auto-refreshes every 10 seconds
- Empty state guidance when no bots are running

**Fleet API endpoints:**

| Endpoint | Description |
|----------|-------------|
| `GET /` | Fleet Dashboard HTML |
| `GET /api/fleet` | JSON: running instances + stopped instances + metrics |
| `POST /api/fleet/:name/stop` | Stop a running bot (sends SIGTERM) |
| `POST /api/fleet/:name/start` | Restart a previously stopped bot |
| `GET /health` | `{ "status": "ok" }` |

## `golembot onboard`

Run the interactive setup wizard.

```bash
golembot onboard [-d <dir>] [--template <name>]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-d, --dir <dir>` | Working directory | `.` |
| `--template <name>` | Scenario template to use | Interactive prompt |

See [Onboard Wizard](/guide/onboard-wizard) for the full walkthrough.

## `golembot status`

Display the current assistant configuration.

```bash
golembot status [-d <dir>] [--json]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-d, --dir <dir>` | Assistant directory | `.` |
| `--json` | Output JSON (agent-friendly) | `false` |

Shows: name, engine, model, installed skills, configured channels, and gateway settings.

**JSON output example:**

```json
{
  "name": "my-bot",
  "engine": "claude-code",
  "model": "claude-opus-4-6",
  "skills": [{ "name": "general", "description": "General assistant" }],
  "channels": ["telegram"],
  "gateway": { "port": 3000, "authEnabled": false },
  "directory": "/home/user/my-bot"
}
```

## `golembot skill`

Manage skills in the assistant directory.

### `golembot skill list`

```bash
golembot skill list [-d <dir>]
```

Lists all installed skills with their descriptions.

### `golembot skill add <source>`

```bash
golembot skill add <source> [-d <dir>]
```

Copies a skill directory from `<source>` into the assistant's `skills/` folder. The source must contain a `SKILL.md` file.

### `golembot skill remove <name>`

```bash
golembot skill remove <name> [-d <dir>]
```

Removes a skill by its directory name.

## `golembot doctor`

Run prerequisite checks.

```bash
golembot doctor [-d <dir>]
```

Checks:
- Node.js version (>= 18)
- `golem.yaml` exists and is valid
- Engine CLI binary is on PATH
- API key environment variable is set
- Skills directory contains valid skills

## Environment Variables

| Variable | Used By | Description |
|----------|---------|-------------|
| `CURSOR_API_KEY` | Cursor engine | Cursor API key |
| `ANTHROPIC_API_KEY` | Claude Code engine | Anthropic API key |
| `OPENAI_API_KEY` | OpenCode engine | OpenAI API key |
| `OPENROUTER_API_KEY` | OpenCode engine | OpenRouter API key |
| `GOLEM_TOKEN` | serve / gateway | HTTP bearer auth token |
| `GOLEM_PORT` | serve / gateway | HTTP port override |

The CLI auto-loads a `.env` file from the working directory at startup.
