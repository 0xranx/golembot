# Phase 3 Feature Plans

See [docs/architecture.md](../architecture.md) Chapter 9 "Evolution Roadmap" for reference.

## Multi-Engine Support

### ~~P1: Claude Code Engine~~ ✅ Completed

- Implemented `ClaudeCodeEngine`, reusing the `AgentEngine` interface
- Uses `child_process.spawn` (no PTY needed), `--output-format stream-json --verbose`
- Skill injection: symlink to `.claude/skills/` (native discovery) + generate `CLAUDE.md`
- `parseClaudeStreamLine()` returns `StreamEvent[]` to handle mixed content blocks
- `StreamEvent.done` extended with `costUsd` and `numTurns` fields
- CLI `init` command supports selecting `claude-code` engine
- Full unit tests (parseClaudeStreamLine, injectClaudeSkills, createEngine factory)
- e2e tests: `examples/e2e-claude-code.ts`

### P2: Codex Engine

- Similar to Claude Code, implement `CodexEngine`
- Requires investigation into the Codex CLI interface

## Skill Ecosystem

### P1: Skill Repository (Discover + Install)

- `golembot skill search <keyword>` — Search community skills
- `golembot skill install <name>` — Install to the current assistant's `skills/` directory
- Repository format design needed (GitHub repo? npm package? Standalone registry?)

### ~~P2: Assistant Templates~~ ✅ Completed

- ~~`golembot init --template <name>` — Create an assistant from a preconfigured template~~
- ~~Template = a directory with pre-installed specific skill combinations + golem.yaml + example data~~
- Implemented 6 scenario templates: customer-support, data-analyst, code-reviewer, ops-assistant, meeting-notes, research
- `golembot onboard` wizard supports template selection
- Templates stored in the `templates/` directory, published with the npm package

## Cloud Agent Integration

### P3: Cloud Agent Support

- Cursor supports `-c` / `--cloud` to push tasks to the cloud
- Suitable for long-running tasks (data processing, large-scale code reviews)
- Requires adding `cloud?: boolean` to `InvokeOpts`, mapped to the `--cloud` parameter
- Requires investigation into whether cloud Agent output format is consistent with local

## `create-chat` Pre-created Sessions

### P3: Deterministic Session IDs

- Cursor supports the `agent create-chat` command to create an empty chat and return an ID
- Could create a session before invoke to obtain a deterministic session ID
- Benefit: avoids the complex logic of parsing result events to extract the session ID
- Needs evaluation on whether the additional CLI call is worthwhile
