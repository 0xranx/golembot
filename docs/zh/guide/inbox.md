# 消息队列与离线追回

GolemBot 可以像真正的员工一样工作——忙的时候消息攒着，做完手头的事再逐条处理；休假回来后主动翻看未读消息，智能判断哪些需要回复。

## 概览

```
IM 消息到达
    ↓
adapter.onMessage()
    ↓
inbox.enqueue()  →  写入 .golem/inbox.jsonl（持久化）
    ↓
Consumer Loop（顺序消费）
    ├── 取出 pending 条目
    ├── handleMessage() → assistant.chat() → adapter.reply()
    └── 标记 done

Gateway 启动时 / 定时轮询
    ↓
History Fetcher
    ├── adapter.listChats() → 获取所有会话
    ├── adapter.fetchHistory(chatId, since) → 拉取历史消息
    ├── 按会话分组，组装批量分诊 prompt
    └── inbox.enqueue() → 进入正常消费流程
```

## 持久化消息队列（Inbox）

开启后，IM 消息先写入 `.golem/inbox.jsonl` 再顺序消费。即使进程在响应中途崩溃，消息也不会丢失。

### 工作原理

1. **入队** — 每条消息以 `pending` 状态追加到 JSONL 文件
2. **消费** — consumer 逐条取出，标记为 `processing`，运行 Agent，完成后标记 `done`
3. **崩溃恢复** — 重启时，所有 `processing` 状态的条目自动恢复为 `pending`
4. **去重** — 基于 `channelType + messageId` 去重，防止重复处理
5. **清理** — 超过 `retentionDays` 的已完成条目定期清理

### 配置

```yaml
inbox:
  enabled: true          # 默认：false（向后兼容）
  retentionDays: 7       # 已完成条目保留天数
```

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enabled` | `boolean` | `false` | 启用持久化消息队列 |
| `retentionDays` | `number` | `7` | 已完成条目保留天数 |

::: tip inbox 关闭时
`inbox.enabled: false`（默认）时，Gateway 行为与以前完全一致——消息内联处理，受并发限制。当你需要崩溃安全和消息不丢失时开启 inbox。
:::

## 历史消息抓取（History Fetch）

重启后，Bot 可以自动追回离线期间错过的消息。

### 工作原理

1. **发现** — 调用 `adapter.listChats()` 获取 Bot 加入的所有会话
2. **拉取** — 对每个会话调用 `adapter.fetchHistory(chatId, since)`，拉取水位线之后的消息
3. **分诊** — 按会话分组，每个会话生成一个分诊 prompt
4. **入队** — 分诊 prompt 入队到 inbox，走正常消费流程
5. **水位线** — 更新 `.golem/watermarks.json`，避免重复拉取

### 智能分诊

同一会话的多条未读消息被合并为一个 prompt：

```
[System: 你已离线一段时间。以下是你不在时 feishu:oc_xxx 会话中收到的消息。
请审阅每条消息并决定如何回应：
- 相关的消息合并回复
- 已被解决或不需要回复的，跳过或简短确认
- 如果所有消息都不需要回复，请输出：[SKIP]]

[2026-03-11T10:00:00Z] Alice: 帮我看下这个 PR
[2026-03-11T10:05:00Z] Bob: 部署状态怎么样？
[2026-03-11T10:30:00Z] Alice: 算了不用了，我自己合了。
```

Agent 审阅完整上下文后决定如何回应——可能跳过 Alice 已解决的 PR 请求，只回答 Bob 的问题。如果所有消息都不需要回复，Agent 输出 `[SKIP]`，Bot 保持沉默。

### 定时轮询

除启动时抓取外，History Fetcher 还会定时轮询，防止 WebSocket 断连导致的消息静默丢失。

### 配置

```yaml
historyFetch:
  enabled: true
  pollIntervalMinutes: 15      # 定时轮询间隔（默认：15）
  initialLookbackMinutes: 60   # 首次启动回看时长（默认：60）
```

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enabled` | `boolean` | `false` | 启用历史抓取 |
| `pollIntervalMinutes` | `number` | `15` | 定时轮询间隔 |
| `initialLookbackMinutes` | `number` | `60` | 首次运行（无水位线）回看多久 |

::: info 依赖 inbox
`historyFetch` 依赖 `inbox`——抓取到的消息入队到 inbox 中顺序消费。
:::

## 平台支持

并非所有通道都支持历史抓取——取决于平台 API 是否提供消息历史和会话列表接口。

| 通道 | `fetchHistory` | `listChats` | 说明 |
|------|:-:|:-:|------|
| 飞书 | ✅ | ✅ | 最佳支持 — `im.v1.message.list` + `im.v1.chat.list` |
| Slack | ✅ | ✅ | `conversations.history` + `conversations.list` |
| Discord | ✅ | ✅ | `channel.messages.fetch` + `guilds.cache` |
| Telegram | ❌ | ❌ | Bot API 无历史消息接口 |
| 钉钉 | ❌ | ❌ | 暂未实现 |
| 企微 | ❌ | ❌ | 暂未实现 |
| 自定义 | 可选 | 可选 | 在你的 [Adapter](/zh/api/channel-adapter) 中实现 `fetchHistory()` 和 `listChats()` |

未实现这些方法的 Adapter 会被静默跳过。

## 去重机制

三层防重复处理：

1. **Adapter 层** — 实时 `seenMsgIds` Set（已有机制）
2. **Inbox 层** — 基于 `channelType + messageId` 检查队列中所有条目
3. **水位线** — 只拉取上次时间戳之后的消息

## 文件布局

```
.golem/
├── inbox.jsonl          ← 持久化消息队列
└── watermarks.json      ← 各会话的抓取时间戳
```

两个文件都在 `.golem/` 目录下，已被 gitignore。

## 完整示例

```yaml
name: my-bot
engine: claude-code

inbox:
  enabled: true
  retentionDays: 7

historyFetch:
  enabled: true
  pollIntervalMinutes: 15
  initialLookbackMinutes: 60

channels:
  feishu:
    appId: ${FEISHU_APP_ID}
    appSecret: ${FEISHU_APP_SECRET}
  slack:
    botToken: ${SLACK_BOT_TOKEN}
    appToken: ${SLACK_APP_TOKEN}

gateway:
  port: 3000
```
