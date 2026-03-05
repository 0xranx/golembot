# Memory

GolemBot has two layers of memory — both survive engine switches, session expiry, and process restarts:

1. **Conversation History** — the framework automatically records every message to disk
2. **Persistent Memory** — the agent maintains structured notes across sessions

No configuration is needed. Both layers work out of the box.

## How It Works

| | Conversation History | Persistent Memory |
|---|---|---|
| **What** | Raw conversation turns (user + assistant) | Preferences, decisions, to-dos, project context |
| **Managed by** | Framework (automatic) | Agent (convention-based) |
| **Location** | `.golem/history/{sessionKey}.jsonl` | `notes.md` (DM) / `memory/groups/*.md` (group) |
| **Format** | JSONL (one JSON object per line) | Markdown |
| **Survives engine switch?** | Yes | Yes |
| **Gitignored?** | Yes (`.golem/` is gitignored) | No (you can version-control it) |

## Conversation History

GolemBot records every conversation turn to per-session [JSONL](https://jsonlines.org/) files under `.golem/history/`:

```
.golem/history/{sessionKey}.jsonl
```

Each line is a JSON object:

```jsonl
{"ts":"2026-03-05T10:00:00.000Z","sessionKey":"default","role":"user","content":"What's on my to-do list?"}
{"ts":"2026-03-05T10:00:03.500Z","sessionKey":"default","role":"assistant","content":"Here are your current to-do items...","durationMs":3500,"costUsd":0.02}
```

Fields: `ts` (ISO timestamp), `sessionKey`, `role` (`user` | `assistant`), `content`, and optional `durationMs` / `costUsd`.

### Automatic Context Recovery

When a session is lost — whether from switching engines, session expiry, or a resume failure — GolemBot detects that no active session exists and instructs the agent to read the history file before responding. The agent restores context from the conversation log, so users don't need to repeat themselves.

::: tip Switch engines without losing context
This is one of GolemBot's key advantages. If you switch from Cursor to Claude Code (or any other engine), the conversation history stays on disk. The new engine session picks up where the old one left off by reading the history file.
:::

## Personal Memory

The built-in `general` skill establishes a `notes.md` convention for long-term memory in DM (direct message) conversations.

### When the agent reads `notes.md`

- At the start of each conversation (if the file exists)
- When the user asks "Do you remember...?" or references past context

### When the agent writes to `notes.md`

- User explicitly asks to remember something ("Remember that I prefer...")
- User shares important preferences, dates, or project context
- After completing a task — records key conclusions and decisions
- User assigns to-do items

### Format

```markdown
## Preferences
- [2026-03-01] User prefers concise responses
- [2026-03-01] Common stack: TypeScript, React, Node.js

## Project Info
- [2026-03-01] Current project: GolemBot, an AI assistant platform

## To-Do
- [ ] Complete the data analysis report
- [x] Deploy the test environment
```

Entries are organized by topic and tagged with `[YYYY-MM-DD]` dates. To-do items use Markdown checkboxes.

::: info Convention, not enforcement
`notes.md` is a convention defined in the `general` skill's prompt — the agent decides what to write. You can also manually edit `notes.md` to "teach" the agent specific facts or preferences.
:::

## Group Memory

In group chats, the agent maintains per-group memory files at:

```
memory/groups/<group-key>.md
```

The group key is derived from the channel type and chat ID (e.g., `slack-C123`, `telegram--100456`). GolemBot creates the `memory/groups/` directory automatically.

### File structure

```markdown
# Group: slack-C123

## Members
- Alice: frontend lead
- Bob: backend engineer

## Project Context
- Building a dashboard for monitoring API latency
- Using React + Go stack

## Decisions
- [2026-03-01] Chose Prometheus over Datadog for cost reasons
- [2026-03-03] Sprint deadline moved to March 15
```

### Smart mode vs mention-only

The `groupPolicy` setting in [`groupChat` configuration](/guide/configuration#groupchat) affects how group memory accumulates:

| Policy | Agent runs on | Memory updates |
|--------|--------------|----------------|
| `smart` | Every message (even when staying silent) | Continuous — agent observes all messages and updates memory in real time |
| `mention-only` | Only when @mentioned | Intermittent — memory only updates when the bot is invoked |
| `always` | Every message | Continuous |

In `smart` mode, the agent processes every group message — even when it outputs `[PASS]` to stay silent. This means group memory stays up to date with the full conversation context.

## File Layout

Here's where all memory-related files live in an assistant directory:

```
my-assistant/
├── notes.md                              ← personal memory (DM)
├── memory/
│   └── groups/
│       ├── slack-C123.md                 ← group memory
│       └── telegram--100456.md           ← group memory
├── .golem/                               ← gitignored
│   ├── sessions.json                     ← active engine session IDs
│   └── history/
│       ├── default.jsonl                 ← DM conversation history
│       ├── slack-C123.jsonl              ← group conversation history
│       └── slack-C123-U456.jsonl         ← per-user DM history
└── skills/
    └── general/SKILL.md                  ← defines notes.md convention
```

## Tips

- **`.golem/` is gitignored** — conversation history files won't be committed. `notes.md` and `memory/` are *not* gitignored, so you can version-control the agent's persistent memory if you choose.
- **Edit `notes.md` directly** — you can add entries manually to pre-load the agent with specific knowledge or preferences.
- **Query history with `jq`** — since history files are standard JSONL, you can use tools like `jq` to query them:
  ```bash
  # Show all user messages from a session
  cat .golem/history/default.jsonl | jq -r 'select(.role=="user") | .content'
  ```
- **History files grow indefinitely** — there's no automatic rotation. For long-running assistants, you may want to periodically archive old history files.
