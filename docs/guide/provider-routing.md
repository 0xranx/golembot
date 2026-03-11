# Provider Routing

GolemBot's **provider routing** feature decouples the coding agent CLI (engine) from the underlying LLM API. You can use any engine (Claude Code, Codex, OpenCode, Cursor) with any compatible third-party API provider, without modifying the CLI's global configuration.

## How It Works

```
golem.yaml (provider config)
    ↓
GolemBot injects env vars at spawn time
    ↓
Engine CLI → Provider API → LLM
```

When `provider` is set in `golem.yaml`, GolemBot:

1. Resolves `${ENV_VAR}` placeholders in the provider config
2. Maps provider fields to engine-specific environment variables
3. Spawns the engine CLI with those env vars injected

The engine CLI itself is unaware of the routing — it just sees standard env vars it already supports.

## Quick Start

```yaml
# golem.yaml
name: my-bot
engine: claude-code

provider:
  baseUrl: "https://openrouter.ai/api"
  apiKey: "${OPENROUTER_API_KEY}"
  model: "anthropic/claude-sonnet-4"
```

```sh
# .env
OPENROUTER_API_KEY=sk-or-v1-xxxxx
```

That's it. GolemBot handles the rest.

## Configuration Reference

```yaml
provider:
  baseUrl: "https://..."         # Provider API endpoint
  apiKey: "${ENV_VAR}"           # API key (supports ${ENV_VAR} placeholders)
  model: "model-name"           # Default model for all engines
  models:                        # Per-engine model overrides
    claude-code: "anthropic/claude-sonnet-4"
    codex: "openai/gpt-5.3-codex"
    opencode: "openrouter/openai/gpt-5.3-codex"
```

### Resolution Priority

**Model:**

1. `provider.models[engine]` — per-engine override
2. Runtime `--model` / `createAssistant({ model })` override
3. `provider.model` — provider-level default
4. Top-level `model` in golem.yaml

**API Key:**

1. Runtime `--api-key` / `createAssistant({ apiKey })`
2. `provider.apiKey`
3. Engine/global environment fallback (e.g. existing `ANTHROPIC_API_KEY`)

## Engine × Provider Compatibility Matrix

| Engine | API Protocol | Provider `baseUrl` for OpenRouter | Verified Providers |
|--------|-------------|----------------------------------|-------------------|
| Claude Code | Anthropic Messages API | `https://openrouter.ai/api` | OpenRouter ✅, MiniMax ✅ |
| Codex | OpenAI Responses API | `https://openrouter.ai/api/v1` | OpenRouter ✅ |
| OpenCode | OpenAI Chat API | `https://openrouter.ai/api/v1` | OpenRouter ✅ |
| Cursor | Cursor-compatible | — | Not yet tested |

::: warning Different engines require different base URLs
Claude Code expects Anthropic-protocol endpoints, while Codex and OpenCode expect OpenAI-protocol endpoints. Even for the same provider (e.g. OpenRouter), the `baseUrl` is different. Use `provider.models` if you need per-engine overrides, and configure separate assistants if the base URLs differ.
:::

## Env Var Injection by Engine

When `provider` is set, GolemBot injects these environment variables:

### Claude Code

| Env Var | Source |
|---------|--------|
| `ANTHROPIC_BASE_URL` | `provider.baseUrl` |
| `ANTHROPIC_API_KEY` | `provider.apiKey` |
| `ANTHROPIC_MODEL` | `provider.model` (+ all tier variants) |
| `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` | Always `1` (prevents telemetry calls to Anthropic) |

Additionally:
- `--model` flag is **not** passed (avoids client-side model name validation)
- `--setting-sources project,local` is added (excludes `~/.claude/settings.json` overrides)

### Codex

| Env Var | Source |
|---------|--------|
| `OPENAI_BASE_URL` | `provider.baseUrl` |
| `CODEX_API_KEY` | `provider.apiKey` |
| `OPENAI_API_KEY` | `provider.apiKey` (backward compat) |

### OpenCode

| Env Var | Source |
|---------|--------|
| `OPENAI_BASE_URL` | `provider.baseUrl` |
| `{PROVIDER}_API_KEY` | `provider.apiKey` (env var name derived from model prefix) |

The env var name is determined by the model's provider prefix (e.g. `openrouter/...` → `OPENROUTER_API_KEY`, `anthropic/...` → `ANTHROPIC_API_KEY`).

### Cursor

| Env Var | Source |
|---------|--------|
| `CURSOR_API_BASE_URL` | `provider.baseUrl` |
| `CURSOR_API_KEY` | `provider.apiKey` |

## Integration Cases

### Case 1: Claude Code + OpenRouter (Any Model)

Use OpenRouter's Anthropic-compatible endpoint to run Claude Code with 400+ models.

```yaml
name: my-bot
engine: claude-code

provider:
  baseUrl: "https://openrouter.ai/api"       # Anthropic API skin
  apiKey: "${OPENROUTER_API_KEY}"
  model: "anthropic/claude-sonnet-4"
```

```sh
# .env
OPENROUTER_API_KEY=sk-or-v1-xxxxx
```

::: tip Why `openrouter.ai/api` and not `openrouter.ai/api/v1`?
Claude Code uses the Anthropic Messages API protocol. OpenRouter's `/api` endpoint provides Anthropic-compatible API, while `/api/v1` is the OpenAI-compatible endpoint. Using the wrong one will result in model validation errors.
:::

### Case 2: Codex + OpenRouter

```yaml
name: my-bot
engine: codex

provider:
  baseUrl: "https://openrouter.ai/api/v1"    # OpenAI Responses API
  apiKey: "${OPENROUTER_API_KEY}"
  model: "openai/gpt-5.3-codex"
```

### Case 3: OpenCode + OpenRouter

```yaml
name: my-bot
engine: opencode

provider:
  baseUrl: "https://openrouter.ai/api/v1"
  apiKey: "${OPENROUTER_API_KEY}"
  model: "openrouter/openai/gpt-5.3-codex"
```

Note: OpenCode models use `provider/model` format. For OpenRouter, the prefix is `openrouter`.

### Case 4: Claude Code + MiniMax (Anthropic-Compatible Provider)

```yaml
name: my-bot
engine: claude-code

provider:
  baseUrl: "https://api.minimaxi.com/anthropic"
  apiKey: "${MINIMAX_API_KEY}"
  model: "MiniMax-M2.5"
```

### Case 5: Multi-Engine with Per-Engine Models

When switching between engines, use `provider.models` for per-engine model names:

```yaml
name: my-bot
engine: claude-code        # default engine

provider:
  apiKey: "${OPENROUTER_API_KEY}"
  baseUrl: "https://openrouter.ai/api"
  models:
    claude-code: "anthropic/claude-sonnet-4"
    opencode: "openrouter/openai/gpt-5.3-codex"
```

::: warning
When engines require different base URLs (e.g. Claude Code needs `/api`, Codex needs `/api/v1`), a single `provider` block cannot serve both. Use separate assistant directories for each engine, or rely on the engine's native configuration for the non-primary engine.
:::

## Codex Provider Routing: Known Issues

### `invalid_encrypted_content` on Multi-Turn

**Symptom:** First turn succeeds, second turn fails with:

```
{"type":"error","message":"{\"error\":{\"message\":\"code: invalid_encrypted_content; ...\"}}"}
```

**Root Cause:** OpenAI's Responses API returns encrypted content blobs (`encrypted_content` field) in reasoning items. On subsequent turns, Codex sends these blobs back to the server. If the provider gateway cannot decrypt/verify them (because only OpenAI holds the encryption keys), the request fails.

**Affected Scenarios:**
- Third-party API gateways that proxy to OpenAI but don't transparently pass encrypted content
- Self-hosted API endpoints that intercept or transform response payloads

**Workarounds:**
1. Use a provider that transparently proxies encrypted content (OpenRouter does this correctly)
2. Disable session resume (each request starts a fresh thread)
3. Use Claude Code or OpenCode instead — they do not use encrypted content blobs

**Reference:** GitHub issues [openai/codex#8100](https://github.com/openai/codex/issues/8100), [#8129](https://github.com/openai/codex/issues/8129)

### `previous_response_id` Not Supported by Provider

**Symptom:** Multi-turn context appears lost — model "forgets" previous conversation.

**Root Cause:** Some providers (including OpenRouter) do not support server-side `previous_response_id` context chaining. The Responses API accepts the field but does not retrieve prior turn context.

**Impact on Codex:** **None.** Codex does NOT rely on `previous_response_id` for multi-turn. It manages conversation context client-side via local session storage and re-sends full context on each turn. This is a non-issue for GolemBot.

### Codex Requires Responses API

Codex exclusively uses the OpenAI Responses API (`/responses` endpoint). Providers that only support Chat Completions (`/chat/completions`) will fail.

**Known incompatible providers:**
- DeepSeek API (`api.deepseek.com`) — no `/responses` endpoint
- MiniMax Chat API (`api.minimax.chat/v1`) — no `/responses` endpoint

**Check before integrating:** Confirm your provider documents Responses API support, or test with a direct curl:

```bash
curl -s https://your-provider/v1/responses \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"model-name","input":[{"role":"user","content":"hello"}]}'
```

## Backward Compatibility

The `provider` feature is **fully backward compatible**. Existing configurations without a `provider` block work exactly as before:

- All provider code paths are guarded by `if (opts.provider)` checks
- When `provider` is absent, model resolution reduces to the original `modelOverride || config.model`
- `opts.apiKey` (from CLI `--api-key` or `createAssistant({ apiKey })`) is still respected
- No changes to `AgentEngine` or `InvokeOpts` interface signatures (new fields are optional)
- The `Assistant` interface gains two new methods (`discoverEngines()`, `setProvider()`) — additive, non-breaking

**Upgrade checklist:**

| Scenario | Impact |
|----------|--------|
| No `provider` in golem.yaml | Zero impact — identical behavior |
| Using `model` in golem.yaml (no provider) | Zero impact — `config.model` still used |
| Using `--api-key` CLI flag | Zero impact — apiKey priority unchanged |
| Using engine's native config (e.g. `~/.codex/config.toml`) | Zero impact — native config still works when `provider` is not set |
| Adding `provider` to existing config | Provider takes effect; engine-level env vars are injected. Native CLI config may be overridden by injected env vars |

## Troubleshooting

### Claude Code: `apiKeyHelper did not return a valid value`

Claude Code's user-level settings (`~/.claude/settings.json`) may define an `apiKeyHelper` that conflicts with provider-injected credentials.

**GolemBot's mitigation:** In provider mode, GolemBot adds `--setting-sources project,local` to exclude user-level settings.

**Manual verification:**

```bash
HOME=/tmp/claude-clean-home \
ANTHROPIC_API_KEY="$YOUR_KEY" \
ANTHROPIC_BASE_URL="https://your-provider" \
ANTHROPIC_MODEL="your-model" \
CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 \
claude -p "say ok" --output-format stream-json --verbose --dangerously-skip-permissions
```

### General: Wrong Key Test

Intentionally break the API key to confirm provider routing is active:

1. Set `provider.apiKey` to `"invalid-key"`
2. Run a prompt — should fail with auth error
3. Restore the correct key — should succeed

If the call succeeds with an invalid provider key, it means the engine is using a different auth source (e.g. global env var or CLI-stored credentials).

### Proxy / VPN for Region-Restricted Providers

Some providers (e.g. OpenRouter, OpenAI) are region-restricted. Terminal sessions do not inherit system VPN settings by default.

```bash
export https_proxy=http://127.0.0.1:7890
export http_proxy=http://127.0.0.1:7890

# Verify
curl -s https://ipinfo.io/country   # should return non-CN
```

Add these to your `.env` or shell profile for persistence.
