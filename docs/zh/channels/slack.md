# Slack

GolemBot 通过 **Socket Mode** 连接 Slack，无需公网 URL。支持私信（DM）和频道内 @mention 响应。

## 前置条件

- 拥有管理员权限的 Slack 工作区
- Node.js ≥ 18

## 安装 SDK

```bash
npm install @slack/bolt
```

## 创建 Slack App

1. 前往 [api.slack.com/apps](https://api.slack.com/apps)，点击 **Create New App → From scratch**。
2. 在 **Socket Mode** 中开启，并生成一个 **App-Level Token**（权限范围：`connections:write`）。复制 `xapp-...` 开头的 token。
3. 在 **OAuth & Permissions → Bot Token Scopes** 下添加：
   - `chat:write` — 发送消息
   - `im:history` — 读取私信
   - `channels:history` — 读取频道消息（用于 @mention）
4. 在 **Event Subscriptions → Subscribe to bot events** 下添加：
   - `message.im` — 私信事件
   - `app_mention` — 频道 @mention 事件
5. 将 App 安装到工作区，复制 **Bot Token**（`xoxb-...`）。

## 配置 golem.yaml

```yaml
name: my-assistant
engine: claude-code

channels:
  slack:
    botToken: ${SLACK_BOT_TOKEN}   # xoxb-...
    appToken: ${SLACK_APP_TOKEN}   # xapp-...
```

运行前设置环境变量：

```bash
export SLACK_BOT_TOKEN=xoxb-...
export SLACK_APP_TOKEN=xapp-...
golem gateway
```

## 工作原理

| 场景 | 行为 |
|------|------|
| 私信（DM） | 始终响应 |
| 频道 @mention（`@机器人 消息`） | 去掉 `<@BOT_ID>` 前缀后处理 |
| 频道普通消息（无 @mention） | 忽略 |

私信使用每用户独立 session；频道消息使用每频道共享 session——同一频道的所有用户共享同一个对话上下文。

> **注意：** 在 Thread 中 @mention bot 时，回复会发送到频道顶层，而非 Thread 内部。

## 消息格式

适配器自动将标准 Markdown 转换为 **Slack mrkdwn** 格式：

| Markdown | Slack mrkdwn |
|----------|-------------|
| `**bold**` | `*bold*` |
| `*italic*` | `_italic_` |
| `~~strike~~` | `~strike~` |
| `[text](url)` | `<url\|text>` |
| `# Heading` | `*Heading*`（加粗） |
| `- item` | `• item` |

代码块、引用和行内代码保持原样（Slack 原生渲染）。特殊字符（`&`、`<`、`>`）自动转义。

## 消息长度限制

响应超过 **4,000 字符** 时会自动分段发送。
