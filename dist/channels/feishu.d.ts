import type { ChannelAdapter, ChannelMessage, ReadReceipt, ReplyOptions } from '../channel.js';
import type { FeishuChannelConfig } from '../workspace.js';
export declare class FeishuAdapter implements ChannelAdapter {
    readonly name = "feishu";
    readonly maxMessageLength = 4000;
    readReceiptHandler?: (receipt: ReadReceipt) => void;
    private config;
    private client;
    private wsClient;
    /** Bot's own open_id — resolved lazily on first group message, used for self-filtering. */
    private botOpenId;
    private userNameCache;
    /** Recent message IDs used to deduplicate re-delivered events. */
    private seenMsgIds;
    private static readonly MAX_SEEN;
    /** Cached group members: chatId → (displayName → open_id). */
    private groupMemberCache;
    private groupMemberCacheTime;
    private static readonly MEMBER_CACHE_TTL;
    constructor(config: FeishuChannelConfig);
    private resolveUserName;
    /**
     * Download an image resource from a Feishu message.
     * Uses the IM v1 message resource API.
     */
    private downloadImage;
    /**
     * Download a file resource (document, audio, etc.) from a Feishu message.
     * Uses the same IM v1 message resource API with type=file.
     */
    private downloadFile;
    start(onMessage: (msg: ChannelMessage) => void): Promise<void>;
    getGroupMembers(chatId: string): Promise<Map<string, string>>;
    reply(msg: ChannelMessage, text: string, options?: ReplyOptions): Promise<void>;
    send(chatId: string, text: string): Promise<void>;
    /**
     * Fetch single-message detail to resolve @mentions.
     * Returns true if this bot is @mentioned, false if not, undefined on error.
     */
    private resolveMentioned;
    fetchHistory(chatId: string, since: Date, limit?: number): Promise<ChannelMessage[]>;
    listChats(): Promise<Array<{
        chatId: string;
        chatType: 'dm' | 'group';
    }>>;
    stop(): Promise<void>;
}
//# sourceMappingURL=feishu.d.ts.map