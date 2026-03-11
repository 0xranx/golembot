import type { ChannelAdapter, ChannelMessage, ImageAttachment, ReplyOptions } from '../channel.js';
import { importPeer } from '../peer-require.js';
import type { DiscordChannelConfig } from '../workspace.js';

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
      throw new Error('Discord adapter requires discord.js. Install it: npm install discord.js');
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
      let text = (message.content || '').replace(new RegExp(`<@!?${botId}>`, 'g'), botName ? `@${botName}` : '').trim();

      if (!text && images.length > 0) text = '(image)';

      onMessage({
        channelType: 'discord',
        senderId: message.author.id,
        senderName: message.author.username,
        chatId: isDM ? `dm-${message.author.id}` : message.channelId,
        chatType: isDM ? 'dm' : 'group',
        text,
        messageId: message.id,
        images: images.length > 0 ? images : undefined,
        mentioned,
        raw: message,
      });
    });
  }

  async getGroupMembers(chatId: string): Promise<Map<string, string>> {
    if (!this.client) return new Map();
    try {
      const channel = await this.client.channels.fetch(chatId);
      if (!channel?.guild) return new Map();
      const guildMembers = await channel.guild.members.fetch();
      const members = new Map<string, string>();
      for (const [id, member] of guildMembers) {
        if (member.user.bot) continue;
        const name = member.displayName || member.user.username;
        if (name) members.set(name, id);
      }
      return members;
    } catch {
      return new Map();
    }
  }

  async reply(msg: ChannelMessage, text: string, options?: ReplyOptions): Promise<void> {
    const raw = msg.raw as any;
    let finalText = text;
    if (options?.mentions) {
      for (const m of options.mentions) {
        finalText = finalText.replace(
          new RegExp(`@${m.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'),
          `<@${m.platformId}>`,
        );
      }
    }
    await raw.reply({ content: finalText });
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

  async fetchHistory(chatId: string, since: Date, limit = 50): Promise<ChannelMessage[]> {
    if (!this.client) return [];
    const messages: ChannelMessage[] = [];

    try {
      const channel = await this.client.channels.fetch(chatId);
      if (!channel?.isTextBased?.()) return [];

      // Discord: fetch messages after `since` using snowflake comparison
      // Convert Date to Discord snowflake: (timestamp - DISCORD_EPOCH) << 22
      const DISCORD_EPOCH = 1420070400000n;
      const afterSnowflake = String((BigInt(since.getTime()) - DISCORD_EPOCH) << 22n);

      const fetched = await channel.messages.fetch({ after: afterSnowflake, limit });

      // Discord returns newest first in Collection; convert to array and reverse
      const sorted = [...fetched.values()].reverse();

      for (const msg of sorted) {
        if (msg.author.bot) continue;
        if (!msg.content) continue;

        messages.push({
          channelType: 'discord',
          senderId: msg.author.id,
          senderName: msg.author.username,
          chatId,
          chatType: 'group',
          text: msg.content,
          messageId: msg.id,
          raw: msg,
        });
      }
    } catch (e) {
      console.error(`[discord] fetchHistory error:`, (e as Error).message);
    }

    return messages;
  }

  async listChats(): Promise<Array<{ chatId: string; chatType: 'dm' | 'group' }>> {
    if (!this.client) return [];
    const chats: Array<{ chatId: string; chatType: 'dm' | 'group' }> = [];

    try {
      // List guild text channels
      for (const [, guild] of this.client.guilds.cache) {
        const channels = await guild.channels.fetch();
        for (const [, channel] of channels) {
          if (channel?.isTextBased?.() && !channel.isVoiceBased?.()) {
            chats.push({ chatId: channel.id, chatType: 'group' });
          }
        }
      }

      // List open DM channels via REST API
      try {
        const dmChannels = (await this.client.rest.get('/users/@me/channels')) as any[];
        for (const ch of dmChannels) {
          if (ch.type === 1) {
            // type 1 = DM; use the real channel ID (fetchHistory needs it)
            chats.push({ chatId: ch.id, chatType: 'dm' });
          }
        }
      } catch {
        // DM channel listing is best-effort
      }
    } catch (e) {
      console.error(`[discord] listChats error:`, (e as Error).message);
    }

    return chats;
  }

  async stop(): Promise<void> {
    this.client?.destroy();
    this.client = null;
  }
}
