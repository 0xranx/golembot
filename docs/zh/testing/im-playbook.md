# IM 频道集成测试手册

本文档是自动化 `gateway-integration.test.ts` 测试套件的手动测试配套指南。
涵盖需要真实 bot 账号、实际群聊以及真实 AI 引擎（claude-code 或类似引擎）的
IM 实际场景。

---

## 前置条件

在运行任何平台测试之前：

1. **启动 bot**，使用真实引擎并配置所有频道：
   ```bash
   golem gateway --dir ./my-bot --verbose
   ```
   使用 `--verbose` 以便在终端查看每条接收和发送的消息。

2. **golem.yaml 基础配置**（根据测试平台调整）：
   ```yaml
   name: golem-test
   engine: claude-code

   groupChat:
     groupPolicy: mention-only   # 根据测试章节修改
     historyLimit: 20
     maxTurns: 10
   ```

3. **测试群组设置**：为每个平台创建专用测试群组/频道，包含：
   - 你（人类测试者）
   - bot 账号
   - 可选的第二个人类账号（用于多用户测试）

---

## 平台 A — Telegram

### 设置
- Bot token: `TELEGRAM_BOT_TOKEN`
- 创建测试群组，添加 bot
- 群聊测试需要 bot 为管理员（以读取消息）
- 可选在 @BotFather 中关闭 privacy mode → bot 可读取所有消息

### 测试用例

#### A-1 · 私聊基本流程
| 步骤 | 操作 | 预期结果 |
|------|------|----------|
| 1 | 打开与 bot 的私聊，发送: `What is 2+2?` | Bot 在 30 秒内回复 |
| 2 | 发送: `What did I just ask you?` | Bot 回忆起之前的问题（会话连续性） |
| 3 | 检查终端显示: `received from <you>: "What is 2+2?"` | ✓ verbose 日志 |

#### A-2 · 私聊长回复分割
| 步骤 | 操作 | 预期结果 |
|------|------|----------|
| 1 | 发送: `Write a 500-word essay about clouds` | Bot 发送多条 Telegram 消息，每条 ≤ 4096 字符 |
| 2 | 验证所有消息按顺序到达 | 无截断，自然分割点 |

#### A-3 · 群组 — mention-only（默认）
| 步骤 | 操作 | 预期结果 |
|------|------|----------|
| 1 | 在测试群中发送: `hello everyone` | Bot 不回复（未被 @mention） |
| 2 | 检查终端 | 该消息不应有 "received" 日志 |
| 3 | 发送: `@golem-test hello` | Bot 回复 |
| 4 | 终端显示 mention 检测 | `session key = telegram:CHAT_ID`（无用户 ID） |

#### A-4 · 群组 — smart 模式
将配置改为 `groupPolicy: smart`，重启 bot。
| 步骤 | 操作 | 预期结果 |
|------|------|----------|
| 1 | 发送: `We decided to use PostgreSQL for the new project` | Bot 可能回复（smart）或保持沉默 ([PASS]) |
| 2 | 发送: `@golem-test what database are we using?` | Bot 回答 "PostgreSQL"（使用了群组上下文） |
| 3 | 终端检查 `[PASS]` 日志 | bot 选择跳过的消息应出现此日志 |

#### A-5 · 群组 — maxTurns 保护
将配置改为 `maxTurns: 3`, `groupPolicy: always`，重启 bot。
| 步骤 | 操作 | 预期结果 |
|------|------|----------|
| 1 | 连续发送 4 条消息（任意文本） | Bot 回复前 3 条，第 4 条保持沉默 |
| 2 | 终端显示: `maxTurns (3) reached` | ✓ |
| 3 | 调用 `POST /reset`，`sessionKey: "telegram:CHAT_ID"` | 群组状态已清除 |
| 4 | 再发送一条消息 | Bot 重新开始回复 |

#### A-6 · 通过 HTTP API /reset
```bash
curl -X POST http://localhost:3000/reset \
  -H "Content-Type: application/json" \
  -d '{"sessionKey": "telegram:YOUR_CHAT_ID"}'
```
预期结果: `{"ok": true}`。然后发送私聊消息 — bot 不记得之前的对话。

---

## 平台 B — Discord

### 设置
- Bot token: `DISCORD_BOT_TOKEN`
- 在 Discord 开发者门户中启用 **Message Content Intent**（读取消息必须）
- 配置中的 `botName` 是可选的 — mention 检测通过 `<@botId>` 原生工作

### 测试用例

#### B-1 · 私聊基本流程
与 A-1 相同（验证私聊 session key = `discord:dm-USER_ID`）

#### B-2 · 群组 — 未配置 botName 时的 @mention
测试 `msg.mentioned` 字段路径（Discord 原生检测）：
| 步骤 | 操作 | 预期结果 |
|------|------|----------|
| 1 | 在频道配置中设置 `botName: ""` 或省略 `botName` | |
| 2 | 在服务器频道发送: `<@BOT_USER_ID> hello` | Bot 回复（即使没有 botName 也能原生检测 mention） |
| 3 | 发送: `hello without mention` | Bot 保持沉默（mention-only 模式） |

#### B-3 · 群组 — 配置了 botName 的 @mention
| 步骤 | 操作 | 预期结果 |
|------|------|----------|
| 1 | 在配置中设置 `botName: "golem-test"` | |
| 2 | 发送: `@golem-test help me` | Bot 回复 |
| 3 | 终端: prompt 中不应有 `<@userId>` token | 已规范化为 `@golem-test` |

#### B-4 · 消息长度限制（2000 字符）
| 步骤 | 操作 | 预期结果 |
|------|------|----------|
| 1 | 请求: `Write a detailed 3000-character story` | Bot 发送 ≥2 条 Discord 消息，每条 ≤2000 字符 |
| 2 | 两条消息都到达 | 无 Discord "message too long" 错误 |

#### B-5 · Bot 自回复防护
| 步骤 | 操作 | 预期结果 |
|------|------|----------|
| 1 | 设置 `groupPolicy: smart`，确保 bot 的 Discord 用户名与 `config.name` 匹配 | |
| 2 | 向 bot 提问；当 bot 回复时，验证 bot 自己的回复不会触发另一次响应 | 无无限循环 |

---

## 平台 C — Slack

### 设置
- `SLACK_BOT_TOKEN` (Bot User OAuth Token, `xoxb-...`)
- `SLACK_APP_TOKEN` (Socket Mode token, `xapp-...`)
- 必须在应用设置中启用 Socket Mode
- Bot 必须被邀请到测试频道: `/invite @golem-test`

### 测试用例

#### C-1 · 私聊基本流程
| 步骤 | 操作 | 预期结果 |
|------|------|----------|
| 1 | 私聊 bot: `tell me a joke` | Bot 回复 |
| 2 | 私聊 session key 格式: `slack:DM_CHANNEL_ID:USER_ID` | 检查终端 |

#### C-2 · 频道 — mention-only
| 步骤 | 操作 | 预期结果 |
|------|------|----------|
| 1 | 在测试频道发送: `good morning team` | Bot 保持沉默 |
| 2 | 发送: `<@BOT_USER_ID> what's the weather like?`（Slack 原生 mention） | Bot 回复 |
| 3 | 发送: `@golem-test what's 2+2?`（文字 mention） | Bot 回复 |

#### C-3 · 线程回复
> **注意**: 当前 adapter 在频道中回复，而非线程中。这是已知行为。
| 步骤 | 操作 | 预期结果 |
|------|------|----------|
| 1 | 在线程中 @mention bot | Bot 回复到线程（或顶层，取决于 adapter） |

#### C-4 · 多用户共享群组会话
| 步骤 | 操作 | 预期结果 |
|------|------|----------|
| 1 | 用户 A 说 `@golem-test my name is Alice` | Bot 确认 |
| 2 | 用户 B 说 `@golem-test what is Alice's name?` | Bot 正确回答（共享会话） |
| 3 | 终端: 两条消息使用 session key `slack:CHANNEL_ID`（无用户后缀） | ✓ |

#### C-5 · /reset 清除共享群组状态
| 步骤 | 操作 | 预期结果 |
|------|------|----------|
| 1 | 在 C-4 之后重置群组会话 | |
| 2 | 用户 B 说 `@golem-test what is Alice's name?` | Bot 说不知道（上下文已清除） |

---

## 平台 D — 飞书

### 设置
- 从飞书开放平台获取 App ID 和 App Secret
- 启用消息事件权限
- 将 bot 添加到测试群

### 测试用例

#### D-1 · 私聊基本流程
| 步骤 | 操作 | 预期结果 |
|------|------|----------|
| 1 | 私聊 bot: `你好` | Bot 用同一语言回复 |
| 2 | Session key 格式: `feishu:USER_OPEN_ID:USER_OPEN_ID`（私聊 chatId = userId） | 检查终端 |

#### D-2 · 群组 — XML 风格 @mention
飞书使用 `<at user_id="xxx">BotName</at>` 格式进行 mention。
| 步骤 | 操作 | 预期结果 |
|------|------|----------|
| 1 | 在群中 @mention bot（点击 bot 名称） | Bot 回复 |
| 2 | 终端: 清理后的 mention 文本传给引擎 | `<at...>` 标签已从 prompt 中移除 |
| 3 | 发送不含 mention 的消息 | Bot 保持沉默（mention-only） |

#### D-3 · 群组 — smart 模式与中文上下文
切换为 `groupPolicy: smart`。
| 步骤 | 操作 | 预期结果 |
|------|------|----------|
| 1 | 群成员: `我们明天开会讨论新功能` | Bot 观察（可能回复或 [PASS]） |
| 2 | @mention bot: `刚才说的新功能是什么?` | Bot 从群组上下文中回忆 |

#### D-4 · 附件/图片消息
| 步骤 | 操作 | 预期结果 |
|------|------|----------|
| 1 | 在群中发送图片（无文字） | Bot 忽略（空文本） |
| 2 | 终端: 无 "received" 日志 | ✓（adapter 应过滤非文本消息） |

---

## 平台 E — 钉钉

### 设置
- App Key 和 App Secret，Webhook 端点已配置
- Bot 已添加到测试群（企业内部应用）

### 测试用例

#### E-1 · 私聊基本流程
与 D-1 模式相同。

#### E-2 · 群组 — @mention 检测
钉钉使用 `@UserMobile` 或 `@botName` 风格。
| 步骤 | 操作 | 预期结果 |
|------|------|----------|
| 1 | 在群中 @mention bot | Bot 回复 |
| 2 | 验证消息长度 ≤ 4000 字符 | 钉钉限制得到遵守 |

#### E-3 · 群组会话跨用户共享
与 C-4 相同，但在钉钉群中。

---

## 平台 F — 企业微信

### 设置
- Corp ID、Agent ID、Agent Secret
- Bot 已添加到测试群或应用会话

### 测试用例

#### F-1 · 私聊基本流程
模式相同，注意 session key 格式。

#### F-2 · 消息长度限制（2048 字符）
| 步骤 | 操作 | 预期结果 |
|------|------|----------|
| 1 | 请求较长的回复 | Bot 在 ≤ 2048 字符处分割（企业微信限制） |

#### F-3 · 群组 — mention-only
| 步骤 | 操作 | 预期结果 |
|------|------|----------|
| 1 | 普通群消息 | Bot 保持沉默 |
| 2 | @mention bot | Bot 回复 |

---

## 跨平台验证清单

完成平台特定测试后，验证以下行为的一致性：

| 行为 | Telegram | Discord | Slack | 飞书 | 钉钉 | 企业微信 |
|------|----------|---------|-------|------|------|----------|
| 私聊 → 每用户 session key | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 群组 → 共享 session key | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| mention-only: 非 mention 被跳过 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| mention-only: mention 被回复 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 长回复正确分割 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| /reset 清除会话 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Bot 自回复未被触发 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 空 @mention 未发送给引擎 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

---

## 已知问题与注意事项

| 问题 | 影响平台 | 解决方法 |
|------|----------|----------|
| `botName` 必须与 `config.name` 完全匹配以防止自回复 | 所有 | 在 golem.yaml 中设置 `name: your-bot-username` |
| Discord: MessageContent intent 必须启用特权权限 | Discord | 在开发者门户中启用 |
| Slack: Socket Mode 需要单独的 App Token | Slack | 创建 `xapp-...` token |
| 飞书: 消息事件需要在开放平台订阅 | 飞书 | 启用 `im.message.receive_v1` |
| 企业微信: 群消息需要将应用配置为"群机器人" | 企业微信 | 检查企业管理员设置 |
| 钉钉: 出站 webhook 签名必须匹配 | 钉钉 | 在 golem.yaml 的 channels.dingtalk 中设置 `secret` |

---

## 报告问题

如果测试用例失败，请记录：
1. 接收消息和错误的 verbose 终端日志
2. IM 平台的原始载荷（如可见）
3. golem.yaml 的 channels 配置（脱敏 token）

提交 issue: https://github.com/0xranx/AgentForge/issues
