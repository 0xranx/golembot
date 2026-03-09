/**
 * IM Image Test Bot
 *
 * Tests multimodal (image) message handling across all IM adapters.
 * Send an image to the bot → it reports what it received (mimeType, size, fileName).
 * Send text + image → it reports both.
 *
 * Run:
 *   pnpm run build && npx tsx examples/im-image-test.ts
 *
 * Usage:
 *   1. Send a standalone image → bot replies with image metadata
 *   2. Send an image with caption/text → bot replies with text + image metadata
 *   3. Send "test" → bot replies confirming text-only still works
 *   4. Send a post/rich-text with inline images (Feishu) → bot reports all
 *
 * Env vars (same as im-format-test.ts):
 *   FEISHU_APP_ID + FEISHU_APP_SECRET
 *   TELEGRAM_BOT_TOKEN
 *   SLACK_BOT_TOKEN + SLACK_APP_TOKEN
 *   DISCORD_BOT_TOKEN + DISCORD_BOT_NAME
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

// ── Stats ──────────────────────────────────────────────────

let totalMessages = 0;
let imageMessages = 0;
let textOnlyMessages = 0;

// ── Adapter loaders ────────────────────────────────────────

const adapters: ChannelAdapter[] = [];

async function tryLoadFeishu() {
  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;
  if (!appId || !appSecret) return;

  const { FeishuAdapter } = await import('../dist/channels/feishu.js');
  const adapter = new FeishuAdapter({ appId, appSecret } as any);
  adapters.push(adapter);
  console.log('[feishu] adapter loaded');
}

async function tryLoadTelegram() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return;

  const { TelegramAdapter } = await import('../dist/channels/telegram.js');
  const adapter = new TelegramAdapter({ botToken } as any);
  adapters.push(adapter);
  console.log('[telegram] adapter loaded');
}

async function tryLoadSlack() {
  const botToken = process.env.SLACK_BOT_TOKEN;
  const appToken = process.env.SLACK_APP_TOKEN;
  if (!botToken || !appToken) return;

  const { SlackAdapter } = await import('../dist/channels/slack.js');
  const adapter = new SlackAdapter({ botToken, appToken } as any);
  adapters.push(adapter);
  console.log('[slack] adapter loaded');
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

// ── Helpers ────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Message handler ────────────────────────────────────────

function handleMessage(adapter: ChannelAdapter) {
  return async (msg: ChannelMessage) => {
    totalMessages++;
    const name = adapter.name;
    const text = msg.text?.trim() || '';
    const images = msg.images || [];

    // Log what we received
    const imageInfo = images.length > 0
      ? ` + ${images.length} image(s)`
      : '';
    console.log(
      `[${name}] ${msg.senderName || msg.senderId} (${msg.chatType}): ` +
      `"${text.slice(0, 60)}"${imageInfo}`,
    );

    // Build reply
    const lines: string[] = [];

    if (images.length > 0) {
      imageMessages++;
      lines.push(`**Received ${images.length} image(s):**\n`);
      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        lines.push(
          `${i + 1}. \`${img.mimeType}\` — ${formatBytes(img.data.length)}` +
          (img.fileName ? ` — \`${img.fileName}\`` : ''),
        );
      }
      lines.push('');
      if (text && text !== '(image)') {
        lines.push(`**Text:** ${text}`);
      }
      lines.push(`\n_Image multimodal support is working!_`);
    } else {
      textOnlyMessages++;
      if (text.toLowerCase() === 'test') {
        lines.push('Text-only message received. Image support is enabled but no images attached.');
        lines.push('Try sending me an image!');
      } else if (text.toLowerCase() === 'stats') {
        lines.push(`**Image Test Stats:**`);
        lines.push(`- Total messages: ${totalMessages}`);
        lines.push(`- With images: ${imageMessages}`);
        lines.push(`- Text only: ${textOnlyMessages}`);
      } else {
        lines.push(`Echo: **${text}**`);
        lines.push(`\n_Send an image to test multimodal support._`);
      }
    }

    const reply = lines.join('\n');

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
    tryLoadFeishu(),
    tryLoadTelegram(),
    tryLoadSlack(),
    tryLoadDiscord(),
  ]);

  if (adapters.length === 0) {
    console.error('No adapters loaded. Set at least one set of env vars:');
    console.error('  FEISHU_APP_ID + FEISHU_APP_SECRET');
    console.error('  TELEGRAM_BOT_TOKEN');
    console.error('  SLACK_BOT_TOKEN + SLACK_APP_TOKEN');
    console.error('  DISCORD_BOT_TOKEN + DISCORD_BOT_NAME');
    process.exit(1);
  }

  console.log(`\nStarting ${adapters.length} adapter(s)...\n`);
  console.log('Image Test Bot ready! Send images to test multimodal support.');
  console.log('Commands: "test" = text-only check, "stats" = show stats\n');

  for (const adapter of adapters) {
    await adapter.start(handleMessage(adapter));
    console.log(`[${adapter.name}] started — waiting for messages`);
  }

  process.on('SIGINT', async () => {
    console.log(`\n\nShutdown. Stats: ${totalMessages} msgs, ${imageMessages} with images, ${textOnlyMessages} text-only`);
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
