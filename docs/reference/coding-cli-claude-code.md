# Claude Code CLI

### Official Documentation

**Core docs:**

- Overview: https://code.claude.com/docs/en/overview
- CLI Reference (complete command + parameter list): https://code.claude.com/docs/en/cli-reference
- How Claude Code Works (architecture + tools): https://code.claude.com/docs/en/how-claude-code-works
- Run Programmatically / Headless: https://code.claude.com/docs/en/headless
- Memory & CLAUDE.md: https://code.claude.com/docs/en/memory
- Skills: https://code.claude.com/docs/en/skills
- Authentication: https://code.claude.com/docs/en/authentication
- Permissions: https://code.claude.com/docs/en/permissions
- Settings: https://code.claude.com/docs/en/settings
- Model Configuration: https://code.claude.com/docs/en/model-config

**Extended capabilities:**

- MCP (Model Context Protocol): https://code.claude.com/docs/en/mcp
- Subagents: https://code.claude.com/docs/en/sub-agents
- Hooks: https://code.claude.com/docs/en/hooks-guide
- Plugins: https://code.claude.com/docs/en/plugins

**Deployment & CI/CD:**

- GitHub Actions: https://code.claude.com/docs/en/github-actions
- GitLab CI/CD: https://code.claude.com/docs/en/gitlab-ci-cd
- Costs: https://code.claude.com/docs/en/costs

**Agent SDK (TypeScript / Python):**

- SDK Overview: https://platform.claude.com/docs/en/agent-sdk/overview
- Streaming Output: https://platform.claude.com/docs/en/agent-sdk/streaming-output
- Sessions: https://platform.claude.com/docs/en/agent-sdk/sessions

**stream-json event format cheatsheet:**

- Third-party summary: https://takopi.dev/reference/runners/claude/stream-json-cheatsheet/

**Full documentation index (LLM-friendly):**

- https://code.claude.com/docs/llms.txt

---

### Installation

**Prerequisites**: Node.js >= 18

```bash
npm install -g @anthropic-ai/claude-code
```

**Verify installation:**

```bash
claude --version
```

---

### Actual Invocation Method (Verified in GolemBot)

**Binary path**: `~/.local/bin/claude` (same directory as Cursor Agent's `agent`)

```bash
~/.local/bin/claude \
  -p "user message" \
  --output-format stream-json \
  --verbose \
  --dangerously-skip-permissions \
  [--resume <sessionId>] \
  [--model <model-alias>]
```

**PTY is not needed**. Claude Code CLI supports standard stdin/stdout — a regular `child_process.spawn()` suffices. All engines (Cursor, Claude Code, OpenCode, Codex) now use the same `child_process.spawn` approach.

---

### stream-json Output Format

One JSON object per line (NDJSON); stdout outputs pure JSON without ANSI escape sequences.

#### Event Type Overview

| type | subtype | Meaning | Key Fields |
|------|---------|---------|------------|
| `system` | `init` | Initialization | `session_id`, `model`, `cwd`, `tools[]`, `mcp_servers[]`, `apiKeySource` |
| `assistant` | — | Assistant reply (text / tool calls) | `session_id`, `message.content[]` — may contain `text` and `tool_use` blocks |
| `user` | — | Tool execution results | `session_id`, `message.content[].type:"tool_result"` |
| `result` | `success` | Conversation ended normally | `session_id`, `duration_ms`, `duration_api_ms`, `total_cost_usd`, `num_turns`, `result`, `usage` |
| `result` | `error` | Conversation ended with error | `is_error: true`, `result` (error message), `permission_denials[]` |

#### Key Format Differences from Cursor

| Aspect | Cursor Agent | Claude Code |
|--------|-------------|-------------|
| Text messages | `type:"assistant"` + `message.content[].type:"text"` | Same structure |
| Tool call start | `type:"tool_call"`, `subtype:"started"` | `type:"assistant"` + `message.content[].type:"tool_use"` |
| Tool call result | `type:"tool_call"`, `subtype:"completed"` | `type:"user"` + `message.content[].type:"tool_result"` |
| Extended result fields | `duration_ms` | `duration_ms`, `duration_api_ms`, `total_cost_usd`, `num_turns`, `usage` |
| ANSI sequences | No (clean stdout since 2026.02+) | No (pure stdout) |
| Mixed content | Never | **A single assistant message can contain both text and tool_use blocks** |

#### Assistant Message Examples

**Pure text reply:**

```json
{"type":"assistant","session_id":"session_01","message":{"id":"msg_1","type":"message","role":"assistant","content":[{"type":"text","text":"Planning next steps."}],"usage":{"input_tokens":120,"output_tokens":45}}}
```

**Tool call:**

```json
{"type":"assistant","session_id":"session_01","message":{"id":"msg_2","type":"message","role":"assistant","content":[{"type":"tool_use","id":"toolu_1","name":"Bash","input":{"command":"ls -la"}}]}}
```

**Tool result (user event):**

```json
{"type":"user","session_id":"session_01","message":{"id":"msg_3","type":"message","role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_1","content":"total 2\nREADME.md\nsrc\n"}]}}
```

The tool result content can be either a string or array format:

```json
{"type":"tool_result","tool_use_id":"toolu_2","content":[{"type":"text","text":"Task completed"}]}
```

#### Result Event Examples

```json
{"type":"result","subtype":"success","session_id":"session_01","total_cost_usd":0.0123,"is_error":false,"duration_ms":12345,"duration_api_ms":12000,"num_turns":2,"result":"Done.","usage":{"input_tokens":150,"output_tokens":70,"service_tier":"standard"}}
```

```json
{"type":"result","subtype":"error","session_id":"session_02","total_cost_usd":0.001,"is_error":true,"duration_ms":2000,"result":"","error":"Permission denied","permission_denials":[{"tool_name":"Bash","tool_use_id":"toolu_9","tool_input":{"command":"git fetch origin main"}}]}
```

#### `--include-partial-messages` Behavior

Without this parameter, `assistant` events contain complete messages (output all at once after each message is finished).
With this parameter, additional `stream_event` type events are output, containing character-level incremental deltas:

```json
{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hel"}}}
```

**Streaming event sequence**: `message_start` → `content_block_start` → `content_block_delta` (multiple) → `content_block_stop` → `message_delta` → `message_stop` → finally the complete `assistant` message is output.

**GolemBot Phase 1 does not use** `--include-partial-messages` — the complete message mode is sufficient. Character-level streaming will be added in future iterations.

---

### Session Resume

- `--resume <sessionId>` resumes a specific session
- `--session-id <uuid>` uses a specified UUID as the session ID
- `--continue` / `-c` resumes the most recent session in the current directory
- `--fork-session` forks from an existing session (preserves history but with a different ID)
- session_id can be obtained from the `type: "system"` init event or the `type: "result"` event

**Difference from Cursor**: Cursor can only get session_id from the result event; Claude Code provides it in the system init event.

---

### Authentication Methods

| Method | Use Case | Setup |
|--------|----------|-------|
| `claude auth login` | Local development (recommended) | Browser OAuth flow |
| `ANTHROPIC_API_KEY` environment variable | CI/CD, scripts, headless environments | Obtain from https://console.anthropic.com/settings/keys |
| Cloud Provider (Bedrock/Vertex/Foundry) | Enterprise deployment | Platform-specific environment variable configuration |

**CI/CD scenarios must use API key** — `claude auth login` requires browser interaction.

---

### Skill / CLAUDE.md Mechanism

Claude Code's Skill system differs significantly from Cursor's:

**CLAUDE.md (Project Memory):**

| Location | Purpose | When Loaded |
|----------|---------|-------------|
| `./CLAUDE.md` or `./.claude/CLAUDE.md` | Project-level instructions | Auto-loaded at session start |
| `~/.claude/CLAUDE.md` | Personal-level instructions (all projects) | Auto-loaded at session start |
| `./CLAUDE.local.md` | Personal project-level instructions (not committed to git) | Auto-loaded at session start |

**Skills (`.claude/skills/`):**

- Similar to Cursor's `.cursor/skills/`, each skill is a directory containing `SKILL.md`
- Claude Code auto-discovers skills under `.claude/skills/`
- Skill descriptions are loaded into context at session start; full content is loaded on-demand when used
- Supports frontmatter configuration: `name`, `description`, `disable-model-invocation`, `allowed-tools`, `context: fork`, etc.
- Users can manually trigger via `/skill-name`, or Claude automatically determines when to use them

**GolemBot's skill injection strategy:**

| Engine | Injection Method |
|--------|-----------------|
| Cursor | symlink `skills/<name>` → `.cursor/skills/<name>` |
| Claude Code | Generate `CLAUDE.md` at workspace root (containing skill descriptions and path references) |

---

### Permissions & Security

| Parameter / Setting | Effect |
|--------------------|--------|
| `--dangerously-skip-permissions` | Skip all permission prompts (required for headless) |
| `--allowedTools "Bash,Read,Edit"` | Allow specified tools without confirmation (finer granularity) |
| `--disallowedTools "Edit"` | Disable specified tools |
| `permissions.allow/deny` in settings.json | Persistent permission rules |

**GolemBot uses `--dangerously-skip-permissions`** (equivalent to Cursor's `--force --trust --sandbox disabled`).

---

### Model Configuration

| Alias | Corresponding Model | Use Case |
|-------|---------------------|----------|
| `sonnet` | Sonnet 4.6 (latest) | Day-to-day coding |
| `opus` | Opus 4.6 (latest) | Complex reasoning |
| `haiku` | Haiku | Simple tasks |
| `opusplan` | Opus for planning phase, Sonnet for execution | Mixed mode |

Can be set via `--model <alias>` or the `ANTHROPIC_MODEL` environment variable.

---

### MCP Support

Claude Code loads MCP configuration from `.claude/mcp.json` (not `.cursor/mcp.json`).
The CLI supports `--mcp-config ./mcp.json` to load additional MCP configurations.

---

### GitHub Actions Integration

```yaml
- name: Run Claude Code
  uses: anthropics/claude-code-action@v1
  with:
    prompt: "Your prompt here"
    allowed-tools: "Bash,Read,Edit"
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

---

### Known Pitfalls & GolemBot Adaptation Notes

1. **PTY is not needed** — The biggest difference from Cursor; simple `child_process.spawn` works
2. **No ANSI stripping needed** — stdout is pure JSON, unlike Cursor's PTY output which mixes in ANSI sequences
3. **Mixed content blocks** — A single assistant message may contain both `text` and `tool_use`; they need to be split and processed separately
4. **tool_result is a user event** — Not Cursor's `tool_call.subtype:"completed"`, but a separate `type:"user"` event
5. **session_id is available at init** — No need to wait for the result event to get the session_id
6. **`--verbose` is required** — Without this parameter, stream-json only outputs the final result, not intermediate assistant/user events
7. **result provides more metadata** — `total_cost_usd`, `num_turns`, `duration_api_ms`, `usage` can all be exposed to users
8. **`--dangerously-skip-permissions` is a single parameter** — Unlike Cursor which needs three parameters: `--force --trust --sandbox disabled`
9. **Permission bypass must be explicitly enabled** — You must first enable the option with `--allow-dangerously-skip-permissions`, then activate with `--dangerously-skip-permissions` or `--permission-mode bypassPermissions`. Or use `--dangerously-skip-permissions` directly, which implicitly allows it
10. **Skill paths differ** — Cursor uses `.cursor/skills/`, Claude Code uses `.claude/skills/`; GolemBot must choose the injection method based on the engine
