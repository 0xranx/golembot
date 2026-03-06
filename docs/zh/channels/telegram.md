# Telegram

GolemBot 通过 **Long-Polling（长轮询）** 连接 Telegram，无需公网 URL。支持私聊和群组内 @mention 响应。

## 前置条件

- 一个 Telegram 账号
- Node.js ≥ 18

## 安装 SDK

```bash
npm install grammy
```

## 创建 Bot

1. 打开 Telegram，搜索 [@BotFather](https://t.me/BotFather) 并发送消息。
2. 发送 `/newbot`，按提示操作，完成后会收到一个 **Bot Token**，格式为 `123456:ABCdef...`。
3. **群组 @mention 必须执行**：向 @BotFather 发送 `/setprivacy` → 选择你的 Bot → 选择 **Disable**，以允许 Bot 接收群组消息。

::: warning Privacy mode 对已有群组不立即生效
关闭 privacy mode 后，仅对**之后加入**的群组生效。对于已经在其中的群组，需要**先将 Bot 移出群组，再重新邀请**，新设置才会生效。
:::

## 配置 golem.yaml

```yaml
name: my-assistant
engine: claude-code

channels:
  telegram:
    botToken: ${TELEGRAM_BOT_TOKEN}   # 123456:ABCdef...
```

运行前设置环境变量：

```bash
export TELEGRAM_BOT_TOKEN=123456:ABCdef...
golem gateway
```

## 工作原理

| 场景 | 行为 |
|------|------|
| 私聊 | 始终响应 |
| 群组 @mention（`@机器人名 消息`） | 去掉 `@botname` 后处理 |
| 群组普通消息（无 @mention） | 忽略 |

每个会话（私聊或群组）维护独立的对话上下文。

## 消息格式

适配器自动将标准 Markdown 转换为 **Telegram HTML** 格式：

| Markdown | Telegram HTML |
|----------|--------------|
| `**bold**` | `<b>bold</b>` |
| `*italic*` | `<i>italic</i>` |
| `~~strike~~` | `<s>strike</s>` |
| `` `code` `` | `<code>code</code>` |
| ` ```lang ` | `<pre><code class="language-lang">` |
| `[text](url)` | `<a href="url">text</a>` |
| `# Heading` | `<b>Heading</b>` |
| `> quote` | `<blockquote>quote</blockquote>` |
| `- item` | `• item` |

消息以 `parse_mode: 'HTML'` 发送。代码块内外的特殊字符自动转义。

## 消息长度限制

响应超过 **4,096 字符** 时会自动分段发送。
