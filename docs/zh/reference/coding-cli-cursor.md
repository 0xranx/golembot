# Cursor Agent CLI

### 官方文档

- 概览：https://cursor.com/docs/cli/overview
- 安装：https://cursor.com/docs/cli/installation
- 使用 Agent：https://cursor.com/docs/cli/using
- Shell 模式：https://cursor.com/docs/cli/shell-mode
- MCP：https://cursor.com/docs/cli/mcp
- 无头模式：https://cursor.com/docs/cli/headless
- GitHub Actions：https://cursor.com/docs/cli/github-actions
- 斜杠命令：https://cursor.com/docs/cli/reference/slash-commands
- 参数：https://cursor.com/docs/cli/reference/parameters
- 认证：https://cursor.com/docs/cli/reference/authentication
- 权限：https://cursor.com/docs/cli/reference/permissions
- 配置：https://cursor.com/docs/cli/reference/configuration
- 输出格式：https://cursor.com/docs/cli/reference/output-format
- 终端设置：https://cursor.com/docs/cli/reference/terminal-setup

---

### 安装

**前置条件**：无 — Cursor CLI (`agent`) 是独立二进制文件，**不需要**安装 Cursor IDE。

**通过 curl 安装**（推荐）：

```bash
curl https://cursor.com/install -fsS | bash
```

会把 `agent` 二进制文件安装到 `~/.local/bin/agent`（Linux/macOS）或 `~/.cursor/bin/agent`（部分 CI 环境）。确保安装目录在 `PATH` 中：

```bash
echo "$HOME/.local/bin" >> ~/.bashrc   # 或 ~/.zshrc
# 在 GitHub Actions 中：
echo "$HOME/.cursor/bin" >> $GITHUB_PATH
```

**验证安装：**

```bash
agent --version
```

---

### 实际调用方式（已在 GolemBot 中验证）

**二进制文件名**：`agent`（不是 `cursor`）
**二进制文件路径**：`~/.local/bin/agent`

```bash
agent \
  -p "user message" \
  --output-format stream-json \
  --stream-partial-output \
  --workspace /path/to/assistant-dir \
  --force --trust --sandbox disabled \
  --approve-mcps \
  [--resume <sessionId>] \
  [--model <model-name>]
```

**不需要 PTY**（CLI 版本 2026.02+ 起）。已验证 `child_process.spawn` 在 stdout 上产生干净的 NDJSON，零 ANSI 转义序列。GolemBot 已将 `CursorEngine` 从 `node-pty` 迁移到标准 `child_process.spawn`，消除了唯一的原生 C++ 依赖。`stripAnsi()` 作为安全网保留，但预期不会被触发。

---

### stream-json 输出格式

每行一个 JSON 对象（NDJSON）。使用 `child_process.spawn`（CLI 版本 2026.02+ 已验证），stdout 产生干净的 JSON，无 ANSI 转义序列。`stripAnsi()` 作为安全网保留。

#### 事件类型概览

| 类型 | 子类型 | 含义 | 关键字段 |
|------|--------|------|----------|
| `system` | `init` | 初始化 | `session_id`, `model`, `cwd`, `apiKeySource` |
| `user` | — | 用户输入（回显） | `message.content[].text` |
| `assistant` | — | 助手回复 | `message.content[].text` — 数组，过滤 `type=text` 并拼接 |
| `tool_call` | `started` | 工具调用开始 | `call_id`, `tool_call.<XxxToolCall>.args` |
| `tool_call` | `completed` | 工具调用完成 | `call_id`, `tool_call.<XxxToolCall>.result` |
| `result` | `success` | 对话正常结束 | `session_id`, `duration_ms`, `result`（全文拼接） |
| `result` | `error` | 对话异常结束 | `is_error: true`, `result`（错误信息） |

#### `--stream-partial-output` 行为

不加此参数时，`assistant` 事件包含两次工具调用之间的**完整文本**（一次性输出）。
加上此参数后，`assistant` 事件变为**字符级增量 delta** — 需要拼接多个 `assistant` 事件才能得到完整文本。

**关键坑点**：每个分段（两次工具调用之间的文本）的所有 delta 发完后，Cursor 会额外发一个**汇总事件**，内容 = 该分段所有 delta 的拼接。如果不跳过汇总事件，**用户会看到每段文本重复出现两次**。GolemBot 在 CursorEngine 层通过累积文本比较来检测并跳过汇总事件。

**GolemBot 已启用此参数**，实现了真正的逐字符流式输出。

#### tool_call 结构

**标准结构（绝大多数工具）：**

```json
{
  "type": "tool_call",
  "subtype": "started",
  "call_id": "toolu_vrtx_01NnjaR886UcE8whekg2MGJd",
  "tool_call": {
    "readToolCall": {
      "args": { "path": "sales.csv" }
    }
  }
}
```

**完成事件包含结果：**

```json
{
  "type": "tool_call",
  "subtype": "completed",
  "call_id": "toolu_vrtx_01NnjaR886UcE8whekg2MGJd",
  "tool_call": {
    "readToolCall": {
      "args": { "path": "sales.csv" },
      "result": {
        "success": {
          "content": "product,date,quantity...",
          "totalLines": 54,
          "totalChars": 1254
        }
      }
    }
  }
}
```

**已知工具名称（key 不是固定枚举 — 必须用 `*ToolCall` 动态匹配）：**
- `readToolCall` — 读取文件
- `writeToolCall` — 写入文件
- `ShellToolCall` — 执行命令

**替代结构（部分工具使用 `function` 格式）：**

```json
{
  "type": "tool_call",
  "subtype": "started",
  "tool_call": {
    "function": {
      "name": "tool_name",
      "arguments": "{\"query\": \"test\"}"
    }
  }
}
```

**GolemBot 的解析策略：**
- `subtype: "started"` 或无 subtype → yield `{ type: 'tool_call', name, args }`
- `subtype: "completed"` → yield `{ type: 'tool_result', content }`（提取 result 字段）
- 同时处理 `*ToolCall` 和 `function` 两种结构

---

### 会话恢复

- `--resume <sessionId>` 参数让 Agent 在同一上下文中继续对话
- `--continue` 是 `--resume=-1` 的别名，恢复最近一次会话
- `agent ls` 列出所有历史会话
- session_id 从 `type: "result"` 事件的 `session_id` 字段获取
- 恢复失败表现为：Agent 进程以非零退出码退出，或 result 事件返回 `is_error: true`
- 失败消息通常包含 "resume" 或 "session" 关键词

**GolemBot 的降级策略**：检测到恢复失败 → 清除已保存的会话 → 不带 `--resume` 重试一次

---

### 认证方式

| 方式 | 用例 | 设置 |
|------|------|------|
| `agent login` | 本地开发（推荐） | 浏览器 OAuth 流程，凭据存储在本地 |
| `CURSOR_API_KEY` 环境变量 | CI/CD、脚本、无头环境 | 从 Cursor Dashboard → Integrations → User API Keys 获取 |
| `--api-key <key>` 参数 | 一次性调用 | 直接传入 |

**CI/CD 场景必须使用 API key** — `agent login` 需要浏览器交互。

---

### 技能自动发现机制

Cursor Agent 启动时会读取：
1. `.cursor/skills/` 目录下的所有 `SKILL.md` 文件
2. 项目根目录的 `AGENTS.md` 和 `CLAUDE.md`（如果存在）
3. `.cursor/rules/` 目录下的规则文件

Agent **自主决定**何时使用哪个技能 — 用户无需在提示词中指定。

GolemBot 的做法是将 `skills/<name>` 软链接到 `.cursor/skills/<name>`，每次调用前刷新软链接。

---

### 权限系统

可以通过 `~/.cursor/cli-config.json`（全局）或 `.cursor/cli.json`（项目级）配置细粒度权限：

| 格式 | 示例 | 效果 |
|------|------|------|
| `Shell(cmd)` | `Shell(git)`, `Shell(npm)` | 控制可执行哪些命令 |
| `Read(glob)` | `Read(src/**/*.ts)` | 控制可读取哪些文件 |
| `Write(glob)` | `Write(docs/**/**)` | 控制可写入哪些文件 |
| `WebFetch(domain)` | `WebFetch(*.github.com)` | 控制可访问哪些域名 |
| `Mcp(server:tool)` | `Mcp(datadog:*)` | 控制可使用哪些 MCP 工具 |

Deny 规则优先于 Allow 规则。在安全敏感场景（如 CI/CD 代码审查机器人）中很有价值。

---

### MCP 支持

Agent 自动检测并使用 `.cursor/mcp.json` 中配置的 MCP 服务器。
- `--approve-mcps` 参数跳过 MCP 批准提示（无头模式必需 — **GolemBot 已启用**）
- `agent mcp list` 显示已配置的 MCP 服务器
- `agent mcp list-tools <server>` 显示特定 MCP 服务器提供的工具

---

### Cloud Agent

- `-c` / `--cloud` 启动 Cloud Agent，将对话推送到云端持续执行
- 在交互式会话中，消息前缀 `&` 可将任务发送给 Cloud Agent
- 适合长时间运行的任务 — 用户不需要等待
- 在 cursor.com/agents 查看和继续云端任务

---

### 配置文件

| 文件 | 位置 | 内容 |
|------|------|------|
| `cli-config.json` | `~/.cursor/cli-config.json` | 全局配置（权限、vim 模式、网络代理等） |
| `cli.json` | `.cursor/cli.json`（项目级） | 仅权限配置 |

---

### GitHub Actions 集成

```yaml
- name: Install Cursor CLI
  run: |
    curl https://cursor.com/install -fsS | bash
    echo "$HOME/.cursor/bin" >> $GITHUB_PATH

- name: Run Cursor Agent
  env:
    CURSOR_API_KEY: ${{ secrets.CURSOR_API_KEY }}
  run: |
    agent -p "Your prompt here" --model gpt-5.2
```

---

### 已知坑点

1. **stdout 缓冲区不按行分割** — `data` 事件可能在任意字节边界触发；你必须手动维护缓冲区并按 `\n` 分割
2. **进程退出时缓冲区可能有残余数据** — 必须在 `close` 回调中排空剩余内容
3. **ANSI 清除作为安全网保留** — 使用 `child_process.spawn`（2026.02+）后，stdout 是干净的 JSON。`stripAnsi()` 保留是为了向后兼容可能通过 PTY 调用的旧版 CLI
4. **`--sandbox disabled` 是必需的** — 否则 Agent 在某些操作（如写文件）上会因权限问题失败
5. **`--force --trust` 是必需的** — 跳过交互式确认；否则 Agent 等待用户输入而挂起
6. **`--approve-mcps` 应始终包含** — 否则当存在 MCP 配置时，会交互式询问是否批准，导致无头模式挂起
7. **`--stream-partial-output` 导致汇总重复** — 每个分段的 delta 发完后，会额外发送一个汇总事件（内容 = 所有 delta 拼接）。消费者必须去重，否则文本会翻倍。GolemBot 通过累积比较检测汇总事件并跳过
8. **tool_call 有 started/completed 两种事件** — 如果不区分，每次工具调用会被处理两次
9. **tool_call 的 key 名称不固定** — 不能硬编码 `readToolCall`；必须动态匹配 `*ToolCall` 后缀，而且部分工具使用 `function` 结构
10. **`result` 事件的 `result` 字段是全文拼接** — 不只是最后一段，而是所有助手文本的拼接
