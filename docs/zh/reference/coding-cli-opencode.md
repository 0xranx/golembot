# OpenCode CLI

### 官方文档

**核心文档：**

- 介绍：https://opencode.ai/docs
- 配置：https://opencode.ai/docs/config
- CLI 命令参考：https://opencode.ai/docs/cli
- 提供商（75+ LLM 提供商）：https://opencode.ai/docs/providers
- 代理系统：https://opencode.ai/docs/agents
- 技能（Agent Skills）：https://opencode.ai/docs/skills
- 规则（AGENTS.md）：https://opencode.ai/docs/rules
- 权限系统：https://opencode.ai/docs/permissions
- 内置工具：https://opencode.ai/docs/tools
- 自定义工具：https://opencode.ai/docs/custom-tools
- 模型配置：https://opencode.ai/docs/models

**扩展能力：**

- MCP 服务器：https://opencode.ai/docs/mcp-servers
- 插件系统：https://opencode.ai/docs/plugins
- HTTP Server API：https://opencode.ai/docs/server
- Web 界面：https://opencode.ai/docs/web
- ACP 协议：https://opencode.ai/docs/acp

**部署 & CI/CD：**

- GitHub Actions：https://opencode.ai/docs/github
- 网络 / 代理：https://opencode.ai/docs/network
- 企业版：https://opencode.ai/docs/enterprise

**项目信息：**

- GitHub：https://github.com/anomalyco/opencode（113K+ stars）
- npm 包：`opencode-ai`
- 版本：v1.1.28（截至 2026-03）

---

### 核心定位差异

**OpenCode 不是像 Cursor/Claude Code 那样的"IDE 配套 CLI" — 它是独立的开源 AI 编程代理。**它直接调用 LLM API（通过 AI SDK + Models.dev），实现了自己的工具系统（bash/read/write/edit/grep/glob 等），并独立管理会话和上下文。

与 Cursor Agent 和 Claude Code 的关键区别：

| | Cursor Agent | Claude Code | OpenCode |
|---|---|---|---|
| 本质 | Cursor IDE 的 CLI 模式 | Anthropic 的 CLI 代理 | 独立的开源代理 |
| LLM | Cursor 后端（带路由） | Anthropic API | 75+ 提供商可选 |
| 工具 | Cursor 内置 | Claude Code 内置 | 自研 + MCP + 自定义 |

---

### 安装

**前置条件**：Node.js >= 18（npm 安装）或 Go >= 1.22（源码编译）

**通过 npm 安装**（推荐）：

```bash
npm install -g opencode-ai
```

**替代方式 — 通过 Go 安装：**

```bash
go install github.com/anomalyco/opencode@latest
```

**验证安装：**

```bash
opencode --version
```

---

### 实际调用方式（已在 GolemBot 中验证）

**二进制文件路径**：取决于 Node 版本管理器，如 `~/.nvm/versions/node/v22.10.0/bin/opencode`

```bash
opencode run "user message" \
  --format json \
  --model provider/model \
  [--session <sessionId>] \
  [--continue] \
  [--agent <agentName>] \
  [--attach http://localhost:4096]
```

**不需要 PTY**。OpenCode 是标准 CLI；普通 `child_process.spawn()` 即可（与 Claude Code 相同）。

**关键参数说明：**

| 参数 | 效果 | 备注 |
|------|------|------|
| `--format json` | 输出原始 JSON 事件（NDJSON） | 替代默认的格式化文本输出 |
| `--model provider/model` | 指定模型（如 `anthropic/claude-sonnet-4-5`） | 格式为 `provider/model`，不像 Claude Code 那样用别名 |
| `--session <id>` | 恢复特定会话 | 会话 ID 格式：`ses_XXXXXXXX` |
| `--continue` / `-c` | 恢复最近的会话 | |
| `--fork` | 分叉会话（保留历史但使用新 ID） | 必须与 `--session` 或 `--continue` 配合使用 |
| `--agent <name>` | 指定代理（如 `build`、`plan`） | 默认是 `build`（完整功能） |
| `--attach <url>` | 连接到运行中的 serve 实例 | 避免冷启动，生产环境推荐 |
| `--port <n>` | 指定本地服务器端口 | 默认随机端口 |

---

### JSON 输出格式（`--format json`）

`opencode run --format json` 输出 NDJSON。**事件结构与 Cursor/Claude Code 的 stream-json 完全不同。**

#### 已观测的事件类型

**错误事件：**

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

**会话数据结构**（通过 `opencode export <sessionId>` 获取完整格式）：

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

**消息 parts 类型概览：**

| part.type | 含义 | 关键字段 |
|-----------|------|----------|
| `text` | 文本内容 | `text`, `time` |
| `step-start` | 推理步骤开始 | |
| `step-finish` | 推理步骤结束 | `reason`, `cost`, `tokens` |
| `reasoning` | 推理过程（思维链） | `text`, `time` |
| `tool-invocation` | 工具调用 | `toolName`, `args`, `result` |

**与 Cursor/Claude Code 的格式差异：**

| 方面 | Cursor | Claude Code | OpenCode |
|------|--------|-------------|----------|
| 流式格式 | `--output-format stream-json` | `--output-format stream-json` | `--format json` |
| 文本事件 | `type:"assistant"` | `type:"assistant"` + `content[].type:"text"` | part.type: `text` |
| 工具调用 | `type:"tool_call"` + started/completed | `type:"assistant"` + tool_use 块 | part.type: `tool-invocation` |
| 结束事件 | `type:"result"` | `type:"result"` | step-finish（带 cost/tokens） |
| 错误事件 | `type:"result"` + `is_error:true` | `type:"result"` + `is_error:true` | `type:"error"` + error 对象 |
| 元数据 | `duration_ms` | `duration_ms`, `total_cost_usd`, `num_turns` | `cost`, `tokens`（含推理 + 缓存明细） |
| ANSI | 无（2026.02+ 后 stdout 干净） | 无 | 无 |

**说明**：以上流式事件结构已通过 OpenRouter + Anthropic 模型的实际测试验证。GolemBot 中的 `OpenCodeEngine` 已完整实现并通过端到端测试。关键发现：OpenCode 以完整块发送文本内容（不是字符级 delta），类似于 Claude Code 不加 `--include-partial-messages` 时的行为。

---

### 替代方案：通过 HTTP Server API 集成

OpenCode 提供完整的 HTTP Server（OpenAPI 3.1 规范），给 GolemBot **两种集成方式**：

**方式 A：CLI 模式**（与 Cursor/Claude Code 相同）
```bash
opencode run --format json "prompt"
```

**方式 B：HTTP Server 模式**（OpenCode 独有）
```bash
opencode serve --port 4096
# → POST /session/:id/message { parts: [{ type: "text", text: "prompt" }] }
# → GET /event (SSE stream)
```

关键 HTTP Server API 端点：

| 方法 | 路径 | 用途 |
|------|------|------|
| `POST` | `/session` | 创建新会话 |
| `POST` | `/session/:id/message` | 发送消息（同步，等待完成） |
| `POST` | `/session/:id/prompt_async` | 异步发送消息 |
| `POST` | `/session/:id/abort` | 中止运行中的会话 |
| `GET` | `/session/:id/message` | 获取消息列表 |
| `GET` | `/event` | SSE 事件流 |
| `GET` | `/global/health` | 健康检查 |
| `DELETE` | `/session/:id` | 删除会话 |
| `POST` | `/session/:id/fork` | 分叉会话 |
| `POST` | `/session/:id/share` | 分享会话 |

HTTP 模式的优势：避免每次 `opencode run` 的冷启动（5-10 秒），复用单个服务器实例处理多个对话。

---

### 会话管理

| 操作 | CLI 命令 | 说明 |
|------|----------|------|
| 列出会话 | `opencode session list --format json` | 返回 JSON 数组 |
| 恢复会话 | `opencode run --session <id> "message"` | |
| 恢复最近的 | `opencode run --continue "message"` | |
| 分叉会话 | `opencode run --session <id> --fork "message"` | |
| 导出会话 | `opencode export <id>` | 完整 JSON（所有消息和 parts） |
| 导入会话 | `opencode import <file\|url>` | |
| 删除会话 | HTTP：`DELETE /session/:id` | 尚无直接 CLI 命令 |
| 查看统计 | `opencode stats` | Token 使用量和费用统计 |

**会话 ID 格式**：`ses_XXXXXXXXXXXXXXXX`（不同于 Cursor/Claude Code 的 UUID 格式）

---

### 认证方式

OpenCode 支持 75+ LLM 提供商；认证方式取决于选择的提供商：

| 方式 | 用例 | 设置 |
|------|------|------|
| `opencode auth login` / `/connect` | 本地开发 | 在 TUI 中交互式完成，凭据存储到 `~/.local/share/opencode/auth.json` |
| 提供商环境变量 | CI/CD、脚本 | `ANTHROPIC_API_KEY`、`OPENAI_API_KEY`、`OPENROUTER_API_KEY` 等 |
| OpenCode Zen / Go | 官方托管提供商 | 统一 API Key，经 OpenCode 团队验证 |
| `.env` 文件 | 项目级配置 | OpenCode 启动时自动从项目目录加载 `.env` |

**常用提供商环境变量：**

| 提供商 | 环境变量 | 模型格式示例 |
|--------|----------|-------------|
| Anthropic | `ANTHROPIC_API_KEY` | `anthropic/claude-sonnet-4-5` |
| OpenAI | `OPENAI_API_KEY` | `openai/gpt-5` |
| Google | `GOOGLE_GENERATIVE_AI_API_KEY` | `google/gemini-2.5-pro` |
| OpenRouter | `OPENROUTER_API_KEY` | `openrouter/anthropic/claude-sonnet-4-5` |
| Amazon Bedrock | `AWS_*` 系列 | `amazon-bedrock/...` |

**与 Cursor/Claude Code 的区别**：Cursor 只需 `CURSOR_API_KEY`，Claude Code 只需 `ANTHROPIC_API_KEY`。由于 OpenCode 支持多个提供商，你必须设置**所选提供商对应的**环境变量。在与 GolemBot 的 `InvokeOpts.apiKey` 集成时，需要知道目标提供商才能设置正确的环境变量名。

---

### 技能机制

OpenCode 的技能系统与 Claude Code 高度兼容。搜索路径：

| 位置 | 作用域 | 说明 |
|------|--------|------|
| `.opencode/skills/*/SKILL.md` | 项目级 | OpenCode 原生路径 |
| `.claude/skills/*/SKILL.md` | 项目级 | Claude Code 兼容（可通过 `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS=1` 禁用） |
| `.agents/skills/*/SKILL.md` | 项目级 | 通用标准路径 |
| `~/.config/opencode/skills/*/SKILL.md` | 全局 | 用户级 |
| `~/.claude/skills/*/SKILL.md` | 全局 | Claude Code 兼容 |
| `~/.agents/skills/*/SKILL.md` | 全局 | 通用标准 |

**技能发现机制**：OpenCode 从当前目录向上遍历到 git 工作树根目录，沿途加载所有匹配的 `skills/*/SKILL.md`。

**按需加载**：代理启动时，只有技能名称和描述可见（注入到 `skill` 工具描述中）；当代理决定使用某个技能时，通过 `skill({ name: "xxx" })` 工具调用加载完整内容。

**SKILL.md frontmatter 要求：**

```yaml
---
name: git-release          # 必填，须与目录名一致，小写 + 连字符
description: Create releases  # 必填，1-1024 字符
license: MIT               # 可选
compatibility: opencode    # 可选
metadata:                  # 可选，字符串到字符串的映射
  audience: maintainers
---
```

**GolemBot 的注入策略选项：**
- 选项 1：软链接到 `.opencode/skills/`（最规范）
- 选项 2：软链接到 `.agents/skills/`（通用标准，未来其他代理也能读取）
- 选项 3：复用 Claude Code 的 `.claude/skills/` 软链接（OpenCode 兼容读取）

---

### 规则 / AGENTS.md

OpenCode 的规则系统与 GolemBot 的 `AGENTS.md` 生成机制完美兼容：

| 位置 | 优先级 | 说明 |
|------|--------|------|
| `AGENTS.md`（项目根目录） | 高 | OpenCode 原生，优先于 CLAUDE.md |
| `CLAUDE.md`（项目根目录） | 低 | 仅在没有 AGENTS.md 时使用 |
| `~/.config/opencode/AGENTS.md` | 全局 | 用户级规则 |
| `~/.claude/CLAUDE.md` | 全局回退 | 仅在没有全局 AGENTS.md 时使用 |

**额外指令文件**：`opencode.json` 中的 `instructions` 字段可引用额外文件（支持 glob 和远程 URL）：

```json
{ "instructions": ["CONTRIBUTING.md", "docs/guidelines.md", ".cursor/rules/*.md"] }
```

**对 GolemBot 的影响**：GolemBot 在 `init` 时生成的 `AGENTS.md` 会被 OpenCode 自动消费 — 不需要额外配置。

---

### 权限系统

OpenCode 的权限通过 `opencode.json` 配置，粒度比 Cursor/Claude Code 更细：

```json
{
  "permission": {
    "*": "allow",
    "bash": { "*": "ask", "git *": "allow", "rm *": "deny" },
    "edit": { "*": "allow", "*.env": "deny" }
  }
}
```

三个级别：`"allow"`（自动执行）、`"ask"`（请求批准）、`"deny"`（禁止）

**默认权限**：大多数操作默认为 `"allow"`；只有 `.env` 文件默认为 `"deny"`。**不需要类似 `--dangerously-skip-permissions` 的参数。**

**无头模式状态（v1.1.28）：**
- `opencode run` 在非交互模式下有已知 bug（[PR #14607](https://github.com/anomalyco/opencode/pull/14607)，尚未合并）
- Bug 1：`question` 工具在非交互模式下挂起（会话 deny 规则未传播到工具过滤层）
- Bug 2：配置为 `"ask"` 的权限在非交互模式下自动拒绝，导致工具执行失败
- **修复（在 PR 中）**：`"ask"` 权限在非交互模式下自动批准；新增 `--no-auto-approve` 标志
- **当前变通方案**：通过 `OPENCODE_PERMISSION='{"*":"allow"}'` 或 `opencode.json` 将所有权限设为 allow

---

### 代理系统

OpenCode 有内置的代理层级（GolemBot 可通过 `--agent` 参数利用）：

**主代理：**
- `build` — 默认，完整功能（可读写文件、执行命令）
- `plan` — 只读模式，分析和规划但不修改文件

**子代理：**
- `general` — 通用，可并行执行多个任务
- `explore` — 只读，快速代码搜索

支持自定义代理：通过 `opencode.json` 中的 `agent` 字段或 `.opencode/agents/*.md` 文件定义。

---

### MCP 支持

通过 `opencode.json` 配置（不是 `.cursor/mcp.json` 或 `.claude/mcp.json`）：

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

支持两种类型：local（命令启动）和 remote（URL + 可选 OAuth）。

---

### 插件系统

OpenCode 提供完整的插件钩子机制（Cursor 和 Claude Code 都没有这个能力）：

```typescript
export const MyPlugin = async ({ project, client, $ }) => ({
  "tool.execute.before": async (input, output) => { /* 工具执行前 */ },
  "tool.execute.after": async (input, output) => { /* 工具执行后 */ },
  event: async ({ event }) => { /* 事件监听 */ },
});
```

插件放在 `.opencode/plugins/`（项目级）或 `~/.config/opencode/plugins/`（全局），也可以作为 npm 包安装。

---

### GitHub Actions 集成

```yaml
- uses: anomalyco/opencode/github@latest
  with:
    model: anthropic/claude-sonnet-4-20250514
    # prompt: "optional custom prompt"
    # agent: "build"
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

支持的触发事件：`issue_comment`（/opencode 或 /oc）、`pull_request_review_comment`、`issues`、`pull_request`、`schedule`、`workflow_dispatch`

---

### 配置文件

| 文件 | 位置 | 内容 |
|------|------|------|
| `opencode.json` | 项目根目录 | 项目级配置（模型、权限、MCP、代理、工具等） |
| `opencode.json` | `~/.config/opencode/` | 全局配置 |
| `auth.json` | `~/.local/share/opencode/` | 提供商凭据 |
| `.opencode/agents/*.md` | 项目级 | 自定义代理 |
| `.opencode/plugins/*.ts` | 项目级 | 自定义插件 |
| `.opencode/tools/*.ts` | 项目级 | 自定义工具 |
| `.opencode/skills/*/SKILL.md` | 项目级 | 技能定义 |

配置优先级（后者覆盖前者）：远程配置 → 全局 → 项目 → 自定义路径 → `OPENCODE_CONFIG_CONTENT` 环境变量

---

### 已知坑点 & GolemBot 适配说明

1. **冷启动慢（5-10 秒）** — OpenCode 启动时要加载提供商配置、MCP 服务器等，比 Cursor/Claude Code 慢很多。生产环境建议用 `opencode serve` + `--attach` 模式复用服务器实例
2. **`--format json` 事件结构与 Cursor/Claude Code 完全不同** — 不能复用 `parseStreamLine()` 或 `parseClaudeStreamLine()`；需要独立的 `parseOpenCodeStreamLine()`
3. **无头模式有已知 bug** — v1.1.28 中，`opencode run` 的 question 工具可能挂起，`"ask"` 权限会自动拒绝。建议显式设置 `permission: "allow"` 作为变通方案
4. **多提供商认证复杂** — 不像 Cursor/Claude Code 各只需一个环境变量，OpenCode 需要所选提供商对应的 API Key。与 GolemBot 的 `InvokeOpts.apiKey` 集成时，需要知道目标提供商才能设置正确的环境变量名
5. **技能多路径自动发现** — OpenCode 同时读取 `.opencode/skills/`、`.claude/skills/`、`.agents/skills/`。如果 GolemBot 同时为 Claude Code 和 OpenCode 注入技能，不会冲突（相同的技能只加载一次）
6. **AGENTS.md 自动消费** — GolemBot 在 init 时生成的 AGENTS.md 会被 OpenCode 自动消费 — 这是正面的兼容性特征
7. **会话 ID 格式不同** — `ses_XXXXXXXX` 而非 UUID；GolemBot 的会话存储层需要适配
8. **HTTP Server API 是更好的集成方式** — 相比 CLI spawn 模式，HTTP 模式消除了冷启动，支持中止操作（`POST /session/:id/abort`），可能是更好的引擎实现方式
9. **`opencode.json` 需要在 init 时生成** — 类似 Cursor 的 `.cursor/cli.json`，OpenCode 的项目配置需要在工作区初始化时生成
10. **OpenCode 迭代极快** — 截至 2026-03 已到 v1.1.28；API 可能频繁变化，需关注 changelog
