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

在群聊场景中，Agent 为每个群维护独立的记忆文件 `memory/groups/<group-key>.md`。群组标识由通道类型和聊天 ID 生成（如 `slack-C123`）。

详见[群聊 — 群记忆](/zh/guide/group-chat#群记忆)，了解文件结构和响应策略对记忆积累的影响。

## 持久化消息队列（Inbox）

启用 [`inbox`](/zh/guide/configuration#inbox) 后，GolemBot 将 IM 消息写入 `.golem/inbox.jsonl` 顺序消费。这与对话历史不同——它是运维层面的消息队列，保障崩溃安全。

详见[消息队列与离线追回](/zh/guide/inbox)。

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
│   ├── inbox.jsonl                       ← 持久化消息队列（启用 inbox 时）
│   ├── watermarks.json                   ← 历史抓取水位线（启用 historyFetch 时）
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
