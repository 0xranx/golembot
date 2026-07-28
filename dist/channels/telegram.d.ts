import type { ChannelAdapter, ChannelMessage, ReplyOptions } from '../channel.js';
import type { TelegramChannelConfig } from '../workspace.js';
export declare class TelegramAdapter implements ChannelAdapter {
    readonly name = "telegram";
    readonly maxMessageLength = 4096;
    private config;
    private bot;
    private botUsername;
    private seenMsgIds;
    private static readonly MAX_SEEN;
    private allowedUserIds;
    constructor(config: TelegramChannelConfig);
    start(onMessage: (msg: ChannelMessage) => void): Promise<void>;
    reply(msg: ChannelMessage, text: string, _options?: ReplyOptions): Promise<void>;
    send(chatId: string, text: string): Promise<void>;
    sendStatus(msg: ChannelMessage, text: string): Promise<string>;
    clearStatus(msg: ChannelMessage, statusId: string): Promise<void>;
    typing(msg: ChannelMessage): Promise<void>;
    stop(): Promise<void>;
    private sendTelegramMessage;
    private formatSendLog;
}
//# sourceMappingURL=telegram.d.ts.map