import type { ChannelAdapter, ChannelMessage, ReplyOptions, ImageAttachment } from '../channel.js';
import type { TelegramChannelConfig } from '../workspace.js';
import { markdownToHtml } from './telegram-format.js';
import { importPeer } from '../peer-require.js';

export class TelegramAdapter implements ChannelAdapter {
  readonly name = 'telegram';
  readonly maxMessageLength = 4096;
  private config: TelegramChannelConfig;
  private bot: any;
  private botUsername: string | undefined;
  private seenMsgIds = new Set<string>();
  private static readonly MAX_SEEN = 500;

  constructor(config: TelegramChannelConfig) {
    this.config = config;
  }

  async start(onMessage: (msg: ChannelMessage) => void): Promise<void> {
    let grammyModule: any;
    try {
      grammyModule = await importPeer('grammy');
    } catch {
      throw new Error(
        'Telegram adapter requires grammy. Install it: npm install grammy',
      );
    }

    const { Bot } = grammyModule;
    this.bot = new Bot(this.config.botToken);

    // Fetch bot username for group mention detection
    const me = await this.bot.api.getMe();
    this.botUsername = me.username;

    this.bot.on('message', async (ctx: any) => {
      const message = ctx.message;

      // Handle photo messages
      const images: ImageAttachment[] = [];
      if (message?.photo && message.photo.length > 0) {
        // Telegram sends multiple sizes; pick the largest
        const photo = message.photo[message.photo.length - 1];
        try {
          const file = await this.bot.api.getFile(photo.file_id);
          if (file.file_path) {
            const fileUrl = `https://api.telegram.org/file/bot${this.config.botToken}/${file.file_path}`;
            const resp = await fetch(fileUrl);
            if (resp.ok) {
              const buf = Buffer.from(await resp.arrayBuffer());
              const ext = file.file_path.split('.').pop() || 'jpg';
              const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';
              images.push({ mimeType, data: buf, fileName: `photo.${ext}` });
            }
          }
        } catch (e) {
          console.error('[telegram] Failed to download photo:', (e as Error).message);
        }
      }

      const hasText = !!message?.text;
      const hasCaption = !!message?.caption;
      const hasImages = images.length > 0;
      if (!hasText && !hasCaption && !hasImages) return;

      const rawText = message.text || message.caption || (hasImages ? '(image)' : '');
      const entities = message.entities || message.caption_entities || [];
      // Deduplicate re-delivered updates (message_id is unique per chat).
      const dedupKey = `${message.chat.id}:${message.message_id}`;
      if (this.seenMsgIds.has(dedupKey)) return;
      this.seenMsgIds.add(dedupKey);
      if (this.seenMsgIds.size > TelegramAdapter.MAX_SEEN) {
        const entries = [...this.seenMsgIds];
        this.seenMsgIds = new Set(entries.slice(entries.length >> 1));
      }
      const chatType: 'dm' | 'group' =
        message.chat.type === 'private' ? 'dm' : 'group';
      let text: string = rawText;

      let mentioned: boolean | undefined;
      if (chatType === 'group') {
        // Detect whether this bot is @mentioned
        const botUsername = this.botUsername;
        const isMentioned = entities.some(
          (e: any) =>
            e.type === 'mention' &&
            text.slice(e.offset, e.offset + e.length) === `@${botUsername}`,
        );
        mentioned = isMentioned;
        if (isMentioned) {
          // Strip bot @mention from text
          text = text.replace(new RegExp(`@${botUsername}`, 'g'), '').trim();
          // Empty after stripping (bare @mention with no follow-up text)
          if (!text && !hasImages) return;
          if (!text) text = '(image)';
        }
        // For non-mentioned group messages, still forward to gateway so that
        // smart/always groupPolicy modes can observe and act on them.
      }

      onMessage({
        channelType: 'telegram',
        senderId: String(message.from?.id ?? message.chat.id),
        senderName: message.from?.first_name,
        chatId: String(message.chat.id),
        chatType,
        text,
        images: images.length > 0 ? images : undefined,
        mentioned,
        raw: message,
      });
    });

    // Start long-polling (non-blocking)
    this.bot.start().catch(() => {});
    console.log(`[telegram] Long-polling started (@${this.botUsername})`);
  }

  async reply(msg: ChannelMessage, text: string, options?: ReplyOptions): Promise<void> {
    if (!this.bot) return;
    await this.bot.api.sendMessage(Number(msg.chatId), markdownToHtml(text), {
      parse_mode: 'HTML',
    });
  }

  async send(chatId: string, text: string): Promise<void> {
    if (!this.bot) return;
    await this.bot.api.sendMessage(Number(chatId), markdownToHtml(text), {
      parse_mode: 'HTML',
    });
  }

  async typing(msg: ChannelMessage): Promise<void> {
    if (!this.bot) return;
    await this.bot.api.sendChatAction(Number(msg.chatId), 'typing').catch(() => {});
  }

  async stop(): Promise<void> {
    if (this.bot) {
      await this.bot.stop();
      this.bot = null;
    }
  }
}
