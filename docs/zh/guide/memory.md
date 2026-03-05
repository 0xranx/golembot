# 记忆系统

GolemBot 拥有两层记忆机制——均可在切换引擎、session 过期和进程重启后保留：

1. **对话历史** — 框架自动将每轮对话记录到磁盘
2. **持久记忆** — Agent 自行维护跨 session 的结构化笔记

无需任何配置，两层记忆开箱即用。

## 工作原理

| | 对话历史 | 持久记忆 |
|---|---|---|
| **内容** | 原始对话记录（用户 + 助手） | 偏好、决策、待办、项目上下文 |
| **管理方** | 框架（自动） | Agent（基于约定） |
| **存储位置** | `.golem/history/{sessionKey}.jsonl` | `notes.md`（私聊）/ `memory/groups/*.md`（群聊） |
| **格式** | JSONL（每行一个 JSON 对象） | Markdown |
| **切换引擎后保留？** | 是 | 是 |
| **已 gitignore？** | 是（`.golem/` 已被忽略） | 否（可以纳入版本控制） |

## 对话历史

GolemBot 自动将每轮对话记录到 `.golem/history/` 下的按 session 分隔的 [JSONL](https://jsonlines.org/) 文件中：

```
.golem/history/{sessionKey}.jsonl
```

每行是一个 JSON 对象：

```jsonl
{"ts":"2026-03-05T10:00:00.000Z","sessionKey":"default","role":"user","content":"我的待办清单上有什么？"}
{"ts":"2026-03-05T10:00:03.500Z","sessionKey":"default","role":"assistant","content":"以下是你当前的待办事项...","durationMs":3500,"costUsd":0.02}
```

字段说明：`ts`（ISO 时间戳）、`sessionKey`、`role`（`user` | `assistant`）、`content`，以及可选的 `durationMs` / `costUsd`。

### 自动上下文恢复

当 session 丢失时——无论是切换引擎、session 过期还是恢复失败——GolemBot 会检测到当前没有活跃 session，并指示 Agent 在回复前先读取历史文件恢复上下文。用户无需重复之前说过的话。

::: tip 切换引擎不丢上下文
这是 GolemBot 的核心优势之一。当你从 Cursor 切换到 Claude Code（或任何其他引擎）时，对话历史保留在磁盘上。新引擎 session 会通过读取历史文件接续之前的对话。
:::

## 个人记忆

内置的 `general` 技能通过 `notes.md` 约定实现私聊场景下的长期记忆。

### Agent 何时读取 `notes.md`

- 每次对话开始时（如果文件存在）
- 用户询问"你还记得……吗？"或引用之前的上下文时

### Agent 何时写入 `notes.md`

- 用户明确要求记住某事（"记住我喜欢……"）
- 用户分享重要的偏好、日期或项目上下文
- 完成重要任务后——记录关键结论和决策
- 用户分配待办事项

### 格式

```markdown
## 偏好
- [2026-03-01] 用户偏好简洁回复
- [2026-03-01] 常用技术栈：TypeScript、React、Node.js

## 项目信息
- [2026-03-01] 当前项目：GolemBot，AI 助手平台

## 待办
- [ ] 完成数据分析报告
- [x] 部署测试环境
```

条目按主题分类，并用 `[YYYY-MM-DD]` 日期标签标注。待办事项使用 Markdown 复选框格式。

::: info 约定，而非强制
`notes.md` 是 `general` 技能的 prompt 中定义的约定——由 Agent 自行决定写入什么内容。你也可以手动编辑 `notes.md` 来"教"Agent 特定的事实或偏好。
:::

## 群聊记忆

在群聊场景中，Agent 为每个群维护独立的记忆文件：

```
memory/groups/<group-key>.md
```

群组标识由通道类型和聊天 ID 生成（如 `slack-C123`、`telegram--100456`）。GolemBot 会自动创建 `memory/groups/` 目录。

### 文件结构

```markdown
# Group: slack-C123

## 成员
- Alice：前端负责人
- Bob：后端工程师

## 项目上下文
- 正在构建 API 延迟监控仪表盘
- 使用 React + Go 技术栈

## 决策记录
- [2026-03-01] 出于成本考虑选择 Prometheus 而非 Datadog
- [2026-03-03] 冲刺截止日期推迟到 3 月 15 日
```

### Smart 模式 vs Mention-only 模式

[`groupChat` 配置](/zh/guide/configuration#groupchat) 中的 `groupPolicy` 设置影响群记忆的积累方式：

| 策略 | Agent 运行时机 | 记忆更新频率 |
|------|--------------|-------------|
| `smart` | 每条消息（即使保持沉默） | 持续更新——Agent 观察所有消息并实时更新记忆 |
| `mention-only` | 仅被 @mention 时 | 间歇更新——仅在 Bot 被调用时更新记忆 |
| `always` | 每条消息 | 持续更新 |

在 `smart` 模式下，Agent 会处理每条群消息——即使它最终输出 `[PASS]` 保持沉默。这意味着群记忆会随着对话的完整上下文持续更新。

## 文件布局

以下是助手目录中所有记忆相关文件的位置：

```
my-assistant/
├── notes.md                              ← 个人记忆（私聊）
├── memory/
│   └── groups/
│       ├── slack-C123.md                 ← 群记忆
│       └── telegram--100456.md           ← 群记忆
├── .golem/                               ← 已 gitignore
│   ├── sessions.json                     ← 活跃引擎 session ID
│   └── history/
│       ├── default.jsonl                 ← 私聊对话历史
│       ├── slack-C123.jsonl              ← 群聊对话历史
│       └── slack-C123-U456.jsonl         ← 按用户的私聊历史
└── skills/
    └── general/SKILL.md                  ← 定义 notes.md 约定
```

## 使用技巧

- **`.golem/` 已被 gitignore** — 对话历史文件不会被提交。`notes.md` 和 `memory/` 目录*没有*被忽略，你可以选择将 Agent 的持久记忆纳入版本控制。
- **直接编辑 `notes.md`** — 你可以手动添加条目，为 Agent 预加载特定的知识或偏好。
- **用 `jq` 查询历史** — 历史文件是标准 JSONL 格式，可以用 `jq` 等工具查询：
  ```bash
  # 查看某个 session 的所有用户消息
  cat .golem/history/default.jsonl | jq -r 'select(.role=="user") | .content'
  ```
- **历史文件会持续增长** — 目前没有自动轮转机制。对于长期运行的助手，你可能需要定期归档旧的历史文件。
