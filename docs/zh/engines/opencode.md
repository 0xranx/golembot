# OpenCode 引擎

OpenCode 引擎调用 `opencode` CLI，支持多种 LLM Provider。

## 前置条件

- 安装 OpenCode：`opencode` 在 PATH 中可用
- 设置所选 Provider 的 API Key

## 配置

```yaml
name: my-bot
engine: opencode
model: anthropic/claude-sonnet-4-5   # 可选，格式：provider/model
```

## 选择模型

OpenCode 使用 `provider/model` 格式。Provider 前缀同时决定使用哪个 API Key 环境变量。

**列出可用模型：**

```bash
opencode models
```

OpenCode 通过 AI SDK 支持 75+ 个 Provider，所有有效模型字符串的权威来源是 **[models.dev](https://models.dev)**。

**常用示例：**

| 模型字符串 | Provider | API Key 环境变量 |
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

通过 `createAssistant()` 传入 `apiKey` 时，GolemBot 会根据 Provider 前缀自动映射到正确的环境变量。

**运行时覆盖** — 通过 `createAssistant()` 传入：

```typescript
const bot = createAssistant({ dir: './my-bot', model: 'openai/gpt-4o' })
```

## 多 Provider 支持

OpenCode 支持多种 LLM Provider。GolemBot 根据模型前缀自动解析正确的 API Key 环境变量：

| 模型前缀 | 环境变量 |
|----------|----------|
| `anthropic/` | `ANTHROPIC_API_KEY` |
| `openai/` | `OPENAI_API_KEY` |
| `openrouter/` | `OPENROUTER_API_KEY` |
| `requesty/` | `REQUESTY_API_KEY` |
| `groq/` | `GROQ_API_KEY` |
| `azure/` | `AZURE_API_KEY` |

## 技能注入

技能通过符号链接注入到 `.opencode/skills/`。同时写入或更新 `opencode.json`，配置权限和模型：

```json
{
  "permission": { "*": "allow" },
  "model": "anthropic/claude-sonnet"
}
```

## 输出解析

OpenCode 输出 NDJSON（`--format json`）。解析器处理 `text`、`tool_use`、`step_finish`、`error` 事件。`step_finish` 事件的费用会累加，进程关闭时输出一个 `done` 事件。
