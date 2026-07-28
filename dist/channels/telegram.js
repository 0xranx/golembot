import { importPeer } from '../peer-require.js';
import { markdownToHtml } from './telegram-format.js';
const TRANSIENT_RETRY_DELAYS_MS = [500, 1500];
export class TelegramAdapter {
    name = 'telegram';
    maxMessageLength = 4096;
    config;
    bot;
    botUsername;
    seenMsgIds = new Set();
    static MAX_SEEN = 500;
    allowedUserIds;
    constructor(config) {
        this.config = config;
        this.allowedUserIds = config.allowedUserIds?.length ? new Set(config.allowedUserIds.map(String)) : null;
    }
    async start(onMessage) {
        let grammyModule;
        try {
            grammyModule = await importPeer('grammy');
        }
        catch {
            throw new Error('Telegram adapter requires grammy. Install it: npm install grammy');
        }
        const { Bot } = grammyModule;
        this.bot = new Bot(this.config.botToken);
        // Fetch bot username for group mention detection
        const me = await this.bot.api.getMe();
        this.botUsername = me.username;
        this.bot.on('message', async (ctx) => {
            const message = ctx.message;
            const senderId = String(message.from?.id ?? '');
            if (this.allowedUserIds && !this.allowedUserIds.has(senderId)) {
                return;
            }
            // Handle photo messages
            const images = [];
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
                }
                catch (e) {
                    console.error('[telegram] Failed to download photo:', e.message);
                }
            }
            const hasText = !!message?.text;
            const hasCaption = !!message?.caption;
            const hasImages = images.length > 0;
            if (!hasText && !hasCaption && !hasImages)
                return;
            const rawText = message.text || message.caption || (hasImages ? '(image)' : '');
            const entities = message.entities || message.caption_entities || [];
            // Deduplicate re-delivered updates (message_id is unique per chat).
            const dedupKey = `${message.chat.id}:${message.message_id}`;
            if (this.seenMsgIds.has(dedupKey))
                return;
            this.seenMsgIds.add(dedupKey);
            if (this.seenMsgIds.size > TelegramAdapter.MAX_SEEN) {
                const entries = [...this.seenMsgIds];
                this.seenMsgIds = new Set(entries.slice(entries.length >> 1));
            }
            const chatType = message.chat.type === 'private' ? 'dm' : 'group';
            let text = rawText;
            let mentioned;
            if (chatType === 'group') {
                // Detect whether this bot is @mentioned
                const botUsername = this.botUsername;
                const isMentioned = entities.some((e) => e.type === 'mention' && text.slice(e.offset, e.offset + e.length) === `@${botUsername}`);
                mentioned = isMentioned;
                if (isMentioned) {
                    // Strip bot @mention from text
                    text = text.replace(new RegExp(`@${botUsername}`, 'g'), '').trim();
                    // Empty after stripping (bare @mention with no follow-up text)
                    if (!text && !hasImages)
                        return;
                    if (!text)
                        text = '(image)';
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
        this.bot.start().catch(() => { });
        console.log(`[telegram] Long-polling started (@${this.botUsername})`);
    }
    async reply(msg, text, _options) {
        if (!this.bot)
            return;
        await this.sendTelegramMessage({
            chatId: Number(msg.chatId),
            text,
            mode: 'html',
            replyToMessageId: parseTelegramMessageId(msg.messageId),
            purpose: 'reply',
        });
    }
    async send(chatId, text) {
        if (!this.bot)
            return;
        await this.sendTelegramMessage({
            chatId: Number(chatId),
            text,
            mode: 'html',
            purpose: 'send',
        });
    }
    async sendStatus(msg, text) {
        if (!this.bot)
            return '';
        const sent = await this.sendTelegramMessage({
            chatId: Number(msg.chatId),
            text,
            mode: 'plain',
            replyToMessageId: parseTelegramMessageId(msg.messageId),
            purpose: 'status',
        });
        return String(sent?.message_id ?? '');
    }
    async clearStatus(msg, statusId) {
        if (!this.bot || !statusId)
            return;
        const messageId = parseTelegramMessageId(statusId);
        if (messageId === undefined)
            return;
        try {
            await this.bot.api.deleteMessage(Number(msg.chatId), messageId);
        }
        catch (e) {
            console.warn(`[telegram] clearStatus failed: chat=${msg.chatId} status=${statusId} reason=${describeTelegramError(e)}`);
        }
    }
    async typing(msg) {
        if (!this.bot)
            return;
        await this.bot.api.sendChatAction(Number(msg.chatId), 'typing').catch(() => { });
    }
    async stop() {
        if (this.bot) {
            await this.bot.stop();
            this.bot = null;
        }
    }
    async sendTelegramMessage(options) {
        let mode = options.mode;
        let replyToMessageId = options.replyToMessageId;
        let transientRetries = 0;
        let rateLimitRetries = 0;
        let attempt = 0;
        while (true) {
            attempt++;
            const sendOptions = {};
            if (mode === 'html')
                sendOptions.parse_mode = 'HTML';
            if (replyToMessageId !== undefined)
                sendOptions.reply_to_message_id = replyToMessageId;
            try {
                return await this.bot.api.sendMessage(options.chatId, mode === 'html' ? markdownToHtml(options.text) : options.text, sendOptions);
            }
            catch (e) {
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
                    console.warn(this.formatSendLog(`retry=rate-limit delayMs=${retryAfterMs}`, options, attempt, e, replyToMessageId));
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
    formatSendLog(action, options, attempt, error, replyToMessageId) {
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
function parseTelegramMessageId(value) {
    if (!value)
        return undefined;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : undefined;
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function describeTelegramError(error) {
    const e = error;
    const code = e.error_code ?? e.code ?? 'unknown';
    const description = e.description ?? e.message ?? String(error);
    return `${code}:${description.replace(/\s+/g, ' ').slice(0, 180)}`;
}
function getTelegramErrorText(error) {
    const e = error;
    return `${e.error_code ?? ''} ${e.code ?? ''} ${e.description ?? ''} ${e.message ?? ''}`.toLowerCase();
}
function isTelegramParseError(error) {
    return /parse entities|can't parse|unsupported start tag|can't find end tag|entity/.test(getTelegramErrorText(error));
}
function isTelegramReplyTargetError(error) {
    return /reply message not found|message to be replied not found|replied message not found|reply_to_message_id|message thread not found/.test(getTelegramErrorText(error));
}
function getTelegramRetryAfterMs(error) {
    const e = error;
    const retryAfter = e.parameters?.retry_after;
    if (typeof retryAfter === 'number' && Number.isFinite(retryAfter)) {
        return Math.max(100, retryAfter * 1000);
    }
    if (e.error_code === 429 || /too many requests|retry after/.test(getTelegramErrorText(error))) {
        return 1000;
    }
    return undefined;
}
function isTransientTelegramError(error) {
    const e = error;
    if (typeof e.error_code === 'number' && e.error_code >= 500)
        return true;
    if (e.code &&
        ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_SOCKET'].includes(e.code)) {
        return true;
    }
    return /fetch failed|network|socket hang up|terminated|timeout/.test(getTelegramErrorText(error));
}
//# sourceMappingURL=telegram.js.map