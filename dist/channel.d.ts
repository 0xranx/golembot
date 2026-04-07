/** An image attached to an incoming IM message. */
export interface ImageAttachment {
    /** MIME type, e.g. "image/png", "image/jpeg". */
    mimeType: string;
    /** Raw image bytes. */
    data: Buffer;
    /** Optional original filename. */
    fileName?: string;
}
/** A file (non-image) attached to an incoming IM message. */
export interface FileAttachment {
    /** MIME type, e.g. "application/pdf", "audio/ogg". */
    mimeType: string;
    /** Raw file bytes. */
    data: Buffer;
    /** Original filename. */
    fileName: string;
}
export interface ChannelMessage {
    channelType: string;
    senderId: string;
    senderName?: string;
    chatId: string;
    chatType: 'dm' | 'group';
    text: string;
    /** Platform-native message ID, used for quote/reply. */
    messageId?: string;
    /** Platform-native thread or conversation root ID, used for thread-scoped routing. */
    threadId?: string;
    /** Images attached to the message (downloaded by the adapter). */
    images?: ImageAttachment[];
    /** Files (non-image) attached to the message (downloaded by the adapter). */
    files?: FileAttachment[];
    raw: unknown;
    /**
     * Indicates whether the sender is a human user or a bot/app.
     * Set by adapters that can distinguish sender types (e.g. Feishu's sender_type field).
     * Used by the gateway for multi-bot awareness (peer history visibility).
     */
    senderType?: 'user' | 'bot';
    /**
     * Set to `true` by adapters that can reliably detect a bot @mention through
     * platform-native means (e.g. Discord's `<@userId>` token). When set, the
     * gateway treats the message as an @mention regardless of text pattern matching.
     */
    mentioned?: boolean;
    /**
     * Names of OTHER users/bots that were @mentioned in this message (excluding this bot).
     * Used by the gateway to inject stronger [PASS] hints in multi-bot group chats.
     */
    mentionedOthers?: string[];
}
export interface MentionTarget {
    name: string;
    platformId: string;
}
export interface ReplyOptions {
    mentions?: MentionTarget[];
}
/**
 * Read receipt emitted when a user reads a message sent by the bot.
 * Currently only supported by Feishu (via `im.message.message_read_v1` event).
 */
export interface ReadReceipt {
    channelType: string;
    messageId: string;
    readerId: string;
    chatId: string;
    readTime: string;
}
export interface ChannelAdapter {
    readonly name: string;
    /** Optional: override the default 4000-char message split limit for this channel. */
    readonly maxMessageLength?: number;
    start(onMessage: (msg: ChannelMessage) => void | Promise<void>): Promise<void>;
    reply(msg: ChannelMessage, text: string, options?: ReplyOptions): Promise<void>;
    stop(): Promise<void>;
    /**
     * Optional: send a proactive message to a chat (no incoming message context needed).
     * Used by scheduled tasks / cron jobs to push results to IM channels.
     * Not all adapters support this — check before calling.
     */
    send?(chatId: string, text: string): Promise<void>;
    /**
     * Optional: send a "typing…" indicator to the chat.
     * Called before a long-running AI invocation so the user sees immediate feedback.
     * Implementations should be idempotent and best-effort (errors are ignored).
     */
    typing?(msg: ChannelMessage): Promise<void>;
    /**
     * Optional: create a temporary status/progress message that can be updated.
     * Returns a platform-native status identifier if supported.
     */
    sendStatus?(msg: ChannelMessage, text: string): Promise<string>;
    /** Optional: update a previously created status/progress message. */
    updateStatus?(msg: ChannelMessage, statusId: string, text: string): Promise<void>;
    /** Optional: clear a previously created status/progress message. */
    clearStatus?(msg: ChannelMessage, statusId: string): Promise<void>;
    /**
     * Optional: resolve group members for @mention support.
     * Returns a map of display name → platform-specific user ID.
     * Called by the gateway when the AI reply contains @mentions.
     */
    getGroupMembers?(chatId: string): Promise<Map<string, string>>;
    /**
     * Optional: handler for read receipt events. Set by the gateway before `start()`.
     * When a user reads a message sent by the bot, the adapter calls this handler.
     * Currently only Feishu supports this via the `im.message.message_read_v1` event.
     */
    readReceiptHandler?: (receipt: ReadReceipt) => void;
    /**
     * Optional: fetch message history for a chat since a given timestamp.
     * Used by the history fetcher to retrieve missed messages after bot restart.
     * Supported by: Feishu, Slack, Discord. Not available on Telegram, DingTalk, WeCom.
     */
    fetchHistory?(chatId: string, since: Date, limit?: number): Promise<ChannelMessage[]>;
    /**
     * Optional: list all chats (DM + group) the bot is a member of.
     * Used by the history fetcher to discover which chats to poll.
     * Supported by: Feishu, Slack, Discord. Not available on Telegram, DingTalk, WeCom.
     */
    listChats?(): Promise<Array<{
        chatId: string;
        chatType: 'dm' | 'group';
    }>>;
}
export declare function buildSessionKey(msg: ChannelMessage): string;
export declare function buildConversationKey(msg: Pick<ChannelMessage, 'channelType' | 'chatId' | 'chatType' | 'threadId'>): string;
/**
 * Strip @mention tags from the text, returning only the user's actual message.
 * Handles common IM @mention formats: `@BotName`, `<at user_id="xxx">BotName</at>` etc.
 */
export declare function stripMention(text: string): string;
/**
 * Detect whether `text` contains an @mention of `botName`.
 * Handles `@BotName` and XML-style `<at ...>BotName</at>`.
 */
export declare function detectMention(text: string, botName: string): boolean;
//# sourceMappingURL=channel.d.ts.map