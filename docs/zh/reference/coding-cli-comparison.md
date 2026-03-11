# 四引擎对比矩阵

Cursor vs Claude Code vs OpenCode vs Codex — GolemBot 支持的所有引擎的并排参考对比。

## 基本属性

| 维度 | Cursor Agent | Claude Code | OpenCode | Codex CLI |
|------|-------------|-------------|----------|-----------| 
| 类型 | IDE 配套 CLI | 官方 CLI Agent | 独立开源 Agent | OpenAI 官方 CLI Agent |
| 开源 | 否 | 否 | 是 (Apache-2.0) | 是 (Apache-2.0, Rust) |
| LLM 支持 | Cursor 后端 (带路由) | 仅 Anthropic 模型 | 75+ 提供商 | OpenAI 模型 (codex-1, codex-mini-latest 等) |
| 安装 | `curl https://cursor.com/install -fsS \| bash` | `npm i -g @anthropic-ai/claude-code` | `npm i -g opencode-ai` | `npm i -g @openai/codex` |
| 二进制文件名 | `agent` | `claude` | `opencode` | `codex` |
| PTY 要求 | 不需要 (`child_process.spawn`) | 不需要 (`child_process.spawn`) | 不需要 (`child_process.spawn`) | 不需要 (`child_process.spawn`) |

## 调用方式

| 维度 | Cursor Agent | Claude Code | OpenCode | Codex CLI |
|------|-------------|-------------|----------|-----------| 
| 非交互式命令 | `agent -p "prompt"` | `claude -p "prompt"` | `opencode run "prompt"` | `codex exec "prompt"` |
| JSON 输出标志 | `--output-format stream-json` | `--output-format stream-json` | `--format json` | `--json` (跟在 `exec` 后) |
| 模型选择 | `--model <alias>` | `--model <alias>` | `--model provider/model` | `--model <id>` |
| 权限绕过 | `--force --trust --sandbox disabled` | `--dangerously-skip-permissions` | 权限配置 `"*": "allow"` | `--full-auto` 或 `--yolo` |
| 核心无头参数 | `--approve-mcps` | `--dangerously-skip-permissions` | 权限配置 `"*": "allow"` | `--full-auto` |
| 详细输出 | 默认 | `--verbose` (必须) | 默认 | 自动输出到 stderr |

## 会话管理

| 维度 | Cursor Agent | Claude Code | OpenCode | Codex CLI |
|------|-------------|-------------|----------|-----------| 
| 恢复指定会话 | `--resume <uuid>` | `--resume <uuid>` | `--session <ses_xxx>` | `codex exec resume <thread_id> "prompt"` |
| 恢复最近会话 | `--resume` | `--continue` | `--continue` | `codex exec resume --last "prompt"` |
| 分叉会话 | 不支持 | `--fork-session` | `--fork` | `codex fork` (仅 TUI) |
| 导出会话 | 不支持 | 不支持 | `opencode export <id>` | 不支持 |
| 会话 ID 格式 | UUID | UUID | `ses_XXXXXXXX` | UUID (`thread.started` 事件中的 `thread_id`) |
| 会话存储 | `~/.cursor/` | `~/.claude/` | `~/.local/share/opencode/` | `~/.codex/sessions/` |
| 跳过持久化 | 不支持 | 不支持 | 不支持 | `--ephemeral` |

## 认证

| 维度 | Cursor Agent | Claude Code | OpenCode | Codex CLI |
|------|-------------|-------------|----------|-----------| 
| API Key 变量 | `CURSOR_API_KEY` | `ANTHROPIC_API_KEY` | 取决于提供商 | `OPENAI_API_KEY` / `CODEX_API_KEY` |
| 本地登录 | `agent login` (浏览器 OAuth) | `claude auth login` | `opencode auth login` | `codex login` (浏览器或 `--with-api-key`) |
| 订阅支持 | 原生 (Cursor Pro) | OAuth + `apiKeyHelper` | 不适用 | ChatGPT 订阅 (OAuth) |
| CI/CD 认证 | `CURSOR_API_KEY` | `ANTHROPIC_API_KEY` | 提供商特定环境变量 | `printenv OPENAI_API_KEY \| codex login --with-api-key` |
| OpenRouter | 不支持 | 原生不支持 | 原生支持 (`OPENROUTER_API_KEY`) | 不支持 |

## 技能 / 规则系统

| 维度 | Cursor Agent | Claude Code | OpenCode | Codex CLI |
|------|-------------|-------------|----------|-----------| 
| 技能路径 | `.cursor/skills/` | `.claude/skills/` | `.opencode/skills/` + `.claude/skills/` + `.agents/skills/` | `.agents/skills/` |
| 规则文件 | `.cursor/rules/*.mdc` | `CLAUDE.md` | `AGENTS.md` (首选) / `CLAUDE.md` | `AGENTS.md` (自动发现 root → cwd) |
| 规则回退配置 | 不支持 | 不支持 | 不支持 | `config.toml` 中的 `project_doc_fallback_filenames` |
| 技能格式 | `SKILL.md` | `SKILL.md` | `SKILL.md` (带 frontmatter) | `SKILL.md` (在 `.agents/skills/` 中) + `AGENTS.md` |
| 按需加载 | 是 (Agent 自动) | 是 (Agent 自动) | 是 (通过 `skill()` 工具) | 不适用 |
| 全局技能 | `~/.cursor/skills/` | `~/.claude/skills/` | `~/.config/opencode/skills/` | `~/.codex/AGENTS.md` |

## 工具与扩展

| 维度 | Cursor Agent | Claude Code | OpenCode | Codex CLI |
|------|-------------|-------------|----------|-----------| 
| 内置工具 | IDE 集成 | bash/read/write/edit/grep 等 | bash/read/write/edit/grep/glob 等 | bash/read/write/edit 等 |
| MCP 支持 | `.cursor/mcp.json` | `.claude/mcp.json` | `opencode.json` | `~/.codex/config.toml` (通过 `mcp` 命令) |
| 网页搜索 | 不支持 | 不支持 | 不支持 | `--search` 标志 |
| 图片输入 | 不支持 | 不支持 | 不支持 | `--image <path>` |
| 子代理 | 不支持 | 不支持 | `explore`、`general` (可并行) | Codex Cloud (异步任务) |
| GitHub Actions | 支持 (`curl https://cursor.com/install`) | 支持 (官方 Action) | 支持 (官方 Action) | 支持 (`npm i -g @openai/codex`) |
| HTTP Server API | 不支持 | 不支持 | 完整 OpenAPI (`opencode serve`) | App Server (基于 stdio 的 JSON-RPC 2.0) |
| TypeScript SDK | 不支持 | 不支持 | 不支持 | `@openai/codex-sdk` (Node 18+) |

## GolemBot 引擎集成

| 维度 | CursorEngine | ClaudeCodeEngine | OpenCodeEngine | CodexEngine |
|------|-------------|-----------------|----------------|-------------|
| 启动方式 | `child_process.spawn` | `child_process.spawn` | `child_process.spawn` | `child_process.spawn` |
| 解析函数 | `parseStreamLine()` | `parseClaudeStreamLine()` | `parseOpenCodeStreamLine()` | `parseCodexStreamLine()` |
| 技能注入 | symlink → `.cursor/skills/` | symlink → `.claude/skills/` + `CLAUDE.md` | symlink → `.opencode/skills/` | symlink → `.agents/skills/` + `AGENTS.md` |
| 配置生成 | `.cursor/cli.json` | `CLAUDE.md` | `opencode.json` | `~/.codex/config.toml` (可选) |
| API Key 注入 | `CURSOR_API_KEY` | `ANTHROPIC_API_KEY` | 提供商特定环境变量 | `OPENAI_API_KEY` |
| 会话 ID 来源 | `done` 事件 `sessionId` 字段 | `done` 事件 `sessionId` 字段 | `done` 事件 `sessionId` 字段 | `thread.started` 事件 `thread_id` 字段 |
| 冷启动 | 快 (~1s) | 中等 (~2-3s) | 慢 (5-10s, 推荐 HTTP serve 模式) | 中等 (~2-3s) |
| 费用追踪 | `duration_ms` | `total_cost_usd` + `num_turns` | `cost` + `tokens` (含缓存明细) | `usage.input_tokens` + `usage.output_tokens` (无费用) |
