[English](README.md) | [中文](README.zh-CN.md)

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/0xranx/golembot/main/docs/assets/logo-golem-light.svg">
    <img src="https://raw.githubusercontent.com/0xranx/golembot/main/docs/assets/logo-golem-dark.svg" alt="GolemBot" width="560">
  </picture>
</p>

<p align="center">
  <a href="https://0xranx.github.io/golembot/"><img src="https://img.shields.io/badge/文档-0xranx.github.io%2Fgolembot-blue?style=for-the-badge" alt="文档"></a>
  <a href="https://github.com/0xranx/golembot/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/0xranx/golembot/ci.yml?branch=main&style=for-the-badge" alt="CI"></a>
  <a href="https://www.npmjs.com/package/golembot"><img src="https://img.shields.io/npm/v/golembot.svg?style=for-the-badge" alt="npm version"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge" alt="MIT License"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg?style=for-the-badge" alt="Node.js"></a>
</p>

<p align="center"><strong>你的 Coding Agent 被困在终端里。GolemBot 把它释放出来。</strong></p>

<p align="center">
  🔌 兼容 <a href="https://clawhub.ai"><strong>13,000+ OpenClaw 社区技能</strong></a> —— 最大的 AI agent 技能生态。一条命令即可搜索安装。
</p>

<p align="center">
  📖 <a href="https://0xranx.github.io/golembot/"><strong>文档与指南 → 0xranx.github.io/golembot</strong></a>
</p>

---

Cursor、Claude Code、OpenCode、Codex —— 这些 Coding Agent 已经能写代码、跑脚本、分析数据、进行复杂推理。但它们被困在 IDE 或终端窗口里。

**GolemBot 给它们一个身体。** 一条命令就能把你的 Coding Agent 接入 Slack、Telegram、Discord、飞书、钉钉、企业微信，或任何 HTTP 客户端。写一个自定义 Adapter 即可接入邮件、GitHub Issue 等任意消息来源。也可以 5 行代码嵌入你自己的产品。不需要 AI 框架，不需要 prompt 工程 —— 你已有的 Agent 就是大脑。

## 让你的 Coding Agent 跑在任何地方

### 接入 IM —— 团队的 7x24 AI 队友

```bash
golembot init -e claude-code -n my-bot
golembot gateway    # Slack、Telegram、Discord、飞书、钉钉、企业微信
```

同事在群里 @ 机器人，它能写代码、分析文件、回答问题 —— 因为背后是一个真正的 Coding Agent，不是套壳 API。

### 嵌入你的产品 —— 5 行代码，完整 Agent 能力

```typescript
import { createAssistant } from 'golembot';
const bot = createAssistant({ dir: './my-agent' });

for await (const event of bot.chat('分析上个月的销售数据')) {
  if (event.type === 'text') process.stdout.write(event.content);
}
```

嵌入 Slack 机器人、内部工具、SaaS 产品、客服系统 —— 任何跑 Node.js 的地方。

## 为什么选 GolemBot，而不是其他 AI 框架？

| | GolemBot | 传统 AI 框架 |
|---|---|---|
| **AI 大脑** | Cursor / Claude Code / OpenCode / Codex —— 久经考验，完整编码能力 | 你自己从 LLM API + 工具开始拼装 |
| **上手成本** | `golembot init` → 搞定 | Chains、RAG、向量数据库、prompt 调优…… |
| **自动升级** | Agent 变强了？你的助手自动变强，零代码改动 | 你自己维护所有东西 |
| **透明度** | `ls` 目录 = 看到助手知道什么、做了什么 | 黑盒流水线 |
| **引擎锁定** | 改一行配置换引擎 | 全部重写 |
| **技能生态** | ClawHub 13,000+ 社区技能，一条命令安装 | 自己从零编写工具和 prompt |

## 快速开始

```bash
npm install -g golembot

mkdir my-bot && cd my-bot
golembot onboard      # 引导式安装（推荐）

# 或手动：
golembot init -e claude-code -n my-bot
golembot run          # REPL 对话
golembot gateway      # 启动 IM + HTTP 服务
golembot skill search "数据分析"  # 浏览 13,000+ ClawHub 社区技能
```

## 架构

```
Slack / Telegram / Discord / 飞书 / 钉钉 / 企业微信 / HTTP API
     自定义 Adapter（邮件、GitHub Issue……）
                    │
                    ▼
         ┌─────────────────────────┐
         │      Gateway 服务        │
         │  (通道适配器 +           │
         │   HTTP 服务)             │
         └────────────┬────────────┘
                      │
              createAssistant()
                      │
          ┌───────┬───────┬───────┐
          ▼       ▼       ▼       ▼
       Cursor  Claude  OpenCode  Codex
               Code
```

## 引擎对比

| | Cursor | Claude Code | OpenCode | Codex |
|---|---|---|---|---|
| Skill 注入 | `.cursor/skills/` | `.claude/skills/` + CLAUDE.md | `.opencode/skills/` + opencode.json | workspace 根目录的 `AGENTS.md` |
| 会话恢复 | `--resume` | `--resume` | `--session` | `exec resume <thread_id>` |
| API Key | CURSOR_API_KEY | ANTHROPIC_API_KEY | 取决于 Provider | OPENAI_API_KEY 或 ChatGPT OAuth |

所有引擎暴露的 `StreamEvent` 接口完全一致 —— 切换引擎无需改任何代码。

## 配置

`golem.yaml` —— 唯一的配置文件：

```yaml
name: my-assistant
engine: claude-code

channels:
  slack:
    botToken: ${SLACK_BOT_TOKEN}
    appToken: ${SLACK_APP_TOKEN}
  telegram:
    botToken: ${TELEGRAM_BOT_TOKEN}
  discord:
    botToken: ${DISCORD_BOT_TOKEN}
    botName: my-assistant        # 与上面的 name 字段保持一致，用于 @mention 检测
  feishu:
    appId: ${FEISHU_APP_ID}
    appSecret: ${FEISHU_APP_SECRET}
  # 自定义 Adapter —— 本地文件或 npm 包
  my-email:
    _adapter: ./adapters/email-adapter.js
    token: ${EMAIL_TOKEN}

gateway:
  port: 3000
  token: ${GOLEM_TOKEN}
```

敏感字段支持 `${ENV_VAR}` 引用环境变量。自定义通道 Adapter 可以是本地 `.js`/`.mjs` 文件或 npm 包 —— [查看 Adapter 指南](https://0xranx.github.io/golembot/zh/api/channel-adapter)。

## Skill 系统

Skill 就是一个目录：`SKILL.md` + 可选脚本。放进去，助手获得新能力；删掉，能力消失。

```
skills/
├── general/          # 内置：通用助手
│   └── SKILL.md
├── im-adapter/       # 内置：IM 回复规范
│   └── SKILL.md
└── my-custom-skill/  # 你自己的
    ├── SKILL.md
    └── analyze.py
```

`ls skills/` 就是助手能力的完整清单。

## 13,000+ ClawHub 社区技能

GolemBot 与 [ClawHub](https://clawhub.ai) 完全兼容 —— OpenClaw 旗下最大的 AI agent 技能市场。`SKILL.md` 格式 100% 兼容，13,000+ 社区技能开箱即用。

```bash
golembot skill search "数据分析"           # 发现技能
golembot skill add clawhub:data-analysis  # 一条命令安装
```

**Agent 自主发现技能：** 你的 Agent 可以在对话中自主搜索和安装技能。对它说"帮我找个好用的代码审查 skill"—— 它会搜索 ClawHub、展示结果，你确认后自动安装。

所有 skill 命令支持 `--json` 输出，方便程序化调用。可插拔的 registry 接口支持未来接入更多技能来源。

## Docker 部署

```dockerfile
FROM node:22-slim
RUN npm install -g golembot
WORKDIR /assistant
COPY . .
EXPOSE 3000
CMD ["golembot", "gateway"]
```

## 开发

```bash
git clone https://github.com/0xranx/golembot.git
cd golembot
pnpm install
pnpm run build
pnpm run test          # 单元测试 (776+)
pnpm run e2e:opencode  # 端到端测试（OpenCode）
pnpm run e2e:codex     # 端到端测试（Codex）
```

## 许可证

[MIT](LICENSE)
