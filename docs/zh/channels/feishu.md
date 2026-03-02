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
4. 在**权限管理**中，添加：
   - `im:message` — 发送消息
   - `im:message:readonly` — 接收消息
   - `im:message.group_at_msg:readonly` — 接收群聊中 @机器人 的消息
5. 发布应用版本并由管理员审批

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

## 工作原理

- **传输**：通过 `@larksuiteoapi/node-sdk` 的 `WSClient` 建立 WebSocket 长连接
- **事件**：监听 `im.message.receive_v1` 事件（仅文本消息）
- **回复**：通过 `client.im.v1.message.create()` 使用 `chat_id` 发送消息
- **聊天类型**：支持单聊（私信）和群聊
- **群聊 @mention 过滤**：群聊中机器人只在被直接 @提及时才响应，@mention 的 key 会在传给引擎前自动从消息文本中剥除

## 启动

```bash
golembot gateway --verbose
```

适配器启动时通过 WebSocket 连接飞书。`--verbose` 模式下消息日志带 `[feishu]` 前缀。

## 说明

- WebSocket 模式意味着机器人可以在 NAT/防火墙后运行，无需端口转发
- 仅处理文本消息；图片、文件等类型被忽略
- 群聊中，机器人只响应直接 @它 的消息，其余群消息一律忽略
