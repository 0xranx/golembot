# 内置技能

GolemBot 自带两个内置技能，在 `golembot init` 或 `golembot onboard` 时自动复制到新助手目录。

## `general` — 通用个人助手

通用技能，使 Agent 成为个人 AI 助手。

**能力：**
- 回答问题、提供建议、头脑风暴
- 读写文件：整理笔记、生成报告、管理待办
- 执行脚本和命令进行任务自动化
- 信息检索和摘要

**持久记忆：** 建立 `notes.md` 规范，用于跨会话记忆——Agent 在对话开始时读取，在获取重要信息时写入。详见[记忆系统](/zh/guide/memory)。

## `im-adapter` — IM 回复规范

优化 Agent 在即时通讯平台（飞书、钉钉、企业微信）上的回复。

- 简单问题 1–2 句，复杂问题分段每段不超过 300 字符
- 避免 Markdown 标题、代码块和表格
- 群聊中根据 `[User:xxx]` 前缀称呼用户
- 不以「好的，让我来帮你...」开头

## 模板技能

[引导向导](/zh/guide/onboard-wizard)提供 6 个场景模板，各含一个专用技能：

| 模板 | 技能 | 核心行为 |
|------|------|----------|
| `customer-support` | `faq-support` | FAQ 查询，未解答升级到 `unanswered.md` |
| `data-analyst` | `data-analysis` | 从 `data/` 读取，输出到 `reports/`，使用 `calc.py` |
| `code-reviewer` | `code-review` | 5 维度审查，严重级别分层，输出到 `reviews/` |
| `ops-assistant` | `ops` | 内容创作、排期管理、竞品追踪 |
| `meeting-notes` | `meeting` | 结构化纪要，行动项到 `action-items.md` |
| `research` | `research` | 研究报告，来源到 `sources.md` |
