---
layout: home

hero:
  name: GolemBot
  text: Run Your Coding Agent Everywhere
  tagline: Connect Cursor, Claude Code, OpenCode, or Codex to IM platforms, HTTP APIs, or your own product. Compatible with 13,000+ OpenClaw community skills.
  image:
    light: /logo-icon-light.svg
    dark: /logo-icon-dark.svg
    alt: GolemBot
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: API Reference
      link: /api/create-assistant
    - theme: alt
      text: Browse Skills
      link: /skills/overview

features:
  - icon:
      src: /icons/claw.svg
    title: 13,000+ OpenClaw Skills
    details: Fully compatible with the OpenClaw ecosystem. Search and install skills from ClawHub — the largest AI agent skill marketplace — with one command. Your agent can even discover and install skills autonomously during conversations.
  - icon:
      src: /icons/cpu.svg
    title: Your Agent Is the Brain
    details: GolemBot doesn't reinvent AI. It uses the Coding Agent you already have — Cursor, Claude Code, OpenCode, or Codex — as the engine. When the agent gets smarter, your assistant gets smarter automatically.
  - icon:
      src: /icons/plug.svg
    title: Connect Anywhere
    details: Connect to Slack, Telegram, Discord, Feishu, DingTalk, WeCom, or HTTP out of the box — no public URL required. Write a custom adapter to plug in email, GitHub Issues, or any other source. Or embed as a library in Express, Next.js, or any Node.js app in 5 lines.
  - icon:
      src: /icons/folder.svg
    title: Directory Is the Assistant
    details: Skills, memory, config, and work artifacts all live in one directory. Fully transparent, version-controllable, and shareable via git.
---

<div class="home-content">

## 13,000+ OpenClaw Community Skills

GolemBot's SKILL.md format is **100% compatible** with the [OpenClaw](https://clawhub.ai) ecosystem. Search and install any of the 13,000+ community skills from [ClawHub](https://clawhub.ai) — the largest AI agent skill marketplace. Your agent can even discover and install skills autonomously during conversations.

<div class="clawhub-demo">

```bash
$ golembot skill search "code review"

ClawHub results for "code review" (3):

  code-review          5-dimension code review with severity tiers
  pr-reviewer          Automated PR review with inline comments
  security-audit       Security vulnerability scanner for codebases

Install: golembot skill add clawhub:<slug>
```

</div>

## Quick Start

Install GolemBot globally, then create and run an assistant in seconds:

```bash
npm install -g golembot

mkdir my-bot && cd my-bot
golembot onboard          # guided setup wizard
golembot run              # interactive REPL
golembot gateway          # start IM + HTTP service
golembot skill search "data analysis"  # browse ClawHub skills
```

Or use as a library — 5 lines of code:

```typescript
import { createAssistant } from 'golembot'
const bot = createAssistant({ dir: './my-bot' })

for await (const ev of bot.chat('Analyze last month sales'))
  if (ev.type === 'text') process.stdout.write(ev.content)
```

## Supported Engines

Switch engines by changing one line in `golem.yaml` — the [StreamEvent](/api/stream-events) API stays the same.

<div class="engines-grid">
  <div class="engine-card">
    <a class="card-link" href="engines/cursor" aria-label="Cursor"></a>
    <svg class="engine-icon engine-icon-cursor" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M11.503.131 1.891 5.678a.84.84 0 0 0-.42.726v11.188c0 .3.162.575.42.724l9.609 5.55a1 1 0 0 0 .998 0l9.61-5.55a.84.84 0 0 0 .42-.724V6.404a.84.84 0 0 0-.42-.726L12.497.131a1.01 1.01 0 0 0-.996 0M2.657 6.338h18.55c.263 0 .43.287.297.515L12.23 22.918c-.062.107-.229.064-.229-.06V12.335a.59.59 0 0 0-.295-.51l-9.11-5.257c-.109-.063-.064-.23.061-.23"/></svg>
    <div class="engine-name">Cursor</div>
    <div class="engine-desc">Cursor IDE's agent CLI</div>
    <code>CURSOR_API_KEY</code>
  </div>
  <div class="engine-card">
    <a class="card-link" href="engines/claude-code" aria-label="Claude Code"></a>
    <svg class="engine-icon engine-icon-claude" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z"/></svg>
    <div class="engine-name">Claude Code</div>
    <div class="engine-desc">Anthropic's coding agent</div>
    <code>ANTHROPIC_API_KEY</code>
  </div>
  <div class="engine-card">
    <a class="card-link" href="engines/opencode" aria-label="OpenCode"></a>
    <svg class="engine-icon engine-icon-opencode" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 300" fill="currentColor"><path d="M180 240H60V120H180V240Z" opacity="0.4"/><path fill-rule="evenodd" clip-rule="evenodd" d="M180 60H60V240H180V60ZM240 300H0V0H240V300Z"/></svg>
    <div class="engine-name">OpenCode</div>
    <div class="engine-desc">Open-source, multi-provider</div>
    <code>OPENAI_API_KEY / ANTHROPIC_API_KEY / ...</code>
  </div>
  <div class="engine-card">
    <a class="card-link" href="engines/codex" aria-label="Codex"></a>
    <svg class="engine-icon engine-icon-codex" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"/></svg>
    <div class="engine-name">Codex</div>
    <div class="engine-desc">OpenAI's coding agent</div>
    <code>CODEX_API_KEY</code>
  </div>
</div>

## Channels

Connect to any message source. Built-in adapters need no public URL. Add `_adapter: <path>` to `golem.yaml` to plug in email, GitHub Issues, or anything else — [write your own adapter](api/channel-adapter).

<div class="channels-grid">
  <div class="channel-card">
    <a class="card-link" href="channels/slack" aria-label="Slack"></a>
    <img class="channel-icon" src="/icons/slack.svg" alt="Slack" />
    <div class="channel-name">Slack</div>
    <div class="channel-transport">Socket Mode</div>
  </div>
  <div class="channel-card">
    <a class="card-link" href="channels/telegram" aria-label="Telegram"></a>
    <img class="channel-icon" src="/icons/telegram.svg" alt="Telegram" />
    <div class="channel-name">Telegram</div>
    <div class="channel-transport">Long-Polling</div>
  </div>
  <div class="channel-card">
    <a class="card-link" href="channels/discord" aria-label="Discord"></a>
    <img class="channel-icon" src="/icons/discord.svg" alt="Discord" />
    <div class="channel-name">Discord</div>
    <div class="channel-transport">Gateway WebSocket</div>
  </div>
  <div class="channel-card">
    <a class="card-link" href="channels/feishu" aria-label="Feishu"></a>
    <img class="channel-icon" src="/icons/feishu.svg" alt="Feishu" />
    <div class="channel-name">Feishu (Lark)</div>
    <div class="channel-transport">WebSocket</div>
  </div>
  <div class="channel-card">
    <a class="card-link" href="channels/dingtalk" aria-label="DingTalk"></a>
    <img class="channel-icon" src="/icons/dingtalk.svg" alt="DingTalk" />
    <div class="channel-name">DingTalk</div>
    <div class="channel-transport">Stream</div>
  </div>
  <div class="channel-card">
    <a class="card-link" href="channels/wecom" aria-label="WeCom"></a>
    <img class="channel-icon" src="/icons/wecom.svg" alt="WeCom" />
    <div class="channel-name">WeCom</div>
    <div class="channel-transport">Webhook</div>
  </div>
  <div class="channel-card">
    <a class="card-link" href="api/http-api" aria-label="HTTP API"></a>
    <svg class="channel-icon channel-icon-http" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v2a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z"/><path d="M3 15a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v2a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z"/><circle cx="7" cy="8" r=".5" fill="currentColor"/><circle cx="7" cy="16" r=".5" fill="currentColor"/></svg>
    <div class="channel-name">HTTP API</div>
    <div class="channel-transport">SSE</div>
  </div>
  <div class="channel-card channel-card-custom">
    <a class="card-link" href="api/channel-adapter" aria-label="Custom Adapter"></a>
    <svg class="channel-icon channel-icon-custom" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/></svg>
    <div class="channel-name">Custom</div>
    <div class="channel-transport">_adapter: &lt;path&gt;</div>
  </div>
</div>

</div>

<style>
.home-content {
  max-width: 960px;
  margin: 0 auto;
  padding: 0 24px 96px;
}

.home-content h2 {
  font-size: 24px;
  font-weight: 700;
  margin: 64px 0 16px;
  border-bottom: none;
}

.engines-grid,
.channels-grid {
  display: grid;
  gap: 16px;
  margin-top: 16px;
}

.engines-grid {
  grid-template-columns: repeat(4, 1fr);
}

.channels-grid {
  grid-template-columns: repeat(3, 1fr);
}

.engine-card,
.channel-card {
  position: relative;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  padding: 24px;
  text-align: center;
  transition: border-color 0.25s, box-shadow 0.25s;
}

.engine-card:hover,
.channel-card:hover {
  border-color: var(--vp-c-brand-1);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
}

.card-link {
  position: absolute;
  inset: 0;
  border-radius: 12px;
}

.engine-icon {
  width: 36px;
  height: 36px;
  margin: 0 auto 12px;
}

.engine-icon-cursor { color: #000; }
.dark .engine-icon-cursor { color: #fff; }

.engine-icon-claude { color: #D97757; }

.engine-icon-opencode { color: #211E1E; }
.dark .engine-icon-opencode { color: #F1ECEC; }

.engine-icon-codex { color: #412991; }
.dark .engine-icon-codex { color: #a78bfa; }

.engine-name,
.channel-name {
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 4px;
}

.engine-desc {
  font-size: 14px;
  color: var(--vp-c-text-2);
  margin-bottom: 12px;
}

.engine-card code {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-2);
}

.channel-icon {
  width: 36px;
  height: 36px;
  margin: 0 auto 12px;
}

.channel-icon-http { color: var(--vp-c-text-2); }

.channel-icon-custom { color: var(--vp-c-brand-1); }

.channel-card-custom {
  border-style: dashed;
  border-color: var(--vp-c-brand-soft);
}

.channel-transport {
  font-size: 13px;
  color: var(--vp-c-text-3);
  margin-top: 4px;
}

@media (max-width: 960px) {
  .engines-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 768px) {
  .engines-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  .channels-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 480px) {
  .engines-grid {
    grid-template-columns: 1fr;
  }
}

.clawhub-demo {
  background: var(--vp-c-bg-soft);
  border-radius: 12px;
  padding: 24px;
  margin-top: 16px;
}

.clawhub-demo pre {
  margin: 0;
  background: transparent !important;
}
</style>
