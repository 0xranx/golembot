import { importPeer } from '../peer-require.js';
export class WecomAdapter {
    name = 'wecom';
    maxMessageLength = 2048;
    config;
    wsClient = null;
    seenMsgIds = new Set();
    static MAX_SEEN = 500;
    /** chatId → (display name → userid), accumulated from incoming group frames. */
    groupMemberCache = new Map();
    static MEMBER_CACHE_TTL = 10 * 60 * 1000;
    groupMemberCacheTime = new Map();
    activeStreamId = null;
    activeStreamFrame = null;
    activeStreamTimer = null;
    accumulatedText = '';
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
        const senderName = body.userName || body.from_name;
        if (isGroup && chatId && senderId && senderName) {
            let members = this.groupMemberCache.get(chatId);
            if (!members) {
                members = new Map();
                this.groupMemberCache.set(chatId, members);
            }
            members.set(senderName, senderId);
            this.groupMemberCacheTime.set(chatId, Date.now());
        }
        const channelMsg = {
            channelType: 'wecom',
            senderId,
            senderName,
            chatId,
            chatType: isGroup ? 'group' : 'dm',
            text,
            messageId: msgId,
            mentioned: isGroup ? true : undefined,
            raw: frame,
        };
        onMessage(channelMsg);
    }
    async getGroupMembers(chatId) {
        // WeCom Smart Bot does not expose a member list API; return the cache
        // accumulated from incoming group frames in handleFrame.
        const cached = this.groupMemberCache.get(chatId);
        if (!cached)
            return new Map();
        const ts = this.groupMemberCacheTime.get(chatId) ?? 0;
        if (Date.now() - ts >= WecomAdapter.MEMBER_CACHE_TTL) {
            this.groupMemberCache.delete(chatId);
            this.groupMemberCacheTime.delete(chatId);
            return new Map();
        }
        return cached;
    }
    finalizeStream() {
        if (!this.activeStreamId || !this.activeStreamFrame || !this.wsClient)
            return;
        if (this.activeStreamTimer) {
            clearTimeout(this.activeStreamTimer);
            this.activeStreamTimer = null;
        }
        if (this.accumulatedText) {
            this.wsClient
                .replyStream(this.activeStreamFrame, this.activeStreamId, this.accumulatedText, true)
                .catch(() => { });
        }
        this.activeStreamId = null;
        this.activeStreamFrame = null;
        this.accumulatedText = '';
    }
    async reply(msg, text, options) {
        if (!this.wsClient)
            return;
        const frame = msg.raw;
        if (this.activeStreamId && this.activeStreamFrame !== frame) {
            this.finalizeStream();
        }
        if (!this.activeStreamId) {
            this.activeStreamId = `reply-${Date.now()}`;
            this.activeStreamFrame = frame;
            this.accumulatedText = '';
        }
        if (this.activeStreamTimer) {
            clearTimeout(this.activeStreamTimer);
            this.activeStreamTimer = null;
        }
        let processedText = text;
        const mentions = options?.mentions;
        if (mentions && mentions.length > 0) {
            for (const m of mentions) {
                processedText = processedText.replace(new RegExp(`@${m.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'), `<@${m.platformId}>`);
            }
        }
        this.accumulatedText += processedText;
        this.activeStreamTimer = setTimeout(() => this.finalizeStream(), 2000);
    }
    async clearStatus(_msg, _statusId) {
        this.finalizeStream();
    }
    async typing(msg) {
        if (!this.wsClient)
            return;
        try {
            await this.wsClient.sendTyping?.(msg.chatId);
        }
        catch { }
        if (!this.activeStreamId) {
            this.activeStreamId = `reply-${Date.now()}`;
            this.activeStreamFrame = msg.raw;
            this.accumulatedText = '';
            this.wsClient.replyStream(msg.raw, this.activeStreamId, '', false).catch(() => { });
        }
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