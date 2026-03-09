import type { ChannelAdapter, ChannelMessage, ReplyOptions, ImageAttachment } from '../channel.js';
import type { DiscordChannelConfig } from '../workspace.js';
import { importPeer } from '../peer-require.js';

export class DiscordAdapter implements ChannelAdapter {
  readonly name = 'discord';
  /** Discord's per-message character limit for regular messages. */
  readonly maxMessageLength = 2000;

  private config: DiscordChannelConfig;
  private client: any = null;
  private seenMsgIds = new Set<string>();
  private static readonly MAX_SEEN = 500;

  constructor(config: DiscordChannelConfig) {
    this.config = config;
  }

  async start(onMessage: (msg: ChannelMessage) => void | Promise<void>): Promise<void> {
    let discordModule: any;
    try {
      discordModule = await importPeer('discord.js');
    } catch {
      throw new Error(
        'Discord adapter requires discord.js. Install it: npm install discord.js',
      );
    }
    const { Client, GatewayIntentBits, Partials } = discordModule;

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent, // privileged — enable in Discord Developer Portal
        GatewayIntentBits.DirectMessages,
      ],
      partials: [Partials.Channel, Partials.Message],
    });

    await new Promise<void>((resolve, reject) => {
      this.client.once('ready', resolve);
      this.client.once('error', reject);
      this.client.login(this.config.botToken).catch(reject);
    });

    const botId: string = this.client.user.id;
    const botName = this.config.botName;

    this.client.on('messageCreate', async (message: any) => {
      if (message.author.bot) return;

      // Download image attachments
      const images: ImageAttachment[] = [];
      if (message.attachments?.size > 0) {
        for (const [, attachment] of message.attachments) {
          if (!attachment.contentType?.startsWith('image/')) continue;
          try {
            const resp = await fetch(attachment.url);
            if (resp.ok) {
              const buf = Buffer.from(await resp.arrayBuffer());
              images.push({ mimeType: attachment.contentType, data: buf, fileName: attachment.name });
            }
          } catch (e) {
            console.error('[discord] Failed to download attachment:', (e as Error).message);
          }
        }
      }

      if (!message.content && images.length === 0) return; // skip embed-only messages
      // Deduplicate re-delivered events.
      if (message.id) {
        if (this.seenMsgIds.has(message.id)) return;
        this.seenMsgIds.add(message.id);
        if (this.seenMsgIds.size > DiscordAdapter.MAX_SEEN) {
          const entries = [...this.seenMsgIds];
          this.seenMsgIds = new Set(entries.slice(entries.length >> 1));
        }
      }

      const isDM = !message.guild;

      // Detect mention via Discord's native <@userId> token (works even without botName).
      const mentionPattern = new RegExp(`<@!?${botId}>`);
      const mentioned = mentionPattern.test(message.content || '');

      // Normalize Discord mention tokens (<@botId>, <@!botId>):
      // - If botName is set: replace with @botName so gateway's detectMention works.
      // - If no botName: strip the token entirely so the engine receives clean text.
      let text = (message.content || '').replace(
        new RegExp(`<@!?${botId}>`, 'g'),
        botName ? `@${botName}` : '',
      ).trim();

      if (!text && images.length > 0) text = '(image)';

      onMessage({
        channelType: 'discord',
        senderId: message.author.id,
        senderName: message.author.username,
        chatId: isDM ? `dm-${message.author.id}` : message.channelId,
        chatType: isDM ? 'dm' : 'group',
        text,
        images: images.length > 0 ? images : undefined,
        mentioned,
        raw: message,
      });
    });
  }

  async reply(msg: ChannelMessage, text: string, options?: ReplyOptions): Promise<void> {
    const raw = msg.raw as any;
    await raw.reply({ content: text });
  }

  async send(chatId: string, text: string): Promise<void> {
    if (!this.client) return;
    const channel = await this.client.channels.fetch(chatId);
    if (channel?.isTextBased?.()) {
      await channel.send({ content: text });
    }
  }

  async typing(msg: ChannelMessage): Promise<void> {
    const raw = msg.raw as any;
    await raw.channel?.sendTyping?.().catch(() => {});
  }

  async stop(): Promise<void> {
    this.client?.destroy();
    this.client = null;
  }
}
