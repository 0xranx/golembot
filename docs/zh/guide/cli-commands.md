# CLI 命令

GolemBot 提供一组 CLI 命令用于管理和运行助手。

## `golembot init`

初始化新的助手目录。

```bash
golembot init [-e <engine>] [-n <name>]
```

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `-e, --engine <engine>` | 引擎类型（`cursor`、`claude-code`、`opencode`、`codex`） | `cursor` |
| `-n, --name <name>` | 助手名称 | 交互式提示 |

## `golembot run`

启动交互式 REPL 对话。

```bash
golembot run [-d <dir>] [--api-key <key>]
```

**REPL 斜杠命令：**

| 命令 | 说明 |
|------|------|
| `/help` | 显示可用命令 |
| `/status` | 显示当前引擎、模型和技能 |
| `/engine [name]` | 查看或切换引擎 |
| `/model [list\|name]` | 查看、列出可用模型或切换模型 |
| `/skill` | 列出已安装技能 |
| `/cron list` | 列出所有定时任务 |
| `/cron run <id>` | 立即触发指定任务 |
| `/cron enable <id>` | 启用指定任务 |
| `/cron disable <id>` | 禁用指定任务 |
| `/cron del <id>` | 删除指定任务 |
| `/cron history <id>` | 查看指定任务的执行历史 |
| `/reset` | 清除当前会话 |
| `/quit`、`/exit` | 退出 REPL |

这些斜杠命令同样适用于 IM 通道（飞书、Telegram、Slack 等）和 HTTP API（通过 `POST /chat` 发送斜杠命令时返回 JSON 响应而非 SSE 流）。定时任务在 `golem.yaml` 的 [`tasks`](/zh/guide/configuration#tasks) 中配置。

支持 `"""` 分隔符的多行输入。完成时显示耗时和费用（如可用）。

## `golembot serve`

启动 HTTP SSE 服务。

```bash
golembot serve [-d <dir>] [-p <port>] [-t <token>] [--host <host>] [--api-key <key>]
```

详见 [HTTP API](/zh/api/http-api)。

## `golembot gateway`

启动 IM + HTTP 统一网关服务。

```bash
golembot gateway [-d <dir>] [-p <port>] [-t <token>] [--host <host>] [--api-key <key>] [--verbose]
```

读取 `golem.yaml` 中的 `channels` 配置，启动对应的 IM 适配器和 HTTP 服务。

Gateway 还会：
- 在 `GET /` 提供 **Web Dashboard**，包含实时指标、通道状态和快速测试面板。
- 自动注册到 **Fleet 目录**（`~/.golembot/fleet/`），供 `golembot fleet ls` 发现。

## `golembot fleet`

管理和查看所有运行中的 GolemBot 实例。

### `golembot fleet ls`

列出从 `~/.golembot/fleet/` 发现的所有运行中的 bot 实例。

```bash
golembot fleet ls [--json]
```

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `--json` | 输出完整实例详情和指标的 JSON | `false` |

每个 gateway 启动时自动注册，关闭时自动注销。崩溃的进程（stale entries）会通过 PID 存活检测自动清理。

当有通过 `fleet stop` 停止的 bot 时，也会显示：

```
  Stopped Instances (1)

  ○  beta-bot (cursor)
     Port 3001 · /path/to/beta-bot
```

### `golembot fleet stop`

终止一个运行中的 bot 实例（发送 SIGTERM）。bot 会被保存为已停止状态，可通过 `fleet start` 重启。

```bash
golembot fleet stop <name> [--json]
```

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `<name>` | Bot 名称（如 `fleet ls` 所示） | — |
| `--json` | 输出 JSON（Agent 友好） | `false` |

### `golembot fleet start`

重启一个之前停止的 bot 实例。bot 会在原来的目录和端口重新启动。

```bash
golembot fleet start <name> [--json]
```

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `<name>` | Bot 名称（如 `fleet ls` 停止列表所示） | — |
| `--json` | 输出 JSON（Agent 友好） | `false` |

### `golembot fleet serve`

启动 Fleet Dashboard Web 服务 — 所有运行中 bot 的聚合视图。

```bash
golembot fleet serve [-p <port>] [--host <host>]
```

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `-p, --port <port>` | HTTP 端口 | `4000` |
| `--host <host>` | 绑定地址 | `127.0.0.1` |

**Fleet Dashboard 功能：**
- 自动发现 `~/.golembot/fleet/` 中的所有运行中 bot
- 显示引擎、模型、运行时间、消息数和费用
- 每张 bot 卡片上有 Stop/Start 按钮
- 已停止的 bot 以虚线边框 + Start 按钮显示
- 链接到每个 bot 的独立 Dashboard
- 每 10 秒自动刷新
- 无 bot 运行时显示引导提示

**Fleet API 端点：**

| 端点 | 说明 |
|------|------|
| `GET /` | Fleet Dashboard HTML |
| `GET /api/fleet` | JSON：运行中实例 + 已停止实例 + 指标 |
| `POST /api/fleet/:name/stop` | 终止运行中的 bot（发送 SIGTERM） |
| `POST /api/fleet/:name/start` | 重启已停止的 bot |
| `GET /health` | `{ "status": "ok" }` |

## `golembot onboard`

运行交互式设置向导。

```bash
golembot onboard [-d <dir>] [--template <name>]
```

详见[引导向导](/zh/guide/onboard-wizard)。

## `golembot status`

显示当前助手配置信息：名称、引擎、模型、已安装技能、已配置通道和 Gateway 设置。

```bash
golembot status [-d <dir>] [--json]
```

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `-d, --dir <dir>` | 助手目录 | `.` |
| `--json` | 输出 JSON（适合程序调用） | `false` |

**JSON 输出示例：**

```json
{
  "name": "my-bot",
  "engine": "claude-code",
  "model": "claude-opus-4-6",
  "skills": [{ "name": "general", "description": "通用助手" }],
  "channels": ["telegram"],
  "gateway": { "port": 3000, "authEnabled": false },
  "directory": "/home/user/my-bot"
}
```

## `golembot skill`

管理助手目录中的技能。

```bash
golembot skill list [-d <dir>]          # 列出已安装技能
golembot skill add <source> [-d <dir>]  # 从路径添加技能
golembot skill remove <name> [-d <dir>] # 移除技能
```

## `golembot doctor`

运行前置条件检查：Node.js 版本、`golem.yaml`、引擎 CLI、API Key、技能目录。

```bash
golembot doctor [-d <dir>]
```

## 环境变量

| 变量 | 用于 | 说明 |
|------|------|------|
| `CURSOR_API_KEY` | Cursor 引擎 | Cursor API Key |
| `ANTHROPIC_API_KEY` | Claude Code 引擎 | Anthropic API Key |
| `OPENAI_API_KEY` | OpenCode 引擎 | OpenAI API Key |
| `GOLEM_TOKEN` | serve / gateway | HTTP Bearer 认证 Token |
| `GOLEM_PORT` | serve / gateway | HTTP 端口覆盖 |

CLI 启动时自动加载工作目录中的 `.env` 文件。
