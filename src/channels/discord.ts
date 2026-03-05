import type { ChannelAdapter, ChannelMessage, ReplyOptions } from '../channel.js';
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
      // Use a variable to prevent TS Node16 resolver from treating 'discord.js'
      // as a local file path (the package name ends in .js).
      const pkg = 'discord.js';
      discordModule = await import(pkg);
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
      if (!message.content) return; // skip embed-only messages
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
      const mentioned = mentionPattern.test(message.content);

      // Normalize Discord mention tokens (<@botId>, <@!botId>):
      // - If botName is set: replace with @botName so gateway's detectMention works.
      // - If no botName: strip the token entirely so the engine receives clean text.
      let text = message.content.replace(
        new RegExp(`<@!?${botId}>`, 'g'),
        botName ? `@${botName}` : '',
      ).trim();

      onMessage({
        channelType: 'discord',
        senderId: message.author.id,
        senderName: message.author.username,
        chatId: isDM ? `dm-${message.author.id}` : message.channelId,
        chatType: isDM ? 'dm' : 'group',
        text,
        mentioned,
        raw: message,
      });
    });
  }

  async reply(msg: ChannelMessage, text: string, options?: ReplyOptions): Promise<void> {
    const raw = msg.raw as any;
    await raw.reply({ content: text });
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
