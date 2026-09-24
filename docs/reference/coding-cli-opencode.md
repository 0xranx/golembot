# OpenCode CLI

### Official Documentation

**Core docs:**

- Introduction: https://opencode.ai/docs
- Configuration: https://opencode.ai/docs/config
- CLI Command Reference: https://opencode.ai/docs/cli
- Providers (75+ LLM providers): https://opencode.ai/docs/providers
- Agent System: https://opencode.ai/docs/agents
- Skills (Agent Skills): https://opencode.ai/docs/skills
- Rules (AGENTS.md): https://opencode.ai/docs/rules
- Permissions System: https://opencode.ai/docs/permissions
- Built-in Tools: https://opencode.ai/docs/tools
- Custom Tools: https://opencode.ai/docs/custom-tools
- Model Configuration: https://opencode.ai/docs/models

**Extended capabilities:**

- MCP Servers: https://opencode.ai/docs/mcp-servers
- Plugin System: https://opencode.ai/docs/plugins
- HTTP Server API: https://opencode.ai/docs/server
- Web Interface: https://opencode.ai/docs/web
- ACP Protocol: https://opencode.ai/docs/acp

**Deployment & CI/CD:**

- GitHub Actions: https://opencode.ai/docs/github
- Network / Proxy: https://opencode.ai/docs/network
- Enterprise: https://opencode.ai/docs/enterprise

**Project info:**

- GitHub: https://github.com/anomalyco/opencode (113K+ stars)
- npm package: `opencode-ai`
- Version: v1.1.28 (as of 2026-03)

---

### Core Positioning Difference

**OpenCode is not an "IDE companion CLI" like Cursor/Claude Code — it's a standalone open-source AI coding agent.** It directly calls LLM APIs (via AI SDK + Models.dev), implements its own tool system (bash/read/write/edit/grep/glob, etc.), and manages sessions and context independently.

Key differences from Cursor Agent and Claude Code:

| | Cursor Agent | Claude Code | OpenCode |
|---|---|---|---|
| Nature | CLI mode of Cursor IDE | Anthropic's CLI Agent | Standalone open-source Agent |
| LLM | Cursor backend (with routing) | Anthropic API | 75+ Providers to choose from |
| Tools | Cursor built-in | Claude Code built-in | Custom-built + MCP + custom |

---

### Installation

**Prerequisites**: Node.js >= 18 (for npm) or Go >= 1.22 (for building from source)

**Install via npm** (recommended):

```bash
npm install -g opencode-ai
```

**Alternative — install via Go:**

```bash
go install github.com/anomalyco/opencode@latest
```

**Verify installation:**

```bash
opencode --version
```

---

### Actual Invocation Method (Verified in GolemBot)

**Binary path**: Depends on the Node version manager, e.g., `~/.nvm/versions/node/v22.10.0/bin/opencode`

```bash
opencode run "user message" \
  --format json \
  --model provider/model \
  [--session <sessionId>] \
  [--continue] \
  [--agent <agentName>] \
  [--attach http://localhost:4096]
```

**PTY is not needed**. OpenCode is a standard CLI; a regular `child_process.spawn()` works (same as Claude Code).

**Key parameter descriptions:**

| Parameter | Effect | Notes |
|-----------|--------|-------|
| `--format json` | Output raw JSON events (NDJSON) | Replaces the default formatted text output |
| `--model provider/model` | Specify model (e.g., `anthropic/claude-sonnet-4-5`) | Format is `provider/model`, unlike Claude Code's aliases |
| `--session <id>` | Resume a specific session | Session ID format: `ses_XXXXXXXX` |
| `--continue` / `-c` | Resume most recent session | |
| `--fork` | Fork session (preserves history but with new ID) | Must be combined with `--session` or `--continue` |
| `--agent <name>` | Specify Agent (e.g., `build`, `plan`) | Default is `build` (full-featured) |
| `--attach <url>` | Connect to a running serve instance | Avoids cold start, recommended for production |
| `--port <n>` | Specify local server port | Default is random port |

---

### JSON Output Format (`--format json`)

`opencode run --format json` outputs NDJSON. **The event structure is completely different from Cursor/Claude Code's stream-json.**

#### Observed Event Types

**Error events:**

```json
{
  "type": "error",
  "timestamp": 1772335804867,
  "sessionID": "ses_3588dd885ffeJynG8QZsSrpPiL",
  "error": {
    "name": "APIError",
    "data": {
      "message": "Your credit balance is too low...",
      "statusCode": 400,
      "isRetryable": false
    }
  }
}
```

**Session data structure** (full format obtained via `opencode export <sessionId>`):

```json
{
  "info": {
    "id": "ses_XXX",
    "title": "...",
    "time": { "created": 1772335636895, "updated": 1772335640665 }
  },
  "messages": [
    {
      "info": {
        "id": "msg_XXX",
        "role": "user|assistant",
        "agent": "build",
        "model": { "providerID": "...", "modelID": "..." },
        "cost": 0,
        "tokens": {
          "input": 11103, "output": 35, "reasoning": 33,
          "cache": { "read": 397, "write": 0 }
        },
        "finish": "stop"
      },
      "parts": [
        { "type": "text", "text": "..." },
        { "type": "step-start" },
        { "type": "reasoning", "text": "...", "time": { "start": 0, "end": 0 } },
        { "type": "step-finish", "reason": "stop", "cost": 0, "tokens": {} }
      ]
    }
  ]
}
```

**Message parts type overview:**

| part.type | Meaning | Key Fields |
|-----------|---------|------------|
| `text` | Text content | `text`, `time` |
| `step-start` | Reasoning step started | |
| `step-finish` | Reasoning step ended | `reason`, `cost`, `tokens` |
| `reasoning` | Reasoning process (chain of thought) | `text`, `time` |
| `tool-invocation` | Tool call | `toolName`, `args`, `result` |

**Format differences from Cursor/Claude Code:**

| Aspect | Cursor | Claude Code | OpenCode |
|--------|--------|-------------|----------|
| Streaming format | `--output-format stream-json` | `--output-format stream-json` | `--format json` |
| Text events | `type:"assistant"` | `type:"assistant"` + `content[].type:"text"` | part.type: `text` |
| Tool calls | `type:"tool_call"` + started/completed | `type:"assistant"` + tool_use block | part.type: `tool-invocation` |
| End events | `type:"result"` | `type:"result"` | step-finish (with cost/tokens) |
| Error events | `type:"result"` + `is_error:true` | `type:"result"` + `is_error:true` | `type:"error"` + error object |
| Metadata | `duration_ms` | `duration_ms`, `total_cost_usd`, `num_turns` | `cost`, `tokens` (with reasoning + cache breakdown) |
| ANSI | No (clean stdout since 2026.02+) | No | No |

**Note**: The streaming event structure above has been verified through real-world testing with OpenRouter + Anthropic models. The `OpenCodeEngine` in GolemBot has been fully implemented and passes e2e tests. Key observation: OpenCode sends text content in full chunks (not character-level deltas), similar to Claude Code's behavior without `--include-partial-messages`.

---

### Alternative: Integration via HTTP Server API

OpenCode provides a full HTTP Server (OpenAPI 3.1 spec), giving GolemBot **two integration approaches**:

**Approach A: CLI mode** (same as Cursor/Claude Code)
```bash
opencode run --format json "prompt"
```

**Approach B: HTTP Server mode** (OpenCode exclusive)
```bash
opencode serve --port 4096
# → POST /session/:id/message { parts: [{ type: "text", text: "prompt" }] }
# → GET /event (SSE stream)
```

Key HTTP Server API endpoints:

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/session` | Create new session |
| `POST` | `/session/:id/message` | Send message (synchronous, waits for completion) |
| `POST` | `/session/:id/prompt_async` | Send message asynchronously |
| `POST` | `/session/:id/abort` | Abort a running session |
| `GET` | `/session/:id/message` | Get message list |
| `GET` | `/event` | SSE event stream |
| `GET` | `/global/health` | Health check |
| `DELETE` | `/session/:id` | Delete session |
| `POST` | `/session/:id/fork` | Fork session |
| `POST` | `/session/:id/share` | Share session |

Advantages of HTTP mode: avoids the cold start of each `opencode run` (5-10s), reusing a single server instance for multiple conversations.

---

### Session Management

| Operation | CLI Command | Description |
|-----------|------------|-------------|
| List sessions | `opencode session list --format json` | Returns JSON array |
| Resume session | `opencode run --session <id> "message"` | |
| Resume most recent | `opencode run --continue "message"` | |
| Fork session | `opencode run --session <id> --fork "message"` | |
| Export session | `opencode export <id>` | Full JSON (all messages and parts) |
| Import session | `opencode import <file\|url>` | |
| Delete session | HTTP: `DELETE /session/:id` | No direct CLI command yet |
| View statistics | `opencode stats` | Token usage and cost statistics |

**Session ID format**: `ses_XXXXXXXXXXXXXXXX` (different from Cursor/Claude Code's UUID format)

---

### Authentication Methods

OpenCode supports 75+ LLM Providers; the authentication method depends on the chosen Provider:

| Method | Use Case | Setup |
|--------|----------|-------|
| `opencode auth login` / `/connect` | Local development | Interactive within TUI, credentials stored to `~/.local/share/opencode/auth.json` |
| Provider environment variables | CI/CD, scripts | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, etc. |
| OpenCode Zen / Go | Official hosted Provider | Unified API Key, verified by the OpenCode team |
| `.env` file | Project-level config | OpenCode auto-loads `.env` from the project directory at startup |

**Common Provider environment variables:**

| Provider | Environment Variable | Model Format Example |
|----------|---------------------|---------------------|
| Anthropic | `ANTHROPIC_API_KEY` | `anthropic/claude-sonnet-4-5` |
| OpenAI | `OPENAI_API_KEY` | `openai/gpt-5` |
| Google | `GOOGLE_GENERATIVE_AI_API_KEY` | `google/gemini-2.5-pro` |
| OpenRouter | `OPENROUTER_API_KEY` | `openrouter/anthropic/claude-sonnet-4-5` |
| Requesty | `REQUESTY_API_KEY` | `requesty/openai/gpt-4o-mini` |
| Amazon Bedrock | `AWS_*` series | `amazon-bedrock/...` |

**Difference from Cursor/Claude Code**: Cursor only needs `CURSOR_API_KEY`, Claude Code only needs `ANTHROPIC_API_KEY`. Because OpenCode supports multiple Providers, you must set the environment variable **corresponding to the chosen Provider**. When integrating with GolemBot's `InvokeOpts.apiKey`, you need to know the target Provider to set the correct environment variable name.

---

### Skill Mechanism

OpenCode's Skill system is highly compatible with Claude Code. Search paths:

| Location | Scope | Description |
|----------|-------|-------------|
| `.opencode/skills/*/SKILL.md` | Project-level | OpenCode native path |
| `.claude/skills/*/SKILL.md` | Project-level | Claude Code compatible (can be disabled via `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS=1`) |
| `.agents/skills/*/SKILL.md` | Project-level | Universal standard path |
| `~/.config/opencode/skills/*/SKILL.md` | Global | User-level |
| `~/.claude/skills/*/SKILL.md` | Global | Claude Code compatible |
| `~/.agents/skills/*/SKILL.md` | Global | Universal standard |

**Skill discovery mechanism**: OpenCode traverses upward from the current directory to the git worktree root, loading all matching `skills/*/SKILL.md` along the way.

**On-demand loading**: At Agent startup, only Skill names and descriptions are visible (injected into the `skill` tool description); full content is loaded when the Agent decides to use it via the `skill({ name: "xxx" })` tool call.

**SKILL.md frontmatter requirements:**

```yaml
---
name: git-release          # Required, must match directory name, lowercase + hyphens
description: Create releases  # Required, 1-1024 characters
license: MIT               # Optional
compatibility: opencode    # Optional
metadata:                  # Optional, string-to-string map
  audience: maintainers
---
```

**GolemBot's injection strategy options:**
- Option 1: symlink to `.opencode/skills/` (most canonical)
- Option 2: symlink to `.agents/skills/` (universal standard, other Agents can read it in the future)
- Option 3: reuse Claude Code's `.claude/skills/` symlink (OpenCode reads it compatibly)

---

### Rules / AGENTS.md

OpenCode's rules system is perfectly compatible with GolemBot's `AGENTS.md` generation mechanism:

| Location | Priority | Description |
|----------|----------|-------------|
| `AGENTS.md` (project root) | High | OpenCode native, takes precedence over CLAUDE.md |
| `CLAUDE.md` (project root) | Low | Only used when there is no AGENTS.md |
| `~/.config/opencode/AGENTS.md` | Global | User-level rules |
| `~/.claude/CLAUDE.md` | Global fallback | Only used when there is no global AGENTS.md |

**Additional instruction files**: The `instructions` field in `opencode.json` can reference extra files (supports globs and remote URLs):

```json
{ "instructions": ["CONTRIBUTING.md", "docs/guidelines.md", ".cursor/rules/*.md"] }
```

**Implications for GolemBot**: The `AGENTS.md` generated by GolemBot during `init` is automatically consumed by OpenCode — no additional configuration needed.

---

### Permissions System

OpenCode permissions are configured via `opencode.json`, with finer granularity than Cursor/Claude Code:

```json
{
  "permission": {
    "*": "allow",
    "bash": { "*": "ask", "git *": "allow", "rm *": "deny" },
    "edit": { "*": "allow", "*.env": "deny" }
  }
}
```

Three levels: `"allow"` (auto-execute), `"ask"` (request approval), `"deny"` (forbidden)

**Default permissions**: Most operations default to `"allow"`; only `.env` files default to `"deny"`. **No parameter equivalent to `--dangerously-skip-permissions` is needed.**

**Headless mode status (v1.1.28):**
- `opencode run` in non-interactive mode has known bugs ([PR #14607](https://github.com/anomalyco/opencode/pull/14607), not yet merged)
- Bug 1: `question` tool hangs in non-interactive mode (session deny rules not propagated to tool filter layer)
- Bug 2: Permissions configured as `"ask"` auto-reject in non-interactive mode, causing tool failures
- **Fix (in PR)**: `"ask"` permissions auto-approve in non-interactive mode; adds `--no-auto-approve` flag
- **Current workaround**: Set all permissions to `allow` via `OPENCODE_PERMISSION='{"*":"allow"}'` or `opencode.json`

---

### Agent System

OpenCode has a built-in Agent hierarchy (GolemBot can leverage it via the `--agent` parameter):

**Primary Agents:**
- `build` — Default, full-featured (can read/write files, execute commands)
- `plan` — Read-only mode, analyze and plan but don't modify files

**Subagents:**
- `general` — General purpose, can execute multiple tasks in parallel
- `explore` — Read-only, fast code search

Custom Agents are supported: define via the `agent` field in `opencode.json` or `.opencode/agents/*.md` files.

---

### MCP Support

Configured via `opencode.json` (not `.cursor/mcp.json` or `.claude/mcp.json`):

```json
{
  "mcp": {
    "my-server": {
      "type": "local",
      "command": ["npx", "-y", "my-mcp-command"],
      "enabled": true
    },
    "remote-server": {
      "type": "remote",
      "url": "https://mcp.example.com/mcp"
    }
  }
}
```

Supports two types: local (command spawn) and remote (URL + optional OAuth).

---

### Plugin System

OpenCode provides a full plugin hook mechanism (neither Cursor nor Claude Code has this capability):

```typescript
export const MyPlugin = async ({ project, client, $ }) => ({
  "tool.execute.before": async (input, output) => { /* Before tool execution */ },
  "tool.execute.after": async (input, output) => { /* After tool execution */ },
  event: async ({ event }) => { /* Event listener */ },
});
```

Plugins are placed in `.opencode/plugins/` (project-level) or `~/.config/opencode/plugins/` (global), and can also be installed as npm packages.

---

### GitHub Actions Integration

```yaml
- uses: anomalyco/opencode/github@latest
  with:
    model: anthropic/claude-sonnet-4-20250514
    # prompt: "optional custom prompt"
    # agent: "build"
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

Supported trigger events: `issue_comment` (/opencode or /oc), `pull_request_review_comment`, `issues`, `pull_request`, `schedule`, `workflow_dispatch`

---

### Configuration Files

| File | Location | Content |
|------|----------|---------|
| `opencode.json` | Project root directory | Project-level config (models, permissions, MCP, Agents, tools, etc.) |
| `opencode.json` | `~/.config/opencode/` | Global config |
| `auth.json` | `~/.local/share/opencode/` | Provider credentials |
| `.opencode/agents/*.md` | Project-level | Custom Agents |
| `.opencode/plugins/*.ts` | Project-level | Custom plugins |
| `.opencode/tools/*.ts` | Project-level | Custom tools |
| `.opencode/skills/*/SKILL.md` | Project-level | Skill definitions |

Configuration precedence (later overrides earlier): remote config → global → project → custom path → `OPENCODE_CONFIG_CONTENT` environment variable

---

### Known Pitfalls & GolemBot Adaptation Notes

1. **Slow cold start (5-10s)** — OpenCode loads Provider configs, MCP servers, etc. at startup, much slower than Cursor/Claude Code. For production, use `opencode serve` + `--attach` mode to reuse a server instance
2. **`--format json` event structure is completely different from Cursor/Claude Code** — Cannot reuse `parseStreamLine()` or `parseClaudeStreamLine()`; requires an independent `parseOpenCodeStreamLine()`
3. **Headless mode has known bugs** — In v1.1.28, `opencode run`'s question tool may hang, and `"ask"` permissions auto-reject. Recommend explicitly setting `permission: "allow"` as a workaround
4. **Multi-Provider authentication is complex** — Unlike Cursor/Claude Code which each need only one environment variable, OpenCode requires the API Key corresponding to the chosen Provider. When integrating with GolemBot's `InvokeOpts.apiKey`, you need to know the target Provider to set the correct environment variable name
5. **Skill multi-path auto-discovery** — OpenCode simultaneously reads `.opencode/skills/`, `.claude/skills/`, `.agents/skills/`. If GolemBot injects skills for both Claude Code and OpenCode, there's no conflict (identical Skills are only loaded once)
6. **AGENTS.md auto-consumption** — The AGENTS.md generated by GolemBot during init is automatically consumed by OpenCode — a positive compatibility feature
7. **Session ID format is different** — `ses_XXXXXXXX` instead of UUID; GolemBot's session storage layer needs to accommodate this
8. **HTTP Server API is a better integration approach** — Compared to CLI spawn mode, HTTP mode eliminates cold start, supports abort operations (`POST /session/:id/abort`), and may be a better Engine implementation
9. **`opencode.json` needs to be generated during init** — Similar to Cursor's `.cursor/cli.json`, OpenCode's project config needs to be generated during workspace initialization
10. **OpenCode iterates extremely fast** — As of 2026-03, it's at v1.1.28; the API may change frequently, so keep an eye on the changelog
