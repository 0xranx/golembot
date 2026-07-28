import type { ChannelAdapter, ChannelMessage, ImageAttachment, ReplyOptions } from '../channel.js';
import { importPeer } from '../peer-require.js';
import type { TelegramChannelConfig } from '../workspace.js';
import { markdownToHtml } from './telegram-format.js';

type TelegramSendMode = 'html' | 'plain';

interface TelegramSendOptions {
  chatId: number;
  text: string;
  mode: TelegramSendMode;
  replyToMessageId?: number;
  purpose: 'reply' | 'send' | 'status';
}

const TRANSIENT_RETRY_DELAYS_MS = [500, 1500] as const;

export class TelegramAdapter implements ChannelAdapter {
  readonly name = 'telegram';
  readonly maxMessageLength = 4096;
  private config: TelegramChannelConfig;
  private bot: any;
  private botUsername: string | undefined;
  private seenMsgIds = new Set<string>();
  private static readonly MAX_SEEN = 500;
  private allowedUserIds: Set<string> | null;

  constructor(config: TelegramChannelConfig) {
    this.config = config;
    this.allowedUserIds = config.allowedUserIds?.length ? new Set(config.allowedUserIds.map(String)) : null;
  }

  async start(onMessage: (msg: ChannelMessage) => void): Promise<void> {
    let grammyModule: any;
    try {
      grammyModule = await importPeer('grammy');
    } catch {
      throw new Error('Telegram adapter requires grammy. Install it: npm install grammy');
    }

    const { Bot } = grammyModule;
    this.bot = new Bot(this.config.botToken);

    // Fetch bot username for group mention detection
    const me = await this.bot.api.getMe();
    this.botUsername = me.username;

    this.bot.on('message', async (ctx: any) => {
      const message = ctx.message;
      const senderId = String(message.from?.id ?? '');
      if (this.allowedUserIds && !this.allowedUserIds.has(senderId)) {
        return;
      }

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
      const chatType: 'dm' | 'group' = message.chat.type === 'private' ? 'dm' : 'group';
      let text: string = rawText;

      let mentioned: boolean | undefined;
      if (chatType === 'group') {
        // Detect whether this bot is @mentioned
        const botUsername = this.botUsername;
        const isMentioned = entities.some(
          (e: any) => e.type === 'mention' && text.slice(e.offset, e.offset + e.length) === `@${botUsername}`,
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
        senderId: senderId || String(message.chat.id),
        senderName: message.from?.first_name,
        chatId: String(message.chat.id),
        chatType,
        text,
        messageId: String(message.message_id),
        images: images.length > 0 ? images : undefined,
        mentioned,
        raw: message,
      });
    });

    // Start long-polling (non-blocking)
    this.bot.start().catch(() => {});
    console.log(`[telegram] Long-polling started (@${this.botUsername})`);
  }

  async reply(msg: ChannelMessage, text: string, _options?: ReplyOptions): Promise<void> {
    if (!this.bot) return;
    await this.sendTelegramMessage({
      chatId: Number(msg.chatId),
      text,
      mode: 'html',
      replyToMessageId: parseTelegramMessageId(msg.messageId),
      purpose: 'reply',
    });
  }

  async send(chatId: string, text: string): Promise<void> {
    if (!this.bot) return;
    await this.sendTelegramMessage({
      chatId: Number(chatId),
      text,
      mode: 'html',
      purpose: 'send',
    });
  }

  async sendStatus(msg: ChannelMessage, text: string): Promise<string> {
    if (!this.bot) return '';
    const sent = await this.sendTelegramMessage({
      chatId: Number(msg.chatId),
      text,
      mode: 'plain',
      replyToMessageId: parseTelegramMessageId(msg.messageId),
      purpose: 'status',
    });
    return String(sent?.message_id ?? '');
  }

  async clearStatus(msg: ChannelMessage, statusId: string): Promise<void> {
    if (!this.bot || !statusId) return;
    const messageId = parseTelegramMessageId(statusId);
    if (messageId === undefined) return;
    try {
      await this.bot.api.deleteMessage(Number(msg.chatId), messageId);
    } catch (e) {
      console.warn(
        `[telegram] clearStatus failed: chat=${msg.chatId} status=${statusId} reason=${describeTelegramError(e)}`,
      );
    }
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

  private async sendTelegramMessage(options: TelegramSendOptions): Promise<any> {
    let mode = options.mode;
    let replyToMessageId = options.replyToMessageId;
    let transientRetries = 0;
    let rateLimitRetries = 0;
    let attempt = 0;

    while (true) {
      attempt++;
      const sendOptions: Record<string, unknown> = {};
      if (mode === 'html') sendOptions.parse_mode = 'HTML';
      if (replyToMessageId !== undefined) sendOptions.reply_to_message_id = replyToMessageId;

      try {
        return await this.bot.api.sendMessage(
          options.chatId,
          mode === 'html' ? markdownToHtml(options.text) : options.text,
          sendOptions,
        );
      } catch (e) {
        if (mode === 'html' && isTelegramParseError(e)) {
          console.warn(this.formatSendLog('fallback=plain', options, attempt, e, replyToMessageId));
          mode = 'plain';
          continue;
        }

        if (replyToMessageId !== undefined && isTelegramReplyTargetError(e)) {
          console.warn(this.formatSendLog('fallback=no-reply', options, attempt, e, replyToMessageId));
          replyToMessageId = undefined;
          continue;
        }

        const retryAfterMs = getTelegramRetryAfterMs(e);
        if (retryAfterMs !== undefined && rateLimitRetries < 1) {
          rateLimitRetries++;
          console.warn(
            this.formatSendLog(`retry=rate-limit delayMs=${retryAfterMs}`, options, attempt, e, replyToMessageId),
          );
          await sleep(retryAfterMs);
          continue;
        }

        if (isTransientTelegramError(e) && transientRetries < TRANSIENT_RETRY_DELAYS_MS.length) {
          const delayMs = TRANSIENT_RETRY_DELAYS_MS[transientRetries++];
          console.warn(this.formatSendLog(`retry=transient delayMs=${delayMs}`, options, attempt, e, replyToMessageId));
          await sleep(delayMs);
          continue;
        }

        console.warn(this.formatSendLog('failed', options, attempt, e, replyToMessageId));
        throw e;
      }
    }
  }

  private formatSendLog(
    action: string,
    options: TelegramSendOptions,
    attempt: number,
    error: unknown,
    replyToMessageId?: number,
  ): string {
    return [
      `[telegram] sendMessage ${action}`,
      `purpose=${options.purpose}`,
      `chat=${options.chatId}`,
      `replyTo=${replyToMessageId ?? '-'}`,
      `attempt=${attempt}`,
      `reason=${describeTelegramError(error)}`,
    ].join(' ');
  }
}

function parseTelegramMessageId(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeTelegramError(error: unknown): string {
  const e = error as {
    code?: string;
    error_code?: number;
    description?: string;
    message?: string;
    parameters?: { retry_after?: number };
  };
  const code = e.error_code ?? e.code ?? 'unknown';
  const description = e.description ?? e.message ?? String(error);
  return `${code}:${description.replace(/\s+/g, ' ').slice(0, 180)}`;
}

function getTelegramErrorText(error: unknown): string {
  const e = error as { description?: string; message?: string; code?: string; error_code?: number };
  return `${e.error_code ?? ''} ${e.code ?? ''} ${e.description ?? ''} ${e.message ?? ''}`.toLowerCase();
}

function isTelegramParseError(error: unknown): boolean {
  return /parse entities|can't parse|unsupported start tag|can't find end tag|entity/.test(getTelegramErrorText(error));
}

function isTelegramReplyTargetError(error: unknown): boolean {
  return /reply message not found|message to be replied not found|replied message not found|reply_to_message_id|message thread not found/.test(
    getTelegramErrorText(error),
  );
}

function getTelegramRetryAfterMs(error: unknown): number | undefined {
  const e = error as { error_code?: number; parameters?: { retry_after?: number } };
  const retryAfter = e.parameters?.retry_after;
  if (typeof retryAfter === 'number' && Number.isFinite(retryAfter)) {
    return Math.max(100, retryAfter * 1000);
  }
  if (e.error_code === 429 || /too many requests|retry after/.test(getTelegramErrorText(error))) {
    return 1000;
  }
  return undefined;
}

function isTransientTelegramError(error: unknown): boolean {
  const e = error as { error_code?: number; code?: string };
  if (typeof e.error_code === 'number' && e.error_code >= 500) return true;
  if (
    e.code &&
    ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_SOCKET'].includes(e.code)
  ) {
    return true;
  }
  return /fetch failed|network|socket hang up|terminated|timeout/.test(getTelegramErrorText(error));
}
