/**
 * IM Format Test Bot
 *
 * A minimal echo bot that replies with rich-formatted markdown to test
 * how each platform renders the converted output.
 *
 * Setup:
 *   Copy .env.example below and fill in tokens for the platforms you want to test.
 *
 * Run:
 *   pnpm run build && npx tsx examples/im-format-test.ts
 *
 * Usage:
 *   Send "test" to the bot → it replies with a markdown-rich message
 *   Send anything else → it echoes back with bold + code formatting
 *
 * .env.example:
 *   SLACK_BOT_TOKEN=xoxb-...
 *   SLACK_APP_TOKEN=xapp-...
 *   TELEGRAM_BOT_TOKEN=123456:ABC...
 *   DISCORD_BOT_TOKEN=...
 *   DISCORD_BOT_NAME=my-bot
 *   FEISHU_APP_ID=cli_...
 *   FEISHU_APP_SECRET=...
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ChannelAdapter, ChannelMessage } from '../dist/channel.js';

// Load .env manually (avoid dotenv dependency)
try {
  const envPath = resolve(process.cwd(), '.env');
  const lines = readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
} catch {}


// ── Rich markdown test message ─────────────────────────────

const TEST_MESSAGE = `# Format Test

**Bold text** and *italic text* and ~~strikethrough~~.

Here is a [link](https://github.com/0xranx/golembot) and some \`inline code\`.

## List

- Item one
- Item two
- Item three

1. First
2. Second
3. Third

## Code Block

\`\`\`typescript
const bot = createAssistant({ dir: './my-bot' });
for await (const event of bot.chat('hello')) {
  if (event.type === 'text') console.log(event.content);
}
\`\`\`

> This is a blockquote.

That's all — if this renders nicely, the format adapter works!`;

// ── Adapter loader ─────────────────────────────────────────

const adapters: ChannelAdapter[] = [];

async function tryLoadSlack() {
  const botToken = process.env.SLACK_BOT_TOKEN;
  const appToken = process.env.SLACK_APP_TOKEN;
  if (!botToken || !appToken) return;

  const { SlackAdapter } = await import('../dist/channels/slack.js');
  const adapter = new SlackAdapter({ botToken, appToken } as any);
  adapters.push(adapter);
  console.log('[slack] adapter loaded');
}

async function tryLoadTelegram() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return;

  const { TelegramAdapter } = await import('../dist/channels/telegram.js');
  const adapter = new TelegramAdapter({ botToken } as any);
  adapters.push(adapter);
  console.log('[telegram] adapter loaded');
}

async function tryLoadDiscord() {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) return;

  const { DiscordAdapter } = await import('../dist/channels/discord.js');
  const adapter = new DiscordAdapter({
    botToken,
    botName: process.env.DISCORD_BOT_NAME,
  } as any);
  adapters.push(adapter);
  console.log('[discord] adapter loaded');
}

async function tryLoadFeishu() {
  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;
  if (!appId || !appSecret) return;

  const { FeishuAdapter } = await import('../dist/channels/feishu.js');
  const adapter = new FeishuAdapter({ appId, appSecret } as any);
  adapters.push(adapter);
  console.log('[feishu] adapter loaded');
}

// ── Message handler ────────────────────────────────────────

function handleMessage(adapter: ChannelAdapter) {
  return async (msg: ChannelMessage) => {
    const name = adapter.name;
    const text = msg.text.trim();
    console.log(`[${name}] ${msg.senderName || msg.senderId}: ${text}`);

    // Strip bot mentions for keyword matching (e.g. "@GolemBot test" → "test")
    const stripped = text.replace(/<@!?\d+>/g, '').replace(/@\S+/g, '').trim();
    let reply: string;
    if (stripped.toLowerCase() === 'test') {
      reply = TEST_MESSAGE;
    } else {
      reply = `Echo: **${text}**\n\nYou said \`${text}\` in a ${msg.chatType} chat.`;
    }

    try {
      await adapter.reply(msg, reply);
      console.log(`[${name}] replied (${reply.length} chars)`);
    } catch (err: any) {
      console.error(`[${name}] reply error:`, err.message || err);
    }
  };
}

// ── Main ───────────────────────────────────────────────────

async function main() {
  await Promise.all([
    tryLoadSlack(),
    tryLoadTelegram(),
    tryLoadDiscord(),
    tryLoadFeishu(),
  ]);

  if (adapters.length === 0) {
    console.error('No adapters loaded. Set at least one set of env vars:');
    console.error('  SLACK_BOT_TOKEN + SLACK_APP_TOKEN');
    console.error('  TELEGRAM_BOT_TOKEN');
    console.error('  DISCORD_BOT_TOKEN');
    console.error('  FEISHU_APP_ID + FEISHU_APP_SECRET');
    process.exit(1);
  }

  console.log(`\nStarting ${adapters.length} adapter(s)...`);
  console.log('Send "test" to the bot for a rich markdown reply.\n');

  for (const adapter of adapters) {
    await adapter.start(handleMessage(adapter));
    console.log(`[${adapter.name}] started`);
  }

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    for (const adapter of adapters) {
      await adapter.stop().catch(() => {});
    }
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
