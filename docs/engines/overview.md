# Engine Overview

GolemBot supports five Coding Agent engines. All of them expose the same `StreamEvent` interface — switching engines requires only a one-line config change.

## Comparison

| | Cursor | Claude Code | OpenCode | Codex | Grok Build |
|---|---|---|---|---|---|
| Binary | `agent` | `claude` | `opencode` | `codex` | `grok` |
| Output format | stream-json | stream-json | NDJSON | NDJSON | streaming-json |
| Skill injection | `.cursor/skills/` | `.claude/skills/` + `CLAUDE.md` | `.opencode/skills/` + `opencode.json` | `AGENTS.md` | `.grok/skills/` + `AGENTS.md` |
| Session resume | `--resume <id>` | `--resume <id>` | `--session <id>` | `resume <thread_id>` | `--resume <id>` |
| API key env | `CURSOR_API_KEY` | `ANTHROPIC_API_KEY` | Depends on provider | `CODEX_API_KEY` | `XAI_API_KEY` |
| Permission bypass | `--force --trust --sandbox disabled` | `--dangerously-skip-permissions` | `opencode.json` permission config | default `unrestricted`; `safe` uses `--full-auto` | `--always-approve` |
| Cost tracking | — | `costUsd`, `numTurns` | `costUsd` (accumulated) | — | — |

## Unified StreamEvent

Regardless of engine, `assistant.chat()` yields the same event types:

```typescript
type StreamEvent =
  | { type: 'text'; content: string }
  | { type: 'tool_call'; name: string; args: string }
  | { type: 'tool_result'; content: string }
  | { type: 'warning'; message: string }
  | { type: 'error'; message: string }
  | { type: 'done'; sessionId?: string; durationMs?: number;
      costUsd?: number; numTurns?: number };
```

See [StreamEvent](/api/stream-events) for detailed documentation of each type.

## How Engines Work

All engines follow the same pattern:

1. **Inject skills** — symlink skill directories into the engine's expected location
2. **Spawn process** — `child_process.spawn` the engine CLI with the user's message
3. **Parse output** — read stdout line by line, convert to `StreamEvent`
4. **Session management** — pass `--resume` / `--session` flags for multi-turn conversations

The engine is selected by the `engine` field in `golem.yaml`:

```yaml
engine: claude-code   # cursor | claude-code | opencode | codex | grok
```

Or overridden at runtime:

```typescript
const assistant = createAssistant({
  dir: './my-bot',
  engine: 'opencode',  // overrides golem.yaml
});
```

::: info One-line switch
Switching engines requires only changing the `engine` field in `golem.yaml`. All engines expose the same `StreamEvent` interface — your code doesn't need to change.
:::

## Choosing an Engine

::: tip Not sure which engine to use?
Start with **Claude Code** — it has the best overall experience, provides cost tracking, and works with Anthropic's latest models. You can switch anytime.
:::

- **Cursor** — best if you already use Cursor IDE and have a Cursor subscription
- **Claude Code** — first-party Anthropic CLI, provides cost and turn tracking
- **OpenCode** — open-source, supports multiple LLM providers (Anthropic, OpenAI, OpenRouter, etc.)
- **Codex** — OpenAI's CLI agent (`@openai/codex`), uses `CODEX_API_KEY`, defaults to `codex.mode: unrestricted`
- **Grok Build** — xAI `grok` CLI, uses `XAI_API_KEY` or `grok login`

## What's Next

- [Cursor](/engines/cursor) — setup, auth, model table
- [Claude Code](/engines/claude-code) — setup, auth, cost tracking
- [OpenCode](/engines/opencode) — setup, multi-provider configuration
- [Codex](/engines/codex) — setup, API key modes
- [Grok Build](/engines/grok) — setup, auth, headless streaming
- [Configuration](/guide/configuration) — full `golem.yaml` reference
