# Provider 路由

GolemBot 的 **Provider 路由** 功能将 Coding Agent CLI（引擎）与底层 LLM API 解耦。你可以将任意引擎（Claude Code、Codex、OpenCode、Cursor）连接到任意兼容的第三方 API Provider，无需修改 CLI 的全局配置。

## 工作原理

```
golem.yaml (provider 配置)
    ↓
GolemBot 在进程启动时注入环境变量
    ↓
Engine CLI → Provider API → LLM
```

当 `golem.yaml` 中设置了 `provider` 时，GolemBot 会：

1. 解析 provider 配置中的 `${ENV_VAR}` 占位符
2. 将 provider 字段映射为引擎对应的环境变量
3. 以注入后的环境变量启动引擎 CLI 进程

引擎 CLI 本身无需感知路由 — 它只读取标准环境变量，行为与往常一致。

## 快速开始

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

配置完成，GolemBot 会处理剩余一切。

## 配置参考

```yaml
provider:
  baseUrl: "https://..."         # Provider API 端点
  apiKey: "${ENV_VAR}"           # API 密钥（支持 ${ENV_VAR} 占位符）
  model: "model-name"           # 所有引擎的默认模型
  models:                        # 按引擎覆盖模型
    claude-code: "anthropic/claude-sonnet-4"
    codex: "openai/gpt-5.3-codex"
    opencode: "openrouter/openai/gpt-5.3-codex"
```

### 解析优先级

**模型：**

1. `provider.models[engine]` — 按引擎覆盖
2. 运行时 `--model` / `createAssistant({ model })` 覆盖
3. `provider.model` — provider 级默认值
4. golem.yaml 顶层 `model`

**API Key：**

1. 运行时 `--api-key` / `createAssistant({ apiKey })`
2. `provider.apiKey`
3. 引擎 / 全局环境变量回退（如已有的 `ANTHROPIC_API_KEY`）

## 引擎 × Provider 兼容矩阵

| 引擎 | API 协议 | OpenRouter 对应的 `baseUrl` | 已验证 Provider |
|------|----------|---------------------------|----------------|
| Claude Code | Anthropic Messages API | `https://openrouter.ai/api` | OpenRouter ✅, MiniMax ✅ |
| Codex | OpenAI Responses API | `https://openrouter.ai/api/v1` | OpenRouter ✅ |
| OpenCode | OpenAI Chat API | `https://openrouter.ai/api/v1` | OpenRouter ✅ |
| Cursor | Cursor 兼容协议 | — | 尚未测试 |

::: warning 不同引擎需要不同的 base URL
Claude Code 使用 Anthropic 协议端点，而 Codex 和 OpenCode 使用 OpenAI 协议端点。即使是同一个 Provider（如 OpenRouter），`baseUrl` 也不同。如需按引擎覆盖模型，请使用 `provider.models`；如果 base URL 不同，请为每个引擎配置独立的 assistant 目录。
:::

## 各引擎的环境变量注入

设置了 `provider` 后，GolemBot 会注入以下环境变量：

### Claude Code

| 环境变量 | 来源 |
|---------|------|
| `ANTHROPIC_BASE_URL` | `provider.baseUrl` |
| `ANTHROPIC_API_KEY` | `provider.apiKey` |
| `ANTHROPIC_MODEL` | `provider.model`（+ 所有模型层级变体） |
| `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` | 始终为 `1`（阻止遥测请求发往 Anthropic） |

此外：
- **不传** `--model` 参数（避免客户端模型名校验）
- 添加 `--setting-sources project,local`（排除 `~/.claude/settings.json` 的覆盖）

### Codex

| 环境变量 | 来源 |
|---------|------|
| `OPENAI_BASE_URL` | `provider.baseUrl` |
| `CODEX_API_KEY` | `provider.apiKey` |
| `OPENAI_API_KEY` | `provider.apiKey`（向后兼容） |

### OpenCode

| 环境变量 | 来源 |
|---------|------|
| `OPENAI_BASE_URL` | `provider.baseUrl` |
| `{PROVIDER}_API_KEY` | `provider.apiKey`（环境变量名由模型前缀推断） |

环境变量名由模型的 provider 前缀决定（如 `openrouter/...` → `OPENROUTER_API_KEY`，`anthropic/...` → `ANTHROPIC_API_KEY`）。

### Cursor

| 环境变量 | 来源 |
|---------|------|
| `CURSOR_API_BASE_URL` | `provider.baseUrl` |
| `CURSOR_API_KEY` | `provider.apiKey` |

## 集成案例

### 案例 1：Claude Code + OpenRouter（任意模型）

使用 OpenRouter 的 Anthropic 兼容端点，通过 Claude Code 访问 400+ 模型。

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

::: tip 为什么是 `openrouter.ai/api` 而不是 `openrouter.ai/api/v1`？
Claude Code 使用 Anthropic Messages API 协议。OpenRouter 的 `/api` 端点提供 Anthropic 兼容 API，而 `/api/v1` 是 OpenAI 兼容端点。使用错误的端点会导致模型校验错误。
:::

### 案例 2：Codex + OpenRouter

```yaml
name: my-bot
engine: codex

provider:
  baseUrl: "https://openrouter.ai/api/v1"    # OpenAI Responses API
  apiKey: "${OPENROUTER_API_KEY}"
  model: "openai/gpt-5.3-codex"
```

### 案例 3：OpenCode + OpenRouter

```yaml
name: my-bot
engine: opencode

provider:
  baseUrl: "https://openrouter.ai/api/v1"
  apiKey: "${OPENROUTER_API_KEY}"
  model: "openrouter/openai/gpt-5.3-codex"
```

注意：OpenCode 模型使用 `provider/model` 格式。对于 OpenRouter，前缀为 `openrouter`。

### 案例 4：Claude Code + MiniMax（Anthropic 兼容 Provider）

```yaml
name: my-bot
engine: claude-code

provider:
  baseUrl: "https://api.minimax.io/anthropic"
  apiKey: "${MINIMAX_API_KEY}"
  model: "MiniMax-M3"
```

### 案例 5：多引擎 + 按引擎指定模型

在多引擎间切换时，使用 `provider.models` 为每个引擎指定模型名：

```yaml
name: my-bot
engine: claude-code        # 默认引擎

provider:
  apiKey: "${OPENROUTER_API_KEY}"
  baseUrl: "https://openrouter.ai/api"
  models:
    claude-code: "anthropic/claude-sonnet-4"
    opencode: "openrouter/openai/gpt-5.3-codex"
```

::: warning
当不同引擎需要不同 base URL 时（如 Claude Code 需要 `/api`，Codex 需要 `/api/v1`），单个 `provider` 配置块无法同时满足两者。请为每个引擎使用独立的 assistant 目录，或对非主引擎使用其原生配置。
:::

## Codex Provider 路由：已知问题

### 多轮对话 `invalid_encrypted_content` 错误

**症状：** 第一轮成功，第二轮报错：

```
{"type":"error","message":"{\"error\":{\"message\":\"code: invalid_encrypted_content; ...\"}}"}
```

**根因：** OpenAI 的 Responses API 在推理项中返回加密内容块（`encrypted_content` 字段）。后续轮次中 Codex 会将这些块回传给服务端。如果 Provider 网关无法解密/校验这些块（因为只有 OpenAI 持有加密密钥），请求就会失败。

**受影响场景：**
- 代理 OpenAI 但不透传加密内容的第三方 API 网关
- 拦截或转换响应体的自托管 API 端点

**变通方案：**
1. 使用能透明代理加密内容的 Provider（OpenRouter 可以正确处理）
2. 禁用会话恢复（每次请求都开启新线程）
3. 改用 Claude Code 或 OpenCode — 它们不使用加密内容块

**参考：** GitHub issues [openai/codex#8100](https://github.com/openai/codex/issues/8100), [#8129](https://github.com/openai/codex/issues/8129)

### Provider 不支持 `previous_response_id`

**症状：** 多轮上下文似乎丢失 — 模型"忘记"了之前的对话。

**根因：** 部分 Provider（包括 OpenRouter）不支持服务端 `previous_response_id` 上下文链接。Responses API 接受该字段但不会检索之前轮次的上下文。

**对 Codex 的影响：** **无。** Codex 不依赖 `previous_response_id` 实现多轮对话。它通过本地会话存储在客户端管理上下文，每轮重发完整上下文。对 GolemBot 无影响。

### Codex 要求 Responses API

Codex 仅使用 OpenAI Responses API（`/responses` 端点）。仅支持 Chat Completions（`/chat/completions`）的 Provider 将无法使用。

**已知不兼容 Provider：**
- DeepSeek API（`api.deepseek.com`）— 无 `/responses` 端点
- MiniMax Chat API（`api.minimax.chat/v1`）— 无 `/responses` 端点

**集成前请确认：** 确保你的 Provider 文档说明支持 Responses API，或直接用 curl 测试：

```bash
curl -s https://your-provider/v1/responses \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"model-name","input":[{"role":"user","content":"hello"}]}'
```

## 自动 Fallback

当供应商变得不稳定时，GolemBot 可以自动切换到备用供应商。在 `provider` 中添加 `fallback` 块：

```yaml
provider:
  apiKey: ${MINIMAX_API_KEY}
  baseUrl: https://api.minimax.io/anthropic
  model: MiniMax-M3
  failoverThreshold: 3          # 连续错误多少次后切换（默认：3）
  fallback:
    apiKey: ${OPENROUTER_API_KEY}
    baseUrl: https://openrouter.ai/api
    model: anthropic/claude-sonnet-4
```

### 工作原理

1. 每次 `chat()` 调用发往**主供应商**。
2. 出错时失败计数器递增；成功时计数器重置为 0。
3. 计数器达到 `failoverThreshold`（默认 3）时，GolemBot 切换到 `fallback` 并 emit 一个 `warning` StreamEvent，IM 通道可以据此通知用户。
4. 之后所有调用都使用 fallback，直到 assistant 实例重启。
5. 未配置 `fallback` 时，circuit breaker 完全不执行（零开销）。

::: tip 用 `golembot doctor` 验证
`golembot doctor` 会检查 `provider.apiKey` 和 `provider.fallback.apiKey` 是否已设置且已解析。配置 fallback 后运行它，可以提前发现环境变量缺失。
:::

## 向后兼容性

`provider` 功能**完全向后兼容**。没有 `provider` 配置块的现有配置行为不变：

- 所有 provider 代码路径都有 `if (opts.provider)` 守卫
- 无 `provider` 时，模型解析退化为原始的 `modelOverride || config.model`
- `opts.apiKey`（来自 CLI `--api-key` 或 `createAssistant({ apiKey })`）仍然生效
- `AgentEngine` 和 `InvokeOpts` 接口签名无变更（新字段均为可选）
- `Assistant` 接口新增两个方法（`discoverEngines()`、`setProvider()`）— 仅新增，不破坏兼容性

**升级检查清单：**

| 场景 | 影响 |
|------|------|
| golem.yaml 中无 `provider` | 零影响 — 行为完全一致 |
| golem.yaml 中使用 `model`（无 provider） | 零影响 — 仍使用 `config.model` |
| 使用 `--api-key` CLI 参数 | 零影响 — apiKey 优先级不变 |
| 使用引擎原生配置（如 `~/.codex/config.toml`） | 零影响 — 未设置 `provider` 时原生配置仍生效 |
| 为现有配置添加 `provider` | Provider 生效；引擎级环境变量被注入。原生 CLI 配置可能被注入的环境变量覆盖 |

## 故障排查

### Claude Code：`apiKeyHelper did not return a valid value`

Claude Code 的用户级设置（`~/.claude/settings.json`）可能定义了与 provider 注入凭据冲突的 `apiKeyHelper`。

**GolemBot 的处理：** 在 provider 模式下，GolemBot 添加 `--setting-sources project,local` 以排除用户级设置。

**手动验证：**

```bash
HOME=/tmp/claude-clean-home \
ANTHROPIC_API_KEY="$YOUR_KEY" \
ANTHROPIC_BASE_URL="https://your-provider" \
ANTHROPIC_MODEL="your-model" \
CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 \
claude -p "say ok" --output-format stream-json --verbose --dangerously-skip-permissions
```

### 通用：错误密钥测试

故意使用错误的 API key 来确认 provider 路由已生效：

1. 将 `provider.apiKey` 设为 `"invalid-key"`
2. 运行一条 prompt — 应返回鉴权错误
3. 恢复正确的 key — 应成功

如果使用无效的 provider key 时调用仍然成功，说明引擎使用了其他鉴权来源（如全局环境变量或 CLI 存储的凭据）。

### 代理 / VPN（区域限制的 Provider）

部分 Provider（如 OpenRouter、OpenAI）有区域限制。终端会话默认不继承系统 VPN 设置。

```bash
export https_proxy=http://127.0.0.1:7890
export http_proxy=http://127.0.0.1:7890

# 验证
curl -s https://ipinfo.io/country   # 应返回非 CN
```

将以上配置添加到 `.env` 或 shell profile 中以持久化。
