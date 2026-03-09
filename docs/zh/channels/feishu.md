# 飞书

通过 WebSocket 长连接模式将 GolemBot 助手接入飞书。无需公网 IP。

## 前置条件

```bash
pnpm add @larksuiteoapi/node-sdk
```

## 飞书开放平台配置

1. 前往[飞书开放平台](https://open.feishu.cn/)，创建一个新应用
2. 在**凭证与基础信息**中，复制 **App ID** 和 **App Secret**
3. 在**事件订阅**中：
   - 启用 **WebSocket** 连接模式
   - 订阅 `im.message.receive_v1`
4. 在**权限管理**中，添加下方[权限表格](#权限列表)中列出的权限
5. 在**数据权限** → **通讯录权限范围**中，设置为"全部成员"（至少包含你的团队成员）
6. 发布应用版本并由管理员审批

### 权限列表

| 权限 Scope | 是否必需 | 用途 | 未开通时的影响 |
|------------|---------|------|--------------|
| `im:message` | **必需** | 向用户和群组发送消息 | Bot 无法回复 |
| `im:message:readonly` | **必需** | 通过 WebSocket 事件接收消息 | Bot 收不到任何消息 |
| `im:message.group_at_msg:readonly` | **必需** | 接收群聊中 @机器人 的消息 | Bot 在群聊中不可见 |
| `contact:user.base:readonly` | **必需** | 从通讯录 API 读取用户基本信息（显示名称） | Bot 无法识别用户名 |
| `contact:contact.base:readonly` | **必需** | 读取通讯录基础信息（需与上条配合使用） | Bot 无法识别用户名 |
| `im:chat:readonly` | 可选 | 获取群成员列表，用于回复中的 @mention 支持 | 回复中的 `@名字` 以纯文本发送，不触发飞书原生提及 |

::: tip
未开通两个 `contact:` 权限时，Bot 仍可正常工作，但会将用户显示为 `ou_xxxxx` 形式的 ID，无法知道对方叫什么名字。
:::

## 配置

```yaml
# golem.yaml
channels:
  feishu:
    appId: ${FEISHU_APP_ID}
    appSecret: ${FEISHU_APP_SECRET}
```

```sh
# .env
FEISHU_APP_ID=cli_xxxxxxxxxx
FEISHU_APP_SECRET=xxxxxxxxxxxxxxxxxx
```

### 消息格式

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `appId` | `string` | — | 飞书 App ID（必填） |
| `appSecret` | `string` | — | 飞书 App Secret（必填） |

适配器自动检测 AI 回复是否包含 Markdown 格式：

- **纯文本** — 以 `msg_type: "text"` 发送（无转换）
- **Markdown** — 以消息卡片发送（`msg_type: "interactive"`），使用飞书卡片 v2 原生 Markdown 渲染。支持标题、列表、加粗/斜体、带语法高亮的代码块、引用、表格和链接

标准 Markdown 语法自动转换，无需额外配置。

## 工作原理

- **传输**：通过 `@larksuiteoapi/node-sdk` 的 `WSClient` 建立 WebSocket 长连接
- **事件**：监听 `im.message.receive_v1` 事件（仅文本消息）
- **回复**：通过 `client.im.v1.message.create()` 发送消息，根据内容自动选择格式
- **聊天类型**：支持单聊（私信）和群聊
- **私聊上下文**：私聊中 Gateway 会注入发送者的显示名称，让 bot 知道对方是谁
- **群聊 @mention 过滤**：群聊中机器人只在被直接 @提及时才响应，@mention 的 key 会在传给引擎前自动从消息文本中剥除
- **回复中的 @mention**：当 AI 回复包含 `@名字` 且匹配群内已知成员时，自动转换为飞书原生 @mention（蓝色可点击标签）。群成员通过 API 自动获取并缓存 10 分钟。需要 `im:chat:readonly` 权限

## 启动

```bash
golembot gateway --verbose
```

适配器启动时通过 WebSocket 连接飞书。`--verbose` 模式下消息日志带 `[feishu]` 前缀。

## 已读回执

飞书适配器支持追踪用户是否已读机器人发送的消息。当用户打开包含未读 bot 消息的聊天时，适配器会收到 `im.message.message_read_v1` 事件，包含阅读者 ID、消息 ID 列表和阅读时间戳。

启用已读回执：

1. 在**事件订阅**中，订阅 `im.message.message_read_v1`
2. 适配器会发出 `ReadReceipt` 事件，可由自定义 handler 消费

这是一个被动追踪功能——告诉你用户是否看过 bot 的消息。无需额外权限，现有的 `im:message` scope 即可。

## 说明

- WebSocket 模式意味着机器人可以在 NAT/防火墙后运行，无需端口转发
- 仅处理文本消息；图片、文件等类型被忽略
- 群聊中使用 `mention-only` 策略（默认）时，机器人只响应直接 @它 的消息（可通过 `groupPolicy` 配置）
- 未开通 `contact:contact.base:readonly` 权限时，bot 将使用用户的 `open_id` 代替显示名称
- 未开通 `im:chat:readonly` 权限时，回复中的 @mention 将以纯文本形式发送，不触发飞书原生提及
