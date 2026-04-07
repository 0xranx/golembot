import type { ChannelAdapter, ChannelMessage, ReplyOptions } from '../channel.js';
import type { DingtalkChannelConfig } from '../workspace.js';
export declare class DingtalkAdapter implements ChannelAdapter {
    readonly name = "dingtalk";
    readonly maxMessageLength = 4000;
    private config;
    private dwClient;
    private seenMsgIds;
    private static readonly MAX_SEEN;
    constructor(config: DingtalkChannelConfig);
    start(onMessage: (msg: ChannelMessage) => void): Promise<void>;
    reply(msg: ChannelMessage, text: string, _options?: ReplyOptions): Promise<void>;
    send(chatId: string, text: string): Promise<void>;
    stop(): Promise<void>;
}
//# sourceMappingURL=dingtalk.d.ts.map