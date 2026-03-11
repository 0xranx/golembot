# 快速开始

## 前置条件

- **Node.js** >= 18
- 安装一个 Coding Agent CLI **并完成鉴权**：
  - [Cursor](https://docs.cursor.com/agent)（`agent` CLI）— 运行 `agent login` 或设置 `CURSOR_API_KEY`
  - [Claude Code](https://docs.anthropic.com/en/docs/claude-code)（`claude` CLI）— 运行 `claude auth login` 或设置 `ANTHROPIC_API_KEY`
  - [OpenCode](https://github.com/opencode-ai/opencode)（`opencode` CLI）— 设置对应 Provider 的 API Key（如 `ANTHROPIC_API_KEY`）
  - [Codex](https://developers.openai.com/codex/cli)（`codex` CLI）— 运行 `codex login` 或设置 `CODEX_API_KEY`

`golembot onboard` 向导会自动检测已有鉴权，未鉴权时引导你完成配置。也可以随时运行 `golembot doctor` 检查配置状态。

## 安装

```bash
npm install -g golembot
```

或使用 pnpm / yarn：

```bash
pnpm add -g golembot
# 或
yarn global add golembot
```

## 快速上手

### 方式 A：引导式设置（推荐）

```bash
mkdir my-bot && cd my-bot
golembot onboard
```

引导向导会带你完成引擎选择、鉴权、命名、IM 通道配置和场景模板选择，共 8 个交互步骤。使用 `--template <name>` 可跳过模板选择（如 `golembot onboard --template customer-support`）。

### 方式 B：手动初始化

```bash
mkdir my-bot && cd my-bot
golembot init -e claude-code -n my-bot
```

这会创建：
- `golem.yaml` — 助手配置文件
- `skills/` — 技能目录，包含内置技能（`general` + `im-adapter`）
- `AGENTS.md` — 为 Coding Agent 自动生成的上下文文档
- `.golem/` — 内部状态目录（gitignore）

### 开始对话

```bash
golembot run
```

这会打开交互式 REPL。输入消息按回车即可。Coding Agent 负责一切 — 读写文件、运行脚本、多步推理。

**REPL 命令：**
- `/help` — 显示可用命令
- `/status` — 显示当前引擎、模型和技能
- `/engine [name]` — 查看或切换引擎
- `/model [list|name]` — 查看、列出可用模型或切换模型
- `/skill` — 列出已安装技能
- `/cron` — 管理定时任务（列表、运行、启用、禁用、历史）
- `/reset` — 清除当前会话
- `/quit` 或 `/exit` — 退出

### 启动 Gateway 服务

```bash
golembot gateway
```

这会启动 HTTP API、Web Dashboard（`http://localhost:3000/`）以及已配置的 IM 通道适配器。Dashboard 显示实时指标、通道状态，并可直接在浏览器中测试 API。

<img src="/assets/dashboard.png" alt="GolemBot Dashboard" style="border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,.1);margin:16px 0" />

查看所有运行中的 bot：

```bash
golembot fleet ls          # 列出运行中的 bot（CLI）
golembot fleet serve       # 启动 Fleet Dashboard（Web，端口 4000）
```

<img src="/assets/fleet-dashboard.png" alt="GolemBot Fleet Dashboard" style="border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,.1);margin:16px 0" />

GolemBot 内置支持以下 IM 平台：

| 平台 | 连接方式 |
|------|---------|
| [飞书（Lark）](/zh/channels/feishu) | WebSocket 长连接（无需公网 IP） |
| [钉钉](/zh/channels/dingtalk) | Stream 模式（无需公网 IP） |
| [企业微信](/zh/channels/wecom) | Webhook 回调（需要公网 URL） |
| [Slack](/zh/channels/slack) | Socket Mode（无需公网 IP） |
| [Telegram](/zh/channels/telegram) | 轮询模式（无需公网 IP） |
| [Discord](/zh/channels/discord) | Gateway API（无需公网 IP） |

IM 配置详见[通道概览](/zh/channels/overview)。

## 作为库使用

GolemBot 的核心是一个可导入的 TypeScript 库：

```typescript
import { createAssistant } from 'golembot';

const assistant = createAssistant({ dir: './my-bot' });

for await (const event of assistant.chat('分析销售数据')) {
  if (event.type === 'text') process.stdout.write(event.content);
}
```

这种模式适用于嵌入 Slack 机器人、内部工具、SaaS 产品或任何 Node.js 应用。Express、Next.js、后台任务等完整示例见[嵌入到你的产品](/zh/guide/embed)指南。

## 下一步

- [配置说明](/zh/guide/configuration) — 了解 `golem.yaml` 和 `${ENV_VAR}` 占位符
- [群聊](/zh/guide/group-chat) — 响应策略、@mention、引用回复、群记忆
- [消息队列与离线追回](/zh/guide/inbox) — 崩溃安全队列、离线消息追回
- [引擎](/zh/engines/overview) — 对比 Cursor、Claude Code、OpenCode 和 Codex
- [嵌入到你的产品](/zh/guide/embed) — 库集成模式（Express、Next.js、队列任务）
