# Coding Agent CLI — 实战笔记

GolemBot 支持的各 Coding Agent CLI 深度技术参考。包含经过验证的调用方法、输出格式规范、会话管理细节、认证选项以及踩坑记录 — 基于 GolemBot 实际集成工作的第一手经验。

## 各引擎参考

- **[Cursor Agent CLI](./coding-cli-cursor)** — `agent` 二进制文件, stream-json, `--stream-partial-output` 去重
- **[Claude Code CLI](./coding-cli-claude-code)** — `claude` 二进制文件, stream-json, assistant/user 混合事件
- **[OpenCode CLI](./coding-cli-opencode)** — `opencode` 二进制文件, NDJSON parts, HTTP Server API 选项
- **[Codex CLI](./coding-cli-codex)** — `codex` 二进制文件, NDJSON, ChatGPT OAuth, `--skip-git-repo-check`

## 跨引擎对比

- **[四引擎对比矩阵](./coding-cli-comparison)** — 所有四个引擎的调用、会话、认证、技能、工具以及 GolemBot 集成的并排对比
