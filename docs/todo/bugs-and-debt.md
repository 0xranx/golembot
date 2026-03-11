# Known Bugs and Technical Debt

## ~~Fixed~~

### ~~stream-json Parsing Issues~~

- ~~**P0** `--stream-partial-output` not enabled → pseudo-streaming~~ → Fixed: added `--stream-partial-output` parameter
- ~~**P0** tool_call started/completed not differentiated → same tool call yielded twice~~ → Fixed: completed now yields as `tool_result`
- ~~**P0** `tool_call.function` alternative format not handled~~ → Fixed: now supports both `*ToolCall` and `function` structures
- ~~**P1** `--approve-mcps` not included → headless mode hangs when MCP config exists~~ → Fixed
- ~~**P1** `CURSOR_API_KEY` not passed through~~ → Fixed: `InvokeOpts.apiKey` + `CreateAssistantOpts.apiKey` + CLI `--api-key` + CursorEngine passes both `--api-key` parameter and environment variable; ClaudeCodeEngine passes via `env.ANTHROPIC_API_KEY`
- ~~**P1** StreamEvent `done` missing `durationMs`~~ → Fixed: extracted from `duration_ms` in result events; Claude Code additionally provides `costUsd` (`total_cost_usd`) and `numTurns` (`num_turns`)
- ~~**P0** `--stream-partial-output` summary duplication~~ → Fixed: CursorEngine layer accumulates text and compares to deduplicate

### ~~P2: `result.result` Field Not Exposed~~ ✅ Completed

- ~~**File**: `src/engine.ts` parseStreamLine~~
- ~~**Current state**: Successful result events have a `result` field (concatenation of all assistant text), but GolemBot only extracts `session_id`~~
- ~~**Impact**: If callers need the final complete reply text (without concatenating text deltas themselves), it's currently not possible~~
- ~~**Proposal**: Add `fullText?: string` to the `done` event~~
- Added `fullText?: string` to the `done` StreamEvent type; Cursor and Claude Code engines now extract `obj.result` into `fullText` on non-error result events

### P2: `user` Event Type Ignored

- **File**: `src/engine.ts` parseStreamLine
- **Current state**: stream-json outputs `type: "user"` events (echoing user input), which are currently silently ignored
- **Impact**: No functional impact, but documented here to avoid future confusion
- **Proposal**: Keep ignoring — no action needed

### ~~P2: Permissions Not Utilized~~ ✅ Completed

- ~~**File**: N/A~~
- ~~**Current state**: Cursor supports project-level permissions via `.cursor/cli.json` (Shell/Read/Write/WebFetch/Mcp), but GolemBot does not leverage this~~
- ~~**Impact**: Cannot provide fine-grained control for security-sensitive scenarios (e.g., a CI/CD bot that should not have write permissions)~~
- ~~**Proposal**: Add optional permissions config in `golem.yaml`, generate `.cursor/cli.json` during `init`~~
- Added `PermissionsConfig` to `golem.yaml` (allowedPaths/deniedPaths/allowedCommands/deniedCommands); `initWorkspace` generates `.cursor/cli.json`; CursorEngine skips `--trust` when permissions are configured
