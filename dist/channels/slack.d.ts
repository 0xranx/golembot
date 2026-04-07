import type { ChannelAdapter, ChannelMessage, ReplyOptions } from '../channel.js';
import type { SlackChannelConfig } from '../workspace.js';
export declare class SlackAdapter implements ChannelAdapter {
    readonly name = "slack";
    readonly maxMessageLength = 4000;
    private config;
    private app;
    private userNameCache;
    private seenMsgIds;
    private static readonly MAX_SEEN;
    constructor(config: SlackChannelConfig);
    private dedup;
    private resolveUserName;
    /**
     * Download image files attached to a Slack message.
     * Slack files require a Bearer token for download.
     */
    private downloadFiles;
    start(onMessage: (msg: ChannelMessage) => void): Promise<void>;
    getGroupMembers(chatId: string): Promise<Map<string, string>>;
    reply(msg: ChannelMessage, text: string, options?: ReplyOptions): Promise<void>;
    sendStatus(msg: ChannelMessage, text: string): Promise<string>;
    updateStatus(msg: ChannelMessage, statusId: string, text: string): Promise<void>;
    clearStatus(msg: ChannelMessage, statusId: string): Promise<void>;
    send(chatId: string, text: string): Promise<void>;
    fetchHistory(chatId: string, since: Date, limit?: number): Promise<ChannelMessage[]>;
    listChats(): Promise<Array<{
        chatId: string;
        chatType: 'dm' | 'group';
    }>>;
    stop(): Promise<void>;
}
//# sourceMappingURL=slack.d.ts.map