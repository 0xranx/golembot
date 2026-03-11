# 通道概览

GolemBot 的 Gateway 将你的助手接入 IM 平台。每个平台由一个**通道适配器**处理，在 IM SDK 和 GolemBot 的 `assistant.chat()` API 之间转换。

## 支持的通道

| 通道 | 传输方式 | 需要公网 IP | SDK |
|------|----------|------------|-----|
| [飞书](/zh/channels/feishu) | WebSocket | 否 | `@larksuiteoapi/node-sdk` |
| [钉钉](/zh/channels/dingtalk) | Stream（WebSocket） | 否 | `dingtalk-stream` |
| [企业微信](/zh/channels/wecom) | Webhook HTTP | **是** | `@wecom/crypto` + `xml2js` |
| [Slack](/zh/channels/slack) | Socket Mode（WebSocket） | 否 | `@slack/bolt` |
| [Telegram](/zh/channels/telegram) | Long-polling | 否 | `grammy` |
| [Discord](/zh/channels/discord) | Gateway WebSocket | 否 | `discord.js` |
| 自定义 | 任意 | 视实现而定 | 你自己的 Adapter 类 |

## 架构

```
IM 平台 → 通道 Adapter → assistant.chat() → 文本回复 → adapter.reply()
```

Gateway 流程：

1. 从 `golem.yaml` 读取 `channels` 配置
2. 动态 import 每个已配置通道的 SDK
3. 所有 Adapter 与 HTTP 服务并行启动
4. 对每条入站消息：解析 session key → 构建上下文 → `assistant.chat()`
5. 累积完整文本回复，按平台字数限制拆分后逐段发送

## 消息长度限制

每个平台有最大消息长度。GolemBot 自动拆分长回复：

| 通道 | 最大长度 | 拆分方式 |
|------|----------|----------|
| 飞书 | 4,000 字符 | 多条消息 |
| 钉钉 | 4,000 字符 | 多条消息 |
| 企业微信 | 2,048 字符 | 多条消息 |
| Slack | 4,000 字符 | 多条消息 |
| Telegram | 4,096 字符 | 多条消息 |
| Discord | 2,000 字符 | 多条消息 |
| 自定义 | 可通过 `maxMessageLength` 配置 | 多条消息 |

## 消息格式转换

GolemBot 自动将标准 Markdown 转换为各平台的原生格式：

| 通道 | 输出格式 | 转换方式 |
|------|----------|----------|
| 飞书 | 卡片 v2（interactive） | 原生 Markdown 渲染 — 标题、列表、代码块、表格 |
| Slack | mrkdwn | `**bold**` → `*bold*`、`*italic*` → `_italic_`、链接重写 |
| Telegram | HTML | `**bold**` → `<b>`、代码块 → `<pre><code>`、引用 → `<blockquote>` |
| Discord | Markdown（原生） | 无需转换 — Discord 原生渲染 Markdown |
| 钉钉 | Markdown（原生） | 直接透传 |
| 企业微信 | 纯文本 | Markdown 被去除（企业微信文本 API 格式支持有限） |

AI agent 被鼓励使用标准 Markdown 语法（标题、列表、加粗、代码块等），各适配器自动处理平台特定的格式转换。

## 群聊、Mention 与引用回复

GolemBot 支持群聊响应策略（mention-only / smart / always）、入站和出站 @mention 解析，以及支持平台的引用回复。

详见[群聊](/zh/guide/group-chat)。

## 消息队列与离线追回

开启后，消息持久化入队，Bot 重启后通过智能分诊追回离线消息。

详见[消息队列与离线追回](/zh/guide/inbox)，了解完整指南和平台支持表。

## 自定义 Adapter

通过编写 Adapter 类并在 `golem.yaml` 中用 `_adapter` 引用，可以接入任意平台：

```yaml
channels:
  my-platform:
    _adapter: ./adapters/my-platform.mjs   # 或 npm 包名
    token: ${MY_PLATFORM_TOKEN}
```

详见 [Channel Adapter API](/zh/api/channel-adapter)，了解完整接口、实现指南和示例。

## 图片支持（多模态）

GolemBot 支持全部 6 个内置通道的**图片消息**。当用户发送图片（照片、截图、文件附件），Adapter 会下载图片并通过完整管线处理：

```
用户发送图片 → Adapter 下载为 Buffer → gateway 传递给 assistant.chat()
→ 图片保存到 .golem/images/ → 文件路径追加到 prompt → Agent 读取文件
→ 回复后自动清理
```

| 通道 | 图片来源 | 文本/标题 |
|------|---------|----------|
| 飞书 | `image` 消息 + `post`（富文本）中的内联图片 | 提取富文本中的文本内容 |
| Slack | 图片类型的文件附件 | 保留消息文本 |
| Telegram | `message.photo`（选取最大尺寸） | 使用 `message.caption` 作为文本 |
| Discord | 图片类型的 `message.attachments` | 保留消息文本 |
| 钉钉 | `picture` 消息 + `richText` 中的图片 | 提取富文本内容 |
| 企业微信 | 通过 media API 下载的 `image` 消息 | 文本设为 `(image)` |

**工作原理：** 图片保存为 `.golem/images/` 下的临时文件，通过绝对路径引用注入 prompt。这种方式兼容所有引擎（Cursor、Claude Code、OpenCode、Codex），因为每个编码 CLI 都能读取本地文件。Agent 回复后文件自动清理。

**HTTP API：** `POST /chat` 端点同样支持 base64 编码的图片 —— 详见 [HTTP API](/zh/api/http-api#post-chat)。

## 主动消息（定时任务）

除了响应入站消息，GolemBot 还支持按计划**主动推送消息**到 IM 通道。在 `golem.yaml` 中定义任务，Agent 会自动执行 prompt 并推送结果。

详见[定时任务](/zh/guide/scheduled-tasks)，了解完整配置、管理命令和使用场景。

## 启动 Gateway

```bash
golembot gateway --verbose
```

`--verbose` 参数开启每通道的详细日志，便于调试。

## SDK 依赖

通道 SDK 是**可选的 peer 依赖**。只安装你需要的：

```bash
# 飞书
pnpm add @larksuiteoapi/node-sdk

# 钉钉
pnpm add dingtalk-stream

# 企业微信
pnpm add @wecom/crypto xml2js

# Slack
pnpm add @slack/bolt

# Telegram
pnpm add grammy

# Discord
pnpm add discord.js
```

如果已配置的通道 SDK 未安装，Gateway 会打印错误信息和安装指引。
