import type { ChannelAdapter, ChannelMessage, ReplyOptions } from '../channel.js';
import type { WeixinChannelConfig } from '../workspace.js';
/**
 * WeChat (个人微信) adapter using Tencent iLink Bot API.
 * Pure HTTP long-polling — no external SDK dependency.
 */
export declare class WeixinAdapter implements ChannelAdapter {
    readonly name = "weixin";
    readonly maxMessageLength = 2000;
    private config;
    private baseUrl;
    private seenMsgIds;
    private static readonly MAX_SEEN;
    private contextTokens;
    private syncBuffer;
    private running;
    private pollAbortController;
    constructor(config: WeixinChannelConfig);
    start(onMessage: (msg: ChannelMessage) => void): Promise<void>;
    reply(msg: ChannelMessage, text: string, _options?: ReplyOptions): Promise<void>;
    listChats(): Promise<Array<{
        chatId: string;
        chatType: 'dm' | 'group';
    }>>;
    send(chatId: string, text: string): Promise<void>;
    stop(): Promise<void>;
    private headers;
    private pollLoop;
    private parseMessage;
    /**
     * Download and decrypt an image from WeChat CDN.
     * Images are AES-128-ECB encrypted on the CDN.
     */
    private downloadImage;
}
//# sourceMappingURL=weixin.d.ts.map