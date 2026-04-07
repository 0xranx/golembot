import type { ChannelAdapter, ChannelMessage, ReplyOptions } from '../channel.js';
import type { DiscordChannelConfig } from '../workspace.js';
export declare class DiscordAdapter implements ChannelAdapter {
    readonly name = "discord";
    /** Discord's per-message character limit for regular messages. */
    readonly maxMessageLength = 2000;
    private config;
    private client;
    private seenMsgIds;
    private static readonly MAX_SEEN;
    constructor(config: DiscordChannelConfig);
    start(onMessage: (msg: ChannelMessage) => void | Promise<void>): Promise<void>;
    getGroupMembers(chatId: string): Promise<Map<string, string>>;
    reply(msg: ChannelMessage, text: string, options?: ReplyOptions): Promise<void>;
    send(chatId: string, text: string): Promise<void>;
    typing(msg: ChannelMessage): Promise<void>;
    fetchHistory(chatId: string, since: Date, limit?: number): Promise<ChannelMessage[]>;
    listChats(): Promise<Array<{
        chatId: string;
        chatType: 'dm' | 'group';
    }>>;
    stop(): Promise<void>;
}
//# sourceMappingURL=discord.d.ts.map