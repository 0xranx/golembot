# GolemBot — Project Conventions for Claude Code

> This file is the Claude Code equivalent of `.cursor/rules/*.mdc`.
> It is auto-loaded at conversation start and provides project-level constraints.

## Architecture Hard Constraints

When modifying code under `src/`, the following constraints must not be violated.

### Things You Must Never Do

1. **Don't do what the Agent should do** — GolemBot does not manage context window, dispatch tools, reason, or set session TTL. All "intelligent" behavior is delegated to the underlying Coding Agent.
2. **Don't add new core concepts** — The framework has only two concepts: assistant directory + Skill. Do not introduce Tool, Blueprint, Registry, Pipeline, or other abstractions.
3. **Don't put CLI logic in the core library** — `cli.ts` is a thin shell; it only parses arguments and formats output. All business logic must live in `index.ts` / `workspace.ts` / `engine.ts` / `session.ts` / `server.ts`.
4. **Don't declare Skills in config** — The `skills/` directory is the single source of truth. `golem.yaml` only configures engine, name, and infrastructure settings.
5. **Process invocation is engine-owned** — All engines use `child_process.spawn`. Do not assume invocation style outside the engine.

### Interface Change Rules

- Any signature change to the `Assistant` interface (`index.ts`) must be verified across `server.ts`, `gateway.ts`, and `cli.ts`.
- Any change to the `AgentEngine` interface (`engine.ts`) must remain compatible with all engines (Cursor, Claude Code, OpenCode, Codex).
- `StreamEvent` type changes must verify compatibility with `server.ts` SSE output, `cli.ts` event handling, and `gateway.ts` IM message assembly.

### File Responsibility Boundaries

| File | Responsibility | Should Not Contain |
|------|-----------------|--------------------|
| `index.ts` | Public API, concurrency locks, orchestration of workspace/engine/session | Engine implementation details, HTTP logic |
| `engine.ts` | Engine interface, all engine implementations, stream-json parsing, Skill injection | Session management, config loading |
| `workspace.ts` | golem.yaml read/write, skills scanning, AGENTS.md generation | Engine invocation, session management |
| `session.ts` | Session persistence (indexed by sessionKey) | Any other logic |
| `server.ts` | HTTP service, SSE, auth | Engine implementation details |
| `gateway.ts` | HTTP API + IM channel orchestration | Engine implementation details |
| `cli.ts` | Argument parsing, call core API, format output | Business logic |
| `cli-utils.ts` | CLI formatting helpers (tool display, truncation) | Business logic |

### Concurrency Model

- `chat()` calls with the same `sessionKey` must be serialized (KeyedMutex).
- Different `sessionKey`s can run in parallel.
- Do not introduce global locks.

## Testing Conventions

### Feature Changes Must Be Verified

Any substantive change to source files under `src/` must:

1. **Add dedicated tests for the new functionality** — passing existing tests is not enough.
2. Run `pnpm run test` to ensure all unit tests pass.
3. Run `pnpm run build` to ensure TypeScript compiles.

### Unit Tests (vitest)

Location: `src/__tests__/<module>.test.ts`

**Mock Engine Pattern** — Unit tests do not call the real Agent. Replace with a mock engine:

```typescript
async function* mockInvoke(prompt, opts): AsyncIterable<StreamEvent> {
  yield { type: 'text', content: 'mock response' };
  yield { type: 'done', sessionId: 'mock-session-123' };
}
```

Inject via `vi.mock('../engine.js', ...)`, returning mock engine from `createEngine`.

### Running

```bash
pnpm run build        # TypeScript compile
pnpm run test         # Unit tests (vitest)
```

## Engine Implementation Notes

### Claude Code

- Binary: `~/.local/bin/claude`
- Flags: `-p <prompt> --output-format stream-json --verbose --dangerously-skip-permissions`
- `--verbose` is required for intermediate stream events
- Auth: `claude auth login` or `ANTHROPIC_API_KEY` env var

### Cursor

- Binary: `~/.local/bin/agent`
- Flags: `--output-format stream-json --stream-partial-output --force --trust --sandbox disabled --approve-mcps`
- Uses segmentAccum dedup for `--stream-partial-output` summary events

### OpenCode

- Binary: `opencode` (on PATH)
- Flags: `run <prompt> --format json`
- step_finish events are accumulated; single done event emitted on process close

### Codex

- Binary: `codex` (npm: `@openai/codex`)
- Flags: `exec --json --full-auto --skip-git-repo-check [--model X] <prompt>`
- Resume: `exec resume --json --full-auto --skip-git-repo-check [--model X] <thread_id> <prompt>`
- Auth: `CODEX_API_KEY` env var (also sets `OPENAI_API_KEY` for compatibility)
- `--skip-git-repo-check` is required (GolemBot uses temp dirs)
