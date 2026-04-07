import { importPeer } from '../peer-require.js';
export class WecomAdapter {
    name = 'wecom';
    maxMessageLength = 2048;
    config;
    wsClient = null;
    seenMsgIds = new Set();
    static MAX_SEEN = 500;
    constructor(config) {
        this.config = config;
    }
    async start(onMessage) {
        let AiBot;
        try {
            AiBot = await importPeer('@wecom/aibot-node-sdk');
        }
        catch {
            throw new Error('WeCom adapter requires @wecom/aibot-node-sdk. Install it: npm install @wecom/aibot-node-sdk');
        }
        // Support both default and named exports
        const WSClient = AiBot.WSClient || AiBot.default?.WSClient || AiBot.default;
        if (!WSClient) {
            throw new Error('Invalid @wecom/aibot-node-sdk: WSClient not found');
        }
        const wsOpts = {
            botId: this.config.botId,
            secret: this.config.secret,
        };
        if (this.config.websocketUrl)
            wsOpts.url = this.config.websocketUrl;
        this.wsClient = new WSClient(wsOpts);
        this.wsClient.on('message.text', (frame) => {
            this.handleFrame(frame, onMessage);
        });
        this.wsClient.on('message.image', (frame) => {
            this.handleFrame(frame, onMessage, '(image)');
        });
        await this.wsClient.connect();
        console.log('[wecom] WebSocket connection established');
    }
    handleFrame(frame, onMessage, fallbackText) {
        const body = frame?.body ?? frame;
        const msgId = body.msgid || body.msgId || body.message_id;
        if (msgId) {
            if (this.seenMsgIds.has(msgId))
                return;
            this.seenMsgIds.add(msgId);
            if (this.seenMsgIds.size > WecomAdapter.MAX_SEEN) {
                const entries = [...this.seenMsgIds];
                this.seenMsgIds = new Set(entries.slice(entries.length >> 1));
            }
        }
        const text = body.text?.content ||
            body.content?.text ||
            (typeof body.text === 'string' ? body.text : undefined) ||
            fallbackText ||
            '';
        if (!text)
            return;
        const senderId = body.from?.userid || body.userId || (typeof body.from === 'string' ? body.from : '') || '';
        const chatType = body.chattype || body.chatType || body.chat_type;
        const isGroup = chatType === 'group';
        const chatId = body.chatid || body.chatId || body.conversation_id || (!isGroup ? senderId : '');
        const channelMsg = {
            channelType: 'wecom',
            senderId,
            senderName: body.userName || body.from_name,
            chatId,
            chatType: isGroup ? 'group' : 'dm',
            text,
            messageId: msgId,
            mentioned: body.mentioned,
            raw: frame,
        };
        onMessage(channelMsg);
    }
    async reply(msg, text, _options) {
        if (!this.wsClient)
            return;
        const frame = msg.raw;
        const streamId = `reply-${Date.now()}`;
        await this.wsClient.replyStream(frame, streamId, text, true);
    }
    async send(chatId, text) {
        if (!this.wsClient)
            return;
        await this.wsClient.sendMessage(chatId, { msgtype: 'text', text: { content: text } });
    }
    async stop() {
        if (this.wsClient) {
            await this.wsClient.disconnect?.();
            this.wsClient = null;
        }
    }
}
//# sourceMappingURL=wecom.js.map