import type { ChannelAdapter, ChannelMessage } from '../channel.js';
import type { DiscordChannelConfig } from '../workspace.js';

export class DiscordAdapter implements ChannelAdapter {
  readonly name = 'discord';
  /** Discord's per-message character limit for regular messages. */
  readonly maxMessageLength = 2000;

  private config: DiscordChannelConfig;
  private client: any = null;

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

      const isDM = !message.guild;

      // Detect mention via Discord's native <@userId> token (works even without botName).
      const mentionPattern = new RegExp(`<@!?${botId}>`);
      const mentioned = mentionPattern.test(message.content);

      // Normalize Discord mention tokens (<@botId>, <@!botId>) → @botName
      // so that gateway's detectMention(text, config.name) also works correctly.
      let text = message.content;
      if (botName) {
        text = text.replace(new RegExp(`<@!?${botId}>`, 'g'), `@${botName}`);
      }

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

  async reply(msg: ChannelMessage, text: string): Promise<void> {
    const raw = msg.raw as any;
    await raw.reply({ content: text });
  }

  async stop(): Promise<void> {
    this.client?.destroy();
    this.client = null;
  }
}
