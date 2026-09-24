# OpenCode Engine

The OpenCode engine invokes the `opencode` CLI, which supports multiple LLM providers.

## Prerequisites

- Install OpenCode: `opencode` available on PATH
- Set the API key for your chosen provider (see below)

## Configuration

```yaml
# golem.yaml
name: my-bot
engine: opencode
model: anthropic/claude-sonnet-4-5   # optional, format: provider/model
```

## Choosing a Model

OpenCode uses a `provider/model` format. The provider prefix also determines which API key environment variable is used.

**List available models:**

```bash
opencode models
```

OpenCode supports 75+ providers via the AI SDK. The canonical source for all valid model strings is **[models.dev](https://models.dev)**.

**Common examples:**

| Model string | Provider | API key env var |
|---|---|---|
| `anthropic/claude-sonnet-4-5-20250929` | Anthropic | `ANTHROPIC_API_KEY` |
| `anthropic/claude-opus-4-5` | Anthropic | `ANTHROPIC_API_KEY` |
| `openai/gpt-5` | OpenAI | `OPENAI_API_KEY` |
| `openai/gpt-4o` | OpenAI | `OPENAI_API_KEY` |
| `openrouter/anthropic/claude-opus-4-6` | OpenRouter | `OPENROUTER_API_KEY` |
| `requesty/openai/gpt-4o-mini` | Requesty | `REQUESTY_API_KEY` |
| `google/gemini-2.5-flash` | Google | `GOOGLE_GENERATIVE_AI_API_KEY` |
| `deepseek/deepseek-chat` | DeepSeek | `DEEPSEEK_API_KEY` |
| `groq/llama-3.3-70b-versatile` | Groq | `GROQ_API_KEY` |

GolemBot automatically maps the provider prefix to the correct env var when `apiKey` is passed via `createAssistant()`.

**Override at runtime** — pass `model` to `createAssistant()`:

```typescript
const bot = createAssistant({ dir: './my-bot', model: 'openai/gpt-4o' })
```

## How It Works

### CLI Invocation

```bash
opencode run "<prompt>" \
  --format json
```

Optional flags:
- `--session <sessionId>` — resume a previous session
- `--model <provider/model>` — specify model

### Multi-Provider Support

OpenCode supports many LLM providers. GolemBot automatically resolves the correct API key environment variable based on the model prefix:

| Model prefix | Environment variable |
|-------------|---------------------|
| `anthropic/` | `ANTHROPIC_API_KEY` |
| `openai/` | `OPENAI_API_KEY` |
| `openrouter/` | `OPENROUTER_API_KEY` |
| `requesty/` | `REQUESTY_API_KEY` |
| `groq/` | `GROQ_API_KEY` |
| `azure/` | `AZURE_API_KEY` |
| (others) | Passed through as-is |

If you pass `apiKey` via `createAssistant()`, GolemBot infers the correct env var name from the model prefix.

### Skill Injection

Skills are symlinked into `.opencode/skills/`:

```
my-bot/
├── .opencode/
│   └── skills/
│       ├── general -> ../../skills/general
│       └── im-adapter -> ../../skills/im-adapter
├── opencode.json
└── skills/
    ├── general/
    └── im-adapter/
```

Additionally, GolemBot writes or updates `opencode.json` with permission and model configuration:

```json
{
  "permission": { "*": "allow" },
  "model": "anthropic/claude-sonnet"
}
```

### Output Parsing

OpenCode emits NDJSON (`--format json`). The parser handles:

- `text` events — streamed text content
- `tool_use` events — tool invocations
- `step_finish` events — accumulated per-step (not emitted individually); cost is summed
- `error` events — from both stdout and stderr

A single `done` event is emitted when the process closes, with accumulated cost.

### Session Resume

Sessions use `--session <ses_xxx>` format. Like other engines, resume failures trigger an automatic fallback to a fresh session.

## Notes

- OpenCode is the most flexible engine in terms of provider support
- The `opencode.json` permission config (`"*": "allow"`) bypasses all permission prompts for automated operation
- Cost tracking aggregates across all steps in a conversation turn
