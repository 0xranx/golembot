# Grok Build 引擎

Grok 引擎调用 [Grok Build](https://grok.com) CLI（`grok`），即 xAI 的编码 Agent，支持 headless 流式输出。

## 前置条件

- 安装 **Grok Build**，并确保 `grok` 在 `PATH` 中（常见路径：`~/.grok/bin/grok`）
- 完成鉴权（二选一）：
  - **登录** — `grok login`（凭证在 `~/.grok/auth.json`）
  - **API Key** — 设置 `XAI_API_KEY`（来自 [console.x.ai](https://console.x.ai)）

## 配置

```yaml
# golem.yaml
name: my-bot
engine: grok
# model: grok-4.5   # 可选；省略则使用 Grok 默认模型
```

## 鉴权

### 交互式登录

```bash
grok login
```

### API Key（CI / 无头环境）

```bash
export XAI_API_KEY=xai-...
```

## GolemBot 调用方式

```bash
grok -p "<prompt>" \
  --output-format streaming-json \
  --cwd <workspace> \
  --always-approve \
  [--resume <sessionId>] \
  [-m <model>]
```

| 项 | 行为 |
|----|------|
| 输出 | NDJSON `streaming-json` → 统一 `StreamEvent` |
| Skills | 符号链接到 `.grok/skills/` |
| 规则 | 项目 `AGENTS.md`（由 GolemBot 生成） |
| 权限 | 默认 `--always-approve`；`skipPermissions: false` 时关闭 |
| MCP | 从 `golem.yaml` 的 `mcp` 写入 `.grok/config.toml` |
| 会话恢复 | 使用上一轮 `done` 中的 `sessionId` 调用 `--resume` |

## Doctor

```bash
golembot doctor
```

会检查 `grok` 是否在 PATH，以及 `XAI_API_KEY` 或 `~/.grok/auth.json` 是否可用。
