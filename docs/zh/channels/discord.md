# Discord

GolemBot 通过 **Gateway WebSocket** 连接 Discord——无需公网 IP。Bot 可以响应私信（DM）和服务器频道中的消息。

## 前置条件

- Discord 账号
- Node.js ≥ 18
- 一个带 Bot 用户的 Discord 应用

## 安装 SDK

```bash
npm install discord.js
```

## 创建 Bot

1. 打开 [Discord Developer Portal](https://discord.com/developers/applications)，点击 **New Application**。
2. 在 **Bot** 选项卡下，点击 **Add Bot**。复制 **Bot Token**，后面配置时会用到。
3. 在 **Privileged Gateway Intents** 下，启用 **Message Content Intent**（Bot 读取消息文本必须开启）。
4. 在 **OAuth2 → URL Generator** 下，选择 `bot` scope 和以下权限：
   - **Read Messages/View Channels**
   - **Send Messages**
   - **Read Message History**
5. 复制生成的 URL，在浏览器中打开，将 Bot 邀请进你的服务器。

## 配置 golem.yaml

```yaml
name: my-assistant
engine: claude-code

channels:
  discord:
    botToken: ${DISCORD_BOT_TOKEN}
    botName: my-assistant  # 可选，详见下文
```

运行前设置环境变量：

```bash
export DISCORD_BOT_TOKEN=your-token-here
golembot gateway
```

### `botName` 字段

`botName` 是**可选的**。Discord 消息内容中使用内部用户 ID（`<@12345678>`）而非名字来标记 @mention，适配器通过原生 token 检测 mention——**即使不设置 `botName`，mention 检测也能正常工作**。

设置 `botName` 后，适配器会额外将 `<@userId>` token 替换为 `@botName`，让引擎看到可读的 mention 名称。建议与 `golem.yaml` 中的 `name` 字段保持一致。

## 工作方式

| 聊天类型 | 行为 |
|---------|------|
| 私信（DM） | 始终响应 |
| 服务器频道 @mention（`@YourBot 消息`） | 检测到 mention，正常回复 |
| 服务器频道普通消息（未 @mention） | 取决于 `groupPolicy`（默认：忽略） |

每个私信会话和每个服务器频道分别维护独立的会话上下文。

::: tip 消息格式
Discord 原生支持 Markdown，无需格式转换。GolemBot 直接发送 AI 回复原文，Discord 自动渲染加粗、斜体、代码块、链接等 Markdown 格式。
:::

## 消息限制

Discord 单条消息上限为 **2,000 字符**。超出时 GolemBot 自动拆分为多条发送。

## 群聊行为

Discord 服务器频道被视为**群聊**。通过 `golem.yaml` 中的 `groupChat` 字段配置响应策略：

```yaml
groupChat:
  groupPolicy: mention-only  # mention-only（默认）| smart | always
  historyLimit: 20
  maxTurns: 10
```

详见[通道概览](/zh/channels/overview#群聊行为)。
