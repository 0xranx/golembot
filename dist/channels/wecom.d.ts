import type { ChannelAdapter, ChannelMessage, ReplyOptions } from '../channel.js';
import type { WecomChannelConfig } from '../workspace.js';
export declare class WecomAdapter implements ChannelAdapter {
    readonly name = "wecom";
    readonly maxMessageLength = 2048;
    private config;
    private wsClient;
    private seenMsgIds;
    private static readonly MAX_SEEN;
    /** chatId → (display name → userid), accumulated from incoming group frames. */
    private groupMemberCache;
    private static readonly MEMBER_CACHE_TTL;
    private groupMemberCacheTime;
    private activeStreamId;
    private activeStreamFrame;
    private activeStreamTimer;
    private accumulatedText;
    constructor(config: WecomChannelConfig);
    start(onMessage: (msg: ChannelMessage) => void): Promise<void>;
    private handleFrame;
    getGroupMembers(chatId: string): Promise<Map<string, string>>;
    private finalizeStream;
    reply(msg: ChannelMessage, text: string, options?: ReplyOptions): Promise<void>;
    clearStatus(_msg: ChannelMessage, _statusId: string): Promise<void>;
    typing(msg: ChannelMessage): Promise<void>;
    send(chatId: string, text: string): Promise<void>;
    stop(): Promise<void>;
}
//# sourceMappingURL=wecom.d.ts.map