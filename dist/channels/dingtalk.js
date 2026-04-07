import { importPeer } from '../peer-require.js';
export class DingtalkAdapter {
    name = 'dingtalk';
    maxMessageLength = 4000;
    config;
    dwClient;
    seenMsgIds = new Set();
    static MAX_SEEN = 500;
    constructor(config) {
        this.config = config;
    }
    async start(onMessage) {
        let sdk;
        try {
            sdk = await importPeer('dingtalk-stream');
        }
        catch {
            throw new Error('DingTalk adapter requires dingtalk-stream. Install it: npm install dingtalk-stream');
        }
        const { DWClient, TOPIC_ROBOT } = sdk;
        this.dwClient = new DWClient({
            clientId: this.config.clientId,
            clientSecret: this.config.clientSecret,
        });
        this.dwClient.registerCallbackListener(TOPIC_ROBOT, async (res) => {
            // Deduplicate re-delivered events.
            const msgId = res.headers?.messageId || JSON.parse(res.data).msgId;
            if (msgId) {
                if (this.seenMsgIds.has(msgId)) {
                    this.dwClient.socketCallBackResponse(res.headers.messageId, { status: 'SUCCESS' });
                    return;
                }
                this.seenMsgIds.add(msgId);
                if (this.seenMsgIds.size > DingtalkAdapter.MAX_SEEN) {
                    const entries = [...this.seenMsgIds];
                    this.seenMsgIds = new Set(entries.slice(entries.length >> 1));
                }
            }
            const data = JSON.parse(res.data);
            const msgtype = data.msgtype;
            let text = '';
            const images = [];
            if (msgtype === 'text' || !msgtype) {
                text = data.text?.content?.trim() || '';
            }
            else if (msgtype === 'picture') {
                // DingTalk picture messages include a download URL
                const picURL = data.content?.downloadCode || data.content?.picURL;
                if (picURL) {
                    try {
                        const accessToken = await this.dwClient?.getAccessToken?.();
                        const headers = {};
                        if (accessToken)
                            headers['x-acs-dingtalk-access-token'] = accessToken;
                        const resp = await fetch(picURL, { headers });
                        if (resp.ok) {
                            const buf = Buffer.from(await resp.arrayBuffer());
                            const ct = resp.headers.get('content-type') || 'image/jpeg';
                            images.push({ mimeType: ct.split(';')[0], data: buf });
                        }
                    }
                    catch (e) {
                        console.error('[dingtalk] Failed to download image:', e.message);
                    }
                }
                text = '(image)';
            }
            else if (msgtype === 'richText') {
                // Rich text may contain text + images
                const richText = data.content?.richText;
                if (Array.isArray(richText)) {
                    for (const section of richText) {
                        if (section.text)
                            text += section.text;
                        if (section.downloadCode || section.picURL) {
                            const picURL = section.downloadCode || section.picURL;
                            try {
                                const accessToken = await this.dwClient?.getAccessToken?.();
                                const headers = {};
                                if (accessToken)
                                    headers['x-acs-dingtalk-access-token'] = accessToken;
                                const resp = await fetch(picURL, { headers });
                                if (resp.ok) {
                                    const buf = Buffer.from(await resp.arrayBuffer());
                                    const ct = resp.headers.get('content-type') || 'image/jpeg';
                                    images.push({ mimeType: ct.split(';')[0], data: buf });
                                }
                            }
                            catch (e) {
                                console.error('[dingtalk] Failed to download rich text image:', e.message);
                            }
                        }
                    }
                    text = text.trim();
                    if (!text && images.length > 0)
                        text = '(image)';
                }
            }
            else {
                // Unsupported message type — skip
                this.dwClient.socketCallBackResponse(res.headers.messageId, { status: 'SUCCESS' });
                return;
            }
            if (!text && images.length === 0)
                return;
            const isGroup = data.conversationType === '2';
            const channelMsg = {
                channelType: 'dingtalk',
                senderId: data.senderStaffId || data.senderId || '',
                senderName: data.senderNick,
                chatId: data.conversationId || '',
                chatType: isGroup ? 'group' : 'dm',
                text,
                messageId: msgId,
                images: images.length > 0 ? images : undefined,
                mentioned: isGroup ? true : undefined,
                raw: { ...data, _sessionWebhook: data.sessionWebhook },
            };
            onMessage(channelMsg);
            this.dwClient.socketCallBackResponse(res.headers.messageId, { status: 'SUCCESS' });
        });
        await this.dwClient.connect();
        console.log(`[dingtalk] Stream connection established`);
    }
    async reply(msg, text, _options) {
        const raw = msg.raw;
        const webhook = raw?._sessionWebhook;
        if (!webhook)
            return;
        const body = {
            msgtype: 'text',
            text: { content: text },
        };
        const accessToken = await this.dwClient?.getAccessToken?.();
        const headers = { 'Content-Type': 'application/json' };
        if (accessToken) {
            headers['x-acs-dingtalk-access-token'] = accessToken;
        }
        await fetch(webhook, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        });
    }
    async send(chatId, text) {
        const accessToken = await this.dwClient?.getAccessToken?.();
        if (!accessToken)
            return;
        await fetch('https://api.dingtalk.com/v1.0/robot/groupMessages/send', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-acs-dingtalk-access-token': accessToken,
            },
            body: JSON.stringify({
                msgParam: JSON.stringify({ content: text }),
                msgKey: 'sampleText',
                openConversationId: chatId,
            }),
        });
    }
    async stop() {
        this.dwClient = null;
    }
}
//# sourceMappingURL=dingtalk.js.map