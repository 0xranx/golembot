# Claude Code CLI

### 官方文档

**核心文档：**

- 概览：https://code.claude.com/docs/en/overview
- CLI 参考（完整命令 + 参数列表）：https://code.claude.com/docs/en/cli-reference
- Claude Code 工作原理（架构 + 工具）：https://code.claude.com/docs/en/how-claude-code-works
- 编程式运行 / 无头模式：https://code.claude.com/docs/en/headless
- 记忆 & CLAUDE.md：https://code.claude.com/docs/en/memory
- 技能：https://code.claude.com/docs/en/skills
- 认证：https://code.claude.com/docs/en/authentication
- 权限：https://code.claude.com/docs/en/permissions
- 设置：https://code.claude.com/docs/en/settings
- 模型配置：https://code.claude.com/docs/en/model-config

**扩展能力：**

- MCP（模型上下文协议）：https://code.claude.com/docs/en/mcp
- 子代理：https://code.claude.com/docs/en/sub-agents
- Hooks：https://code.claude.com/docs/en/hooks-guide
- 插件：https://code.claude.com/docs/en/plugins

**部署 & CI/CD：**

- GitHub Actions：https://code.claude.com/docs/en/github-actions
- GitLab CI/CD：https://code.claude.com/docs/en/gitlab-ci-cd
- 费用：https://code.claude.com/docs/en/costs

**Agent SDK（TypeScript / Python）：**

- SDK 概览：https://platform.claude.com/docs/en/agent-sdk/overview
- 流式输出：https://platform.claude.com/docs/en/agent-sdk/streaming-output
- 会话：https://platform.claude.com/docs/en/agent-sdk/sessions

**stream-json 事件格式速查表：**

- 第三方总结：https://takopi.dev/reference/runners/claude/stream-json-cheatsheet/

**完整文档索引（LLM 友好）：**

- https://code.claude.com/docs/llms.txt

---

### 安装

**前置条件**：Node.js >= 18

```bash
npm install -g @anthropic-ai/claude-code
```

**验证安装：**

```bash
claude --version
```

---

### 实际调用方式（已在 GolemBot 中验证）

**二进制文件路径**：`~/.local/bin/claude`（与 Cursor Agent 的 `agent` 同目录）

```bash
~/.local/bin/claude \
  -p "user message" \
  --output-format stream-json \
  --verbose \
  --dangerously-skip-permissions \
  [--resume <sessionId>] \
  [--model <model-alias>]
```

**不需要 PTY**。Claude Code CLI 支持标准 stdin/stdout — 普通 `child_process.spawn()` 即可。所有引擎（Cursor、Claude Code、OpenCode、Codex）现在都使用相同的 `child_process.spawn` 方式。

---

### stream-json 输出格式

每行一个 JSON 对象（NDJSON）；stdout 输出纯 JSON，无 ANSI 转义序列。

#### 事件类型概览

| 类型 | 子类型 | 含义 | 关键字段 |
|------|--------|------|----------|
| `system` | `init` | 初始化 | `session_id`, `model`, `cwd`, `tools[]`, `mcp_servers[]`, `apiKeySource` |
| `assistant` | — | 助手回复（文本 / 工具调用） | `session_id`, `message.content[]` — 可能包含 `text` 和 `tool_use` 块 |
| `user` | — | 工具执行结果 | `session_id`, `message.content[].type:"tool_result"` |
| `result` | `success` | 对话正常结束 | `session_id`, `duration_ms`, `duration_api_ms`, `total_cost_usd`, `num_turns`, `result`, `usage` |
| `result` | `error` | 对话异常结束 | `is_error: true`, `result`（错误信息）, `permission_denials[]` |

#### 与 Cursor 的关键格式差异

| 方面 | Cursor Agent | Claude Code |
|------|-------------|-------------|
| 文本消息 | `type:"assistant"` + `message.content[].type:"text"` | 结构相同 |
| 工具调用开始 | `type:"tool_call"`, `subtype:"started"` | `type:"assistant"` + `message.content[].type:"tool_use"` |
| 工具调用结果 | `type:"tool_call"`, `subtype:"completed"` | `type:"user"` + `message.content[].type:"tool_result"` |
| 扩展结果字段 | `duration_ms` | `duration_ms`, `duration_api_ms`, `total_cost_usd`, `num_turns`, `usage` |
| ANSI 序列 | 无（2026.02+ 后 stdout 干净） | 无（纯 stdout） |
| 混合内容 | 从不 | **单条 assistant 消息可同时包含 text 和 tool_use 块** |

#### Assistant 消息示例

**纯文本回复：**

```json
{"type":"assistant","session_id":"session_01","message":{"id":"msg_1","type":"message","role":"assistant","content":[{"type":"text","text":"Planning next steps."}],"usage":{"input_tokens":120,"output_tokens":45}}}
```

**工具调用：**

```json
{"type":"assistant","session_id":"session_01","message":{"id":"msg_2","type":"message","role":"assistant","content":[{"type":"tool_use","id":"toolu_1","name":"Bash","input":{"command":"ls -la"}}]}}
```

**工具结果（user 事件）：**

```json
{"type":"user","session_id":"session_01","message":{"id":"msg_3","type":"message","role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_1","content":"total 2\nREADME.md\nsrc\n"}]}}
```

工具结果的 content 可以是字符串或数组格式：

```json
{"type":"tool_result","tool_use_id":"toolu_2","content":[{"type":"text","text":"Task completed"}]}
```

#### Result 事件示例

```json
{"type":"result","subtype":"success","session_id":"session_01","total_cost_usd":0.0123,"is_error":false,"duration_ms":12345,"duration_api_ms":12000,"num_turns":2,"result":"Done.","usage":{"input_tokens":150,"output_tokens":70,"service_tier":"standard"}}
```

```json
{"type":"result","subtype":"error","session_id":"session_02","total_cost_usd":0.001,"is_error":true,"duration_ms":2000,"result":"","error":"Permission denied","permission_denials":[{"tool_name":"Bash","tool_use_id":"toolu_9","tool_input":{"command":"git fetch origin main"}}]}
```

#### `--include-partial-messages` 行为

不加此参数时，`assistant` 事件包含完整消息（每条消息完成后一次性输出）。
加上此参数后，会额外输出 `stream_event` 类型事件，包含字符级增量 delta：

```json
{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hel"}}}
```

**流式事件序列**：`message_start` → `content_block_start` → `content_block_delta`（多个） → `content_block_stop` → `message_delta` → `message_stop` → 最后输出完整的 `assistant` 消息。

**GolemBot 第一阶段不使用** `--include-partial-messages` — 完整消息模式已经够用。字符级流式输出将在后续迭代中添加。

---

### 会话恢复

- `--resume <sessionId>` 恢复特定会话
- `--session-id <uuid>` 使用指定 UUID 作为会话 ID
- `--continue` / `-c` 恢复当前目录中最近的会话
- `--fork-session` 从现有会话分叉（保留历史但使用不同 ID）
- session_id 可从 `type: "system"` 初始化事件或 `type: "result"` 事件获取

**与 Cursor 的区别**：Cursor 只能从 result 事件获取 session_id；Claude Code 在 system 初始化事件中就提供了。

---

### 认证方式

| 方式 | 用例 | 设置 |
|------|------|------|
| `claude auth login` | 本地开发（推荐） | 浏览器 OAuth 流程 |
| `ANTHROPIC_API_KEY` 环境变量 | CI/CD、脚本、无头环境 | 从 https://console.anthropic.com/settings/keys 获取 |
| 云提供商（Bedrock/Vertex/Foundry） | 企业部署 | 平台特定的环境变量配置 |

**CI/CD 场景必须使用 API key** — `claude auth login` 需要浏览器交互。

---

### 技能 / CLAUDE.md 机制

Claude Code 的技能系统与 Cursor 有显著不同：

**CLAUDE.md（项目记忆）：**

| 位置 | 用途 | 加载时机 |
|------|------|----------|
| `./CLAUDE.md` 或 `./.claude/CLAUDE.md` | 项目级指令 | 会话启动时自动加载 |
| `~/.claude/CLAUDE.md` | 个人级指令（所有项目） | 会话启动时自动加载 |
| `./CLAUDE.local.md` | 个人项目级指令（不提交到 git） | 会话启动时自动加载 |

**技能（`.claude/skills/`）：**

- 类似 Cursor 的 `.cursor/skills/`，每个技能是包含 `SKILL.md` 的目录
- Claude Code 自动发现 `.claude/skills/` 下的技能
- 技能描述在会话启动时加载到上下文中；完整内容在使用时按需加载
- 支持 frontmatter 配置：`name`、`description`、`disable-model-invocation`、`allowed-tools`、`context: fork` 等
- 用户可通过 `/skill-name` 手动触发，Claude 也会自动判断何时使用

**GolemBot 的技能注入策略：**

| 引擎 | 注入方式 |
|------|----------|
| Cursor | 软链接 `skills/<name>` → `.cursor/skills/<name>` |
| Claude Code | 在工作区根目录生成 `CLAUDE.md`（包含技能描述和路径引用） |

---

### 权限 & 安全

| 参数 / 设置 | 效果 |
|-------------|------|
| `--dangerously-skip-permissions` | 跳过所有权限提示（无头模式必需） |
| `--allowedTools "Bash,Read,Edit"` | 允许指定工具免确认（更细粒度） |
| `--disallowedTools "Edit"` | 禁用指定工具 |
| settings.json 中的 `permissions.allow/deny` | 持久化权限规则 |

**GolemBot 使用 `--dangerously-skip-permissions`**（等同于 Cursor 的 `--force --trust --sandbox disabled`）。

---

### 模型配置

| 别名 | 对应模型 | 用例 |
|------|----------|------|
| `sonnet` | Sonnet 4.6（最新） | 日常编码 |
| `opus` | Opus 4.6（最新） | 复杂推理 |
| `haiku` | Haiku | 简单任务 |
| `opusplan` | Opus 用于规划阶段，Sonnet 用于执行 | 混合模式 |

可通过 `--model <alias>` 或 `ANTHROPIC_MODEL` 环境变量设置。

---

### MCP 支持

Claude Code 从 `.claude/mcp.json`（不是 `.cursor/mcp.json`）加载 MCP 配置。
CLI 支持 `--mcp-config ./mcp.json` 来加载额外的 MCP 配置。

---

### GitHub Actions 集成

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

### 已知坑点 & GolemBot 适配说明

1. **不需要 PTY** — 与 Cursor 最大的区别；简单的 `child_process.spawn` 就行
2. **不需要清除 ANSI** — stdout 是纯 JSON，不像 Cursor 的 PTY 输出会混入 ANSI 序列
3. **混合内容块** — 单条 assistant 消息可能同时包含 `text` 和 `tool_use`；需要拆分并分别处理
4. **tool_result 是 user 事件** — 不是 Cursor 的 `tool_call.subtype:"completed"`，而是独立的 `type:"user"` 事件
5. **session_id 在初始化时就可用** — 不需要等到 result 事件才能获取 session_id
6. **`--verbose` 是必需的** — 不加此参数，stream-json 只输出最终结果，不输出中间的 assistant/user 事件
7. **result 提供更多元数据** — `total_cost_usd`、`num_turns`、`duration_api_ms`、`usage` 都可以暴露给用户
8. **`--dangerously-skip-permissions` 是单个参数** — 不像 Cursor 需要三个参数：`--force --trust --sandbox disabled`
9. **权限绕过需要显式启用** — 必须先用 `--allow-dangerously-skip-permissions` 启用选项，然后用 `--dangerously-skip-permissions` 或 `--permission-mode bypassPermissions` 激活。或者直接使用 `--dangerously-skip-permissions`，它会隐式允许
10. **技能路径不同** — Cursor 用 `.cursor/skills/`，Claude Code 用 `.claude/skills/`；GolemBot 需要根据引擎选择注入方式
