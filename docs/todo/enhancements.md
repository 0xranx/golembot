# Enhancements to Existing Features

## Engine Layer

### ~~P1: API Key Pass-Through~~ ✅ Completed

- ~~Support for `CURSOR_API_KEY` environment variable and `--api-key` parameter pass-through~~
- ~~Enables CI/CD headless environments without requiring `agent login` in advance~~
- Full chain: `CreateAssistantOpts.apiKey → InvokeOpts.apiKey → CursorEngine (--api-key + env) / ClaudeCodeEngine (env ANTHROPIC_API_KEY)`
- CLI: `golembot run --api-key xxx` / `golembot serve --api-key xxx`
- e2e verification: `examples/e2e-headless.ts` 28/28 all passed (Cursor), `examples/e2e-claude-code.ts` 15/16 passed (Claude Code)

### ~~P2: Expose Conversation Duration~~ ✅ Completed

- ~~Extract `duration_ms` from result events and include in `done` StreamEvent~~
- `done` event type: `{ type: 'done'; sessionId?: string; durationMs?: number; costUsd?: number; numTurns?: number }`
- `costUsd` and `numTurns` are provided by the Claude Code engine; they are undefined for the Cursor engine
- CLI `run` mode displays duration in gray text
- e2e verification: `collectChat()` returns `durationMs`, assertion `durationMs >= 0`

### ~~P2: Permissions Integration~~ ✅ Completed

- ~~Allow project-level permissions configuration via `golem.yaml`~~
- ~~Automatically generate `.cursor/cli.json` during `init`~~
- ~~Valuable for CI/CD security scenarios (restricting bot's file write scope, command execution scope)~~
- `PermissionsConfig` type added to `golem.yaml`; `initWorkspace` generates `.cursor/cli.json`; CursorEngine conditionally omits `--trust` when permissions are set

### P3: `/compress` Long Conversation Compression

- Cursor supports the `/compress` command to compress conversation history and free up the context window
- Could automatically inject `/compress` when detecting an overly long session
- Requires investigation into how to trigger this via `-p` mode

## Server Layer

### P2: WebSocket Support

- Current HTTP service only supports SSE (unidirectional streaming)
- WebSocket would enable bidirectional communication (suitable for scenarios requiring mid-stream cancellation or follow-up instructions)

### P2: Multi-Assistant Routing

- A single HTTP service serving multiple assistant directories
- Add an `assistant` field to `POST /chat` to specify the directory
- Suitable for platform-level deployments

### P3: Rate Limiting

- Add request rate limiting to the HTTP service
- Prevent excessive Agent resource consumption from a single user or malicious requests

## CLI Layer

### ~~P2: `golembot status`~~ ✅ Completed

- ~~Display current assistant status: name, engine, installed skill list, active session count~~
- ~~Quickly understand the state of an assistant directory~~
- CLI `golembot status` shows name, engine, model, skills, session count, channels, gateway, and directory; supports `--json` for machine-readable output

### P3: `golembot log`

- View historical conversation logs
- Implement using Cursor's `agent ls` + session files

## Testing

### P2: e2e Stability

- Current e2e tests rely on natural language output assertions from the Agent, which are non-deterministic
- Results vary between 43/44 or 44/44 per run, with different assertions failing each time (sometimes Pipeline reports, sometimes IM return-policy keywords)
- Could introduce retry mechanisms or more lenient matching strategies
- In Pipeline scenarios, the Agent may not write files (outputting directly in the reply instead) — fallback assertions already exist
- IM return policy assertion: checks for "7"/"七"/"退" — Agent doesn't always use these words; should add more keywords or relax the criteria

### P2: CI Integration

- Configure e2e tests in GitHub Actions
- Cursor e2e requires `CURSOR_API_KEY` secret
- Claude Code e2e requires `ANTHROPIC_API_KEY` secret
- OpenCode e2e requires `OPENROUTER_API_KEY` (or other Provider Key) secret
- Reference Cursor's official GitHub Actions docs + Claude Code CI/CD docs + OpenCode GitHub Actions docs

### ~~P2: .env Management Enhancement~~ ✅ Completed

- ~~Previously, `.env` loading was a simple parser implemented by e2e scripts~~
- CLI entry point (`cli.ts`) now automatically loads `.env`, covering all commands (run, serve, gateway, onboard)
- Zero-dependency implementation, does not override existing environment variables
- Works in conjunction with `resolveEnvPlaceholders()` to parse `${ENV_VAR}` placeholders in golem.yaml
