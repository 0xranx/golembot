# 群聊

GolemBot 可以参与所有 IM 通道的群聊。配置 bot 的响应策略、@mention 处理和群记忆。

## 响应策略

通过 `golem.yaml` 中的 `groupChat.groupPolicy` 控制 bot 在群聊中的发言时机：

```yaml
groupChat:
  groupPolicy: smart     # mention-only（默认）| smart | always
  historyLimit: 30       # 注入最近多少条消息作为上下文（默认：20）
  maxTurns: 5            # 每个群最多连续回复次数（默认：10，防死循环）
```

| 策略 | Agent 调用时机 | Bot 何时回复 | 适用场景 |
|----|--------------|------------|---------|
| `mention-only` | 仅被 @mention 时 | 仅被 @mention 时 | 低噪音，最省成本 |
| `smart` | 所有群消息 | Agent 自己决定（输出 `[PASS]` 保持沉默） | Bot 持续观察并积累群记忆 |
| `always` | 所有群消息 | 每条消息都回复 | 高互动的专用小群 |

### Smart 模式

`smart` 模式下，Agent 对**每条**群消息都会运行——即使最终输出 `[PASS]` 保持沉默。这意味着：

- Agent 实时阅读并理解所有消息
- 群记忆持续更新（见下方[群记忆](#群记忆)）
- 当 Agent 决定发言时拥有完整的对话上下文
- 在 smart 模式下被 @mention 时，消息一定会被处理（不会跳过）

`mention-only` 模式下，Agent 只在被 @mention 时运行。记忆和上下文仅在此时更新。

### 配置参考

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `groupPolicy` | `string` | `mention-only` | 响应策略 |
| `historyLimit` | `number` | `20` | 注入多少条历史消息作为上下文 |
| `maxTurns` | `number` | `10` | 每个群最多连续 bot 回复次数（安全阀） |

## Mention 处理

### 入站 @mention

GolemBot 在将消息传给 Agent 前会自动去除 @mention 标记，兼容：

- XML 格式：`<at user_id="xxx">BotName</at>`（飞书）
- 纯文本格式：`@BotName`

Mention 检测支持词边界——`@mybot` 不会误触发 `@mybotplus`。

### 出站 @mention

当 AI 回复中包含 `@名字` 且匹配已知群成员时，Gateway 自动将其转换为平台原生 mention。这需要 Adapter 实现可选的 `getGroupMembers()` 方法。

| 通道 | 出站 @mention | 实现方式 |
|------|:-:|------|
| **飞书** | ✅ | 通过 API 获取群成员，转换为卡片 v2 中的原生 `<at>` 标签。需要 `im:chat:readonly` 权限。 |
| **Slack** | ✅ | 通过 `conversations.members` 获取频道成员，转换为 `<@USER_ID>`。 |
| **Discord** | ✅ | 获取服务器成员，转换为 `<@USER_ID>`。需要在 Developer Portal 启用 **Server Members Intent**。 |
| 钉钉 | ❌ | `@名字` 作为纯文本发送 |
| 企微 | ❌ | `@名字` 作为纯文本发送 |
| Telegram | ❌ | `@名字` 作为纯文本发送 |

## 引用回复

Bot 以**引用回复**（引用原始消息）的形式回复，而不是发送独立消息。让群聊中的对话关系更加清晰。

| 通道 | 引用回复 | 机制 |
|------|:-------:|------|
| **飞书** | ✅ | `im.v1.message.reply`（原生引用） |
| **Telegram** | ✅ | `reply_to_message_id` 参数 |
| **Slack** | ✅ | 通过 `thread_ts` 线程回复 |
| **Discord** | ✅ | 原生 `message.reply()` |
| **钉钉** | ❌ | Webhook 模式不支持引用回复 |
| **企微** | ❌ | API 不支持引用回复 |

无需配置——支持的通道会自动启用引用回复。

## 群记忆

Agent 为每个群维护独立的记忆文件：

```
memory/groups/<group-key>.md
```

群组标识由通道类型和聊天 ID 生成（如 `slack-C123`、`telegram--100456`）。GolemBot 自动创建 `memory/groups/` 目录。

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

### 策略对记忆的影响

| 策略 | Agent 运行时机 | 记忆更新频率 |
|------|--------------|-------------|
| `smart` | 每条消息（即使保持沉默） | 持续更新——实时观察所有消息并更新记忆 |
| `mention-only` | 仅被 @mention 时 | 间歇更新——仅在 Bot 被调用时更新 |
| `always` | 每条消息 | 持续更新 |

## 会话路由

**私聊消息**使用 per-user key：`${channelType}:${chatId}:${senderId}`——每个用户拥有独立的对话上下文。

**群消息**使用 group-scoped key：`${channelType}:${chatId}`——同一个群里的所有用户共享一个 session，Agent 能看到完整的群对话上下文。
