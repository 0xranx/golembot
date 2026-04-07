import type { ChannelAdapter, ChannelMessage, ReplyOptions } from '../channel.js';
import type { WecomChannelConfig } from '../workspace.js';
export declare class WecomAdapter implements ChannelAdapter {
    readonly name = "wecom";
    readonly maxMessageLength = 2048;
    private config;
    private wsClient;
    private seenMsgIds;
    private static readonly MAX_SEEN;
    constructor(config: WecomChannelConfig);
    start(onMessage: (msg: ChannelMessage) => void): Promise<void>;
    private handleFrame;
    reply(msg: ChannelMessage, text: string, _options?: ReplyOptions): Promise<void>;
    send(chatId: string, text: string): Promise<void>;
    stop(): Promise<void>;
}
//# sourceMappingURL=wecom.d.ts.map