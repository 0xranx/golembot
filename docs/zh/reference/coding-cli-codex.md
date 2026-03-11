# Codex CLI

### 官方文档

- **文档首页:** https://developers.openai.com/codex
- **GitHub:** https://github.com/openai/codex
- **非交互式 (exec) 指南:** https://developers.openai.com/codex/noninteractive/
- **CLI 参考:** https://developers.openai.com/codex/cli/reference/
- **AGENTS.md 指南:** https://developers.openai.com/codex/guides/agents-md/
- **认证:** https://developers.openai.com/codex/auth/
- **安全 / 沙箱:** https://developers.openai.com/codex/security
- **模型:** https://developers.openai.com/codex/models/
- **SDK:** https://developers.openai.com/codex/sdk/
- **App Server 协议:** https://developers.openai.com/codex/app-server/
- **更新日志:** https://developers.openai.com/codex/changelog/

OpenAI Codex CLI 是一个开源（Rust，96%）的终端编程代理。它可以在选定目录中读取、编辑和运行你机器上的代码。2025 年 4 月发布。支持 macOS 和 Linux；Windows 实验性支持（通过 WSL）。

---

### 安装

```bash
# npm (全局)
npm install -g @openai/codex

# Homebrew (macOS)
brew install codex

# GitHub Releases 平台二进制文件
# macOS Apple Silicon: codex-aarch64-apple-darwin.tar.gz
# macOS x86_64:        codex-x86_64-apple-darwin.tar.gz
# Linux x86_64 (musl): codex-x86_64-unknown-linux-musl.tar.gz
# Linux arm64 (musl):  codex-aarch64-unknown-linux-musl.tar.gz
```

二进制文件名: `codex`。npm 包: `@openai/codex`。

---

### 实际调用方式（GolemBot 验证）

GolemBot 集成的非交互式无头调用：

```bash
# 新会话
codex exec --json --full-auto --skip-git-repo-check "prompt here"

# 恢复会话
codex exec resume --json --full-auto --skip-git-repo-check <SESSION_ID> "continue the refactor"
```

关键标志：

| 标志 | 用途 |
|------|------|
| `--json` | 向 stdout 输出 JSONL 事件流（机器可读） |
| `--full-auto` | 快捷方式: `--sandbox workspace-write --ask-for-approval on-request` |
| `--skip-git-repo-check` | 允许在 Git 仓库外运行（临时目录、CI 工作区） |
| `--dangerously-bypass-approvals-and-sandbox` / `--yolo` | 禁用所有安全检查 — 仅在隔离容器中使用 |
| `--model <id>` | 覆盖模型（仅 API key 模式） |
| `--cd <path>` | 处理前设置工作目录 |
| `--ephemeral` | 跳过会话持久化 |

**标志位置:** 全局标志必须放在子命令**之后**：
```bash
codex exec --json --full-auto "prompt"   # ✅ 正确
codex --json exec "prompt"               # ❌ 错误
```

**Resume 子命令标志位置:** 恢复时，所有标志放在 `resume` 之后：
```bash
codex exec resume --json --full-auto --skip-git-repo-check <id> "prompt"   # ✅ 正确
codex exec --json --full-auto resume <id> "prompt"                          # ❌ 错误
```

**stdout 与 stderr 分离（集成关键）：**
- `stdout` — 纯 JSONL 事件（仅当设置 `--json` 时）
- `stderr` — 配置摘要、进度指示器、警告

使用 `stdio: ['pipe', 'pipe', 'pipe']` 启动进程，独立消费 stdout/stderr。

---

### stream-json 输出格式

`codex exec --json` 向 stdout 输出每行一个完整 JSON 对象（NDJSON）。事件**不是** SSE，只是换行分隔的 JSON。

#### 事件类型概览

| 类型 | 描述 |
|------|------|
| `thread.started` | 会话初始化；包含 `thread_id` |
| `turn.started` | 新对话轮次开始 |
| `turn.completed` | 轮次完成；包含 `usage`（输入/输出 token 数） |
| `turn.failed` | 轮次遇到错误 |
| `item.started` | 一个工作项已开始 |
| `item.updated` | 工作项流式增量 |
| `item.completed` | 工作项完成；包含最终内容 |
| `error` | 顶层错误事件 |

#### `item.type` 值（在 `item.started` / `item.completed` 中）

| 项目类型 | 描述 |
|----------|------|
| `agent_message` | 面向用户的文本回复 — 读取 `item.text` |
| `reasoning` | 模型内部推理 |
| `command_execution` | 代理执行的 Shell 命令 |
| `file_change` | 代理修改的文件 |
| `mcp_tool_call` | MCP 服务器工具调用 |
| `web_search` | 实时网页搜索（需要 `--search` 标志） |
| `todo_list` | 计划/任务列表更新 |
| `error` | 项目内的错误 |

#### 示例事件（精确字段名）

```json
{"type":"thread.started","thread_id":"0199a213-81c0-7800-8aa1-bbab2a035a53"}
{"type":"turn.started"}
{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"bash -lc ls","status":"in_progress"}}
{"type":"item.completed","item":{"id":"item_3","type":"agent_message","text":"Here is the analysis..."}}
{"type":"turn.completed","usage":{"input_tokens":24763,"cached_input_tokens":24448,"output_tokens":122}}
```

#### GolemBot 解析策略

```
thread.started  → 提取 thread_id → 保存为 sessionId（不 yield）
item.completed + item.type === "agent_message" → yield { type: 'text', content: item.text }
  （回退: item.content[].output_text 拼接，用于 OpenAI API 风格格式）
item.completed + item.type === "command_execution" → yield { type: 'tool_call', name: item.command, args: '' }
  + (如有 item.output) yield { type: 'tool_result', content: item.output }
turn.completed  → yield { type: 'done', sessionId }
  注意: Codex 不提供每次请求的费用；不输出 costUsd。
turn.failed / error → yield { type: 'error', message: ... }
顶层 error (Reconnecting... X/Y) → 抑制（WebSocket 重连噪音，非真实错误）
```

**已知限制（GitHub issue #5028, PR #4525）：** `mcp_tool_call` 项目在 `--json` 输出中**不包含**工具参数或结果 — 仅有服务器/工具名称。这是一个有意的改动，破坏了一些集成。完整的工具跟踪仅通过 App Server 协议可用。

---

### 会话恢复

会话存储在 `~/.codex/sessions/`（或 `$CODEX_HOME/sessions/`）下。

```bash
# 恢复指定会话（非交互式）
codex exec resume --json --full-auto --skip-git-repo-check <SESSION_ID> "continue the refactor"

# 恢复最近会话（非交互式）
codex exec resume --last "next step"

# 也考虑所有目录（不仅仅是 cwd）
codex exec resume --last --all "next step"
```

**捕获会话 ID：** `thread.started` 事件中的 `thread_id` 是编程获取会话 ID 的唯一方式。没有单独的环境变量或标志（待实现功能请求: issue #8923）。

---

### 认证方式

两种认证路径：

| 方式 | 用例 | 计费 |
|------|------|------|
| ChatGPT OAuth (浏览器) | 交互式使用, ChatGPT 订阅用户 | ChatGPT 订阅 |
| API key | CI/CD, 无头, 编程使用 | OpenAI API 按 token 计费 |

注意: Codex Cloud 任务仅在 ChatGPT 认证下可用，不支持 API key。

**环境变量：**

| 变量 | 用途 |
|------|------|
| `CODEX_API_KEY` | API 认证模式的主要环境变量（官方 CI 文档） |
| `OPENAI_API_KEY` | 同样接受；两个都设置以确保最大兼容性 |
| `OPENAI_BASE_URL` | 覆盖 API 端点（代理 / Azure） |
| `CODEX_HOME` | 覆盖默认的 `~/.codex` 状态目录 |

**无头 / CI 认证：**
```bash
# 使用 API key 预登录（存储在 ~/.codex/auth.json）
printenv OPENAI_API_KEY | codex login --with-api-key

# 单次运行内联
CODEX_API_KEY="sk-..." codex exec --json "run tests"

# 远程机器的设备代码流程
codex login --device-code
```

**ChatGPT OAuth (浏览器登录)** — 适用于 ChatGPT Plus/Pro/Team/Enterprise 订阅用户：
```bash
codex login    # 打开浏览器；凭证存储在 ~/.codex/auth.json
```
GolemBot 自动使用存储的 OAuth 凭证 — 无需额外配置。

> **模型兼容性：** `codex-mini-latest` 仅在 API key 模式下可用。使用 ChatGPT OAuth 时，不要设置 `model`，让 Codex 根据你的订阅自动选择合适的模型。

**已知异常（issues #2638, #3286）：** 如果同时存在 ChatGPT 会话和 `OPENAI_API_KEY`，不同版本的行为可能不一致。对于 CI/CD，明确使用 API key 登录以避免歧义。

---

### 技能发现

Codex 支持两种技能发现机制：

#### 1. `.agents/skills/`（原生技能目录）

每个技能是一个包含 `SKILL.md` 的目录，可选 frontmatter（`name`, `description`）：

- **全局:** `~/.agents/skills/`
- **项目级:** `.agents/skills/`

Codex 自动发现技能目录并使用渐进式披露（先加载技能描述，按需加载完整内容）。

**GolemBot 注入技能**的方式是将每个 `skills/<name>` 目录 symlink 到 `.agents/skills/<name>`。

#### 2. `AGENTS.md`（项目指令）

Codex 在开始工作前读取 `AGENTS.md` 文件。发现顺序：

1. **全局** (`~/.codex/`): `AGENTS.override.md` → `AGENTS.md`
2. **项目** (Git root 到 cwd): 逐层遍历，读取 `AGENTS.override.md` → `AGENTS.md` → 配置的回退文件名
3. **合并**: 文件从 root → 最内层拼接；内层覆盖外层

`~/.codex/config.toml` 中的配置：
```toml
project_doc_fallback_filenames = ["TEAM_GUIDE.md", ".agents.md"]
project_doc_max_bytes = 65536    # 默认每个文件 32 KiB
```

**GolemBot** 还在工作区根目录生成 `AGENTS.md`，包含技能描述和项目指令。

**受保护目录（即使在 workspace-write 模式下也始终只读）：**
- `.git/`
- `.agents/`
- `.codex/`

---

### 权限系统

#### 沙箱模式（物理能力）

| 模式 | 描述 |
|------|------|
| `read-only` | `codex exec` 的默认模式。浏览文件，不能写入，不能访问网络 |
| `workspace-write` | 读 + 在工作目录内写入。默认不能访问网络 |
| `danger-full-access` | 无限制，包括网络。仅在隔离容器中使用 |

#### 审批策略（何时暂停）

| 策略 | 行为 |
|------|------|
| `untrusted` | 仅已知安全的只读命令自动运行；其他都需要确认 |
| `on-request` | 模型决定何时请求审批 |
| `never` | 从不提示 — 与 `danger-full-access` 配合用于完全自动化 |

**`--full-auto`** = `--sandbox workspace-write` + `--ask-for-approval on-request`
**`--yolo`** = 禁用所有沙箱和审批（仅在 Docker/隔离环境中使用）

**`codex exec` (无头) 的默认行为：** 审批策略默认为 `never`，会**自动取消**所有征求请求（MCP 审批提示、沙箱升级）。使用 `--full-auto` 时，策略变为 `on-request`，自动批准命令而不是取消。

#### 各操作系统沙箱实现

| 操作系统 | 机制 |
|----------|------|
| macOS | `sandbox-exec` (Seatbelt 策略) |
| Linux | Landlock + seccomp；可选 `bwrap` 用于网络代理 |
| Windows (WSL) | WSL 内使用 Linux 机制 |

---

### 模型配置

2026 年初的模型（可能变化；查看 https://developers.openai.com/codex/models/）：

| 模型 ID | 描述 |
|---------|------|
| `5.3-codex` | 最新全尺寸模型；2026 年 2 月起对 API 用户可见 |
| `codex-1` | 原始基于 o3 的发布模型，为软件工程调优 |
| `codex-mini-latest` | 基于 o4-mini，低延迟，高性价比（仅 API key 模式） |

切换模型：
```bash
codex exec --model codex-mini-latest --json "your task"
```

或在 `~/.codex/config.toml` 中：
```toml
model = "codex-mini-latest"
```

---

### 已知踩坑与 GolemBot 适配说明

1. **`--json` 标志位置**: 必须放在 `exec` 子命令之后 — `codex exec --json`，而不是 `codex --json exec`。

2. **`resume` 是子命令，不是标志**: `codex exec resume <id> "prompt"` — 所有标志必须放在 `resume` 之后，不能放在之前。

3. **`--skip-git-repo-check` 必须**: 没有此标志，Codex 拒绝在 Git 仓库外运行。GolemBot 使用临时目录，所以此标志是必需的。

4. **工具调用参数缺失 (#5028)**: `--json` 输出中 `mcp_tool_call` 项目不包含参数或结果。仅工具名称可用。使用 App Server 协议获取完整跟踪。

5. **会话 ID 仅在 JSONL 流中**: `thread.started` 事件中的 `thread_id` 是编程捕获会话 ID 的唯一方式。没有环境变量（issue #8923）。

6. **双重凭证的认证冲突**: 同时存在 ChatGPT 会话 + `OPENAI_API_KEY` 可能导致不可预测的认证行为。对于 CI，明确使用 `codex login --with-api-key`。

7. **`codex exec` 默认自动取消审批**: 没有 `--full-auto`，代理在无头模式下自动取消任何权限升级请求 — 需要提升权限的任务会静默失败。GolemBot 集成时始终使用 `--full-auto`。

8. **WebSocket 重连噪音（OAuth 模式）**: Codex Cloud（ChatGPT OAuth 使用）总是在 WebSocket 连接失败后重试 4 次再回退到 HTTPS。这会在重试期间输出 `{"type":"error","message":"Reconnecting... X/5 ..."}` 事件。GolemBot 自动抑制这些 — 它们不是真实错误。

9. **`codex-mini-latest` 模型与 OAuth 不兼容**: `codex-mini-latest` 仅在 API key 模式下可用。使用 ChatGPT OAuth 时不要设置 `model: codex-mini-latest` — 让 Codex 自动选择模型。

10. **没有 `--session-key` 概念**: 会话通过存储在 `~/.codex/sessions/` 中的内部 UUID 标识。GolemBot 必须从 `thread.started` 捕获 `thread_id` 并将其持久化为 sessionId。

11. **TTY 回显 bug (#3646)**: 代理执行的命令中交互式 `sudo` 提示可能导致终端挂起。避免在 prompt 中使用 sudo。

12. **输入大小上限**: 自 v0.106.0 起共享 ~1M 字符输入上限，防止超大输入导致挂起。

13. **快速发布节奏**: Codex CLI 迭代很快；在 CI 中使用前，先用已安装版本的 `codex exec --help` 验证标志语法。
