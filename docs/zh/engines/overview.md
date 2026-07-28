# 引擎概览

GolemBot 支持五种 Coding Agent 引擎。对外暴露相同的 `StreamEvent` 接口 — 切换引擎只需改一行配置。

## 对比

| | Cursor | Claude Code | OpenCode | Codex | Grok Build |
|---|---|---|---|---|---|
| 二进制 | `agent` | `claude` | `opencode` | `codex` | `grok` |
| 输出格式 | stream-json | stream-json | NDJSON | NDJSON | streaming-json |
| 技能注入 | `.cursor/skills/` | `.claude/skills/` + `CLAUDE.md` | `.opencode/skills/` + `opencode.json` | `AGENTS.md` | `.grok/skills/` + `AGENTS.md` |
| 会话恢复 | `--resume <id>` | `--resume <id>` | `--session <id>` | `resume <thread_id>` | `--resume <id>` |
| API Key | `CURSOR_API_KEY` | `ANTHROPIC_API_KEY` | 取决于 Provider | `CODEX_API_KEY` | `XAI_API_KEY` |
| 权限跳过 | `--force --trust --sandbox disabled` | `--dangerously-skip-permissions` | `opencode.json` 权限配置 | 默认 `unrestricted`；`safe` 时使用 `--full-auto` | `--always-approve` |
| 费用追踪 | — | `costUsd`、`numTurns` | `costUsd`（累计） | — | — |

## 统一的 StreamEvent

无论使用哪个引擎，`assistant.chat()` 都产出相同的事件类型：

```typescript
type StreamEvent =
  | { type: 'text'; content: string }
  | { type: 'tool_call'; name: string; args: string }
  | { type: 'tool_result'; content: string }
  | { type: 'warning'; message: string }
  | { type: 'error'; message: string }
  | { type: 'done'; sessionId?: string; durationMs?: number;
      costUsd?: number; numTurns?: number };
```

::: info 一行切换
切换引擎只需修改 `golem.yaml` 中的 `engine` 字段。所有引擎暴露相同的 `StreamEvent` 接口——你的代码无需任何改动。
:::

## 如何选择

::: tip 不确定选哪个？
从 **Claude Code** 开始——综合体验最好，支持费用追踪，搭配 Anthropic 最新模型。随时可以切换。
:::

- **Cursor** — 如果你已经在用 Cursor IDE 并有订阅
- **Claude Code** — 综合体验最佳；提供费用和轮次追踪
- **OpenCode** — 开源，支持多 LLM Provider（Anthropic、OpenAI、OpenRouter 等）
- **Codex** — OpenAI 官方 CLI agent（`@openai/codex`），使用 `CODEX_API_KEY`，默认 `codex.mode: unrestricted`
- **Grok Build** — xAI `grok` CLI，使用 `XAI_API_KEY` 或 `grok login`

## 下一步

- [Cursor](/zh/engines/cursor) — 安装、鉴权、模型列表
- [Claude Code](/zh/engines/claude-code) — 安装、鉴权、费用追踪
- [OpenCode](/zh/engines/opencode) — 安装、多 Provider 配置
- [Codex](/zh/engines/codex) — 安装、API Key 模式
- [Grok Build](/zh/engines/grok) — 安装、鉴权、headless 流式
- [配置说明](/zh/guide/configuration) — 完整 `golem.yaml` 参考
