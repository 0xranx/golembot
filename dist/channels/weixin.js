import { createDecipheriv, randomUUID } from 'node:crypto';
const CDN_BASE = 'https://novac2c.cdn.weixin.qq.com/c2c';
/**
 * WeChat (个人微信) adapter using Tencent iLink Bot API.
 * Pure HTTP long-polling — no external SDK dependency.
 */
export class WeixinAdapter {
    name = 'weixin';
    maxMessageLength = 2000;
    config;
    baseUrl;
    seenMsgIds = new Set();
    static MAX_SEEN = 500;
    contextTokens = new Map();
    syncBuffer = '';
    running = false;
    pollAbortController = null;
    constructor(config) {
        this.config = config;
        this.baseUrl = (config.baseUrl || 'https://ilinkai.weixin.qq.com').replace(/\/$/, '');
    }
    async start(onMessage) {
        if (!this.config.token) {
            throw new Error('WeChat adapter requires a token. Obtain one via iLink Bot QR login and add it to golem.yaml.');
        }
        this.running = true;
        this.pollLoop(onMessage).catch((e) => {
            console.error('[weixin] Poll loop crashed:', e.message);
        });
        console.log('[weixin] adapter started, polling...');
    }
    async reply(msg, text, _options) {
        const raw = msg.raw;
        const contextToken = raw?.context_token || this.contextTokens.get(msg.senderId);
        if (!contextToken) {
            console.error(`[weixin] Cannot reply to ${msg.senderId}: no context_token available`);
            return;
        }
        const body = {
            msg: {
                from_user_id: '',
                to_user_id: msg.senderId,
                client_id: randomUUID(),
                message_type: 2,
                message_state: 2,
                context_token: contextToken,
                item_list: [{ type: 1, text_item: { text } }],
            },
            base_info: { channel_version: '0.1.0' },
        };
        const resp = await fetch(`${this.baseUrl}/ilink/bot/sendmessage`, {
            method: 'POST',
            headers: this.headers(),
            body: JSON.stringify(body),
        });
        if (!resp.ok) {
            console.error(`[weixin] sendmessage failed: HTTP ${resp.status}`);
        }
    }
    async listChats() {
        return [...this.contextTokens.keys()].map((id) => ({ chatId: id, chatType: 'dm' }));
    }
    async send(chatId, text) {
        const contextToken = this.contextTokens.get(chatId);
        if (!contextToken) {
            console.error(`[weixin] Cannot send to ${chatId}: no context_token cached (user must message the bot first)`);
            return;
        }
        const body = {
            msg: {
                from_user_id: '',
                to_user_id: chatId,
                client_id: randomUUID(),
                message_type: 2,
                message_state: 2,
                context_token: contextToken,
                item_list: [{ type: 1, text_item: { text } }],
            },
            base_info: { channel_version: '0.1.0' },
        };
        const resp = await fetch(`${this.baseUrl}/ilink/bot/sendmessage`, {
            method: 'POST',
            headers: this.headers(),
            body: JSON.stringify(body),
        });
        if (!resp.ok) {
            console.error(`[weixin] proactive send failed: HTTP ${resp.status} (context_token may have expired)`);
        }
    }
    async stop() {
        this.running = false;
        this.pollAbortController?.abort();
        this.pollAbortController = null;
    }
    // ── Private ────────────────────────────────────────────────────────────────
    headers() {
        return {
            'Content-Type': 'application/json',
            AuthorizationType: 'ilink_bot_token',
            Authorization: `Bearer ${this.config.token}`,
            'X-WECHAT-UIN': String(Math.floor(Math.random() * 1_000_000_000)),
        };
    }
    async pollLoop(onMessage) {
        const BASE_DELAY = 1000;
        const MAX_DELAY = 30_000;
        let consecutiveErrors = 0;
        while (this.running) {
            try {
                this.pollAbortController = new AbortController();
                const resp = await fetch(`${this.baseUrl}/ilink/bot/getupdates`, {
                    method: 'POST',
                    headers: this.headers(),
                    body: JSON.stringify({
                        get_updates_buf: this.syncBuffer,
                        base_info: { channel_version: '0.1.0' },
                    }),
                    signal: this.pollAbortController.signal,
                });
                if (!resp.ok) {
                    if (resp.status === 401) {
                        console.error('[weixin] Token expired or invalid. Re-authenticate with iLink Bot QR login.');
                        this.running = false;
                        return;
                    }
                    throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
                }
                const data = (await resp.json());
                if (data.get_updates_buf) {
                    this.syncBuffer = data.get_updates_buf;
                }
                consecutiveErrors = 0;
                const msgs = data.msgs || [];
                for (const update of msgs) {
                    const parsed = await this.parseMessage(update);
                    if (!parsed)
                        continue;
                    // Dedup
                    const dedupKey = parsed.messageId || `${parsed.senderId}:${Date.now()}`;
                    if (this.seenMsgIds.has(dedupKey))
                        continue;
                    this.seenMsgIds.add(dedupKey);
                    if (this.seenMsgIds.size > WeixinAdapter.MAX_SEEN) {
                        const entries = [...this.seenMsgIds];
                        this.seenMsgIds = new Set(entries.slice(entries.length >> 1));
                    }
                    // Store context_token for this sender
                    const raw = update;
                    if (raw.context_token) {
                        this.contextTokens.set(parsed.senderId, raw.context_token);
                    }
                    try {
                        await onMessage(parsed);
                    }
                    catch (e) {
                        console.error('[weixin] onMessage error:', e.message);
                    }
                }
            }
            catch (e) {
                if (e.name === 'AbortError')
                    break;
                consecutiveErrors++;
                const delay = Math.min(BASE_DELAY * 2 ** (consecutiveErrors - 1), MAX_DELAY);
                console.error(`[weixin] Poll error (attempt ${consecutiveErrors}): ${e.message}. Retrying in ${delay}ms`);
                await new Promise((r) => setTimeout(r, delay));
            }
        }
    }
    async parseMessage(update) {
        const raw = update;
        // Only process user messages (message_type 1); skip bot messages (2+)
        if (raw.message_type !== undefined && raw.message_type !== 1)
            return null;
        const senderId = raw.from_user_id || '';
        if (!senderId)
            return null;
        const messageId = raw.client_id || '';
        const itemList = raw.item_list || [];
        // Extract text and images from item_list
        let text = '';
        const images = [];
        for (const item of itemList) {
            switch (item.type) {
                case 1: {
                    const textItem = item.text_item;
                    text += textItem?.text || '';
                    break;
                }
                case 2: {
                    const imageItem = item.image_item;
                    if (imageItem) {
                        try {
                            const img = await this.downloadImage(imageItem);
                            if (img)
                                images.push(img);
                        }
                        catch (e) {
                            console.error('[weixin] Failed to download image:', e.message);
                        }
                    }
                    if (images.length === 0)
                        text += '(image)';
                    break;
                }
                case 3: {
                    const voiceItem = item.voice_item;
                    text += voiceItem?.text || '(voice)';
                    break;
                }
                case 4: {
                    const fileItem = item.file_item;
                    const fileName = fileItem?.file_url || '';
                    text += fileName ? `(file: ${fileName})` : '(file)';
                    break;
                }
                case 5:
                    text += '(video)';
                    break;
                default:
                    break;
            }
        }
        if (!text && images.length === 0)
            return null;
        if (!text && images.length > 0)
            text = '(image)';
        return {
            channelType: 'weixin',
            senderId,
            chatId: senderId,
            chatType: 'dm',
            text,
            messageId,
            images: images.length > 0 ? images : undefined,
            raw: update,
        };
    }
    /**
     * Download and decrypt an image from WeChat CDN.
     * Images are AES-128-ECB encrypted on the CDN.
     */
    async downloadImage(imageItem) {
        const media = imageItem.media;
        const encryptQueryParam = media?.encrypt_query_param;
        if (!encryptQueryParam)
            return null;
        // 1. Download encrypted bytes from CDN (no auth needed)
        const cdnUrl = `${CDN_BASE}/download?encrypted_query_param=${encodeURIComponent(encryptQueryParam)}`;
        const resp = await fetch(cdnUrl);
        if (!resp.ok)
            throw new Error(`CDN download failed: HTTP ${resp.status}`);
        const encrypted = Buffer.from(await resp.arrayBuffer());
        if (encrypted.length === 0)
            return null;
        // 2. Parse AES key
        const aesKeyHex = imageItem.aeskey;
        let key;
        if (aesKeyHex && aesKeyHex.length === 32) {
            key = Buffer.from(aesKeyHex, 'hex');
        }
        else {
            const aesKeyB64 = media?.aes_key;
            if (!aesKeyB64)
                return null;
            const decoded = Buffer.from(aesKeyB64, 'base64');
            if (decoded.length === 16) {
                key = decoded;
            }
            else if (decoded.length === 32 && /^[0-9a-fA-F]{32}$/.test(decoded.toString('ascii'))) {
                key = Buffer.from(decoded.toString('ascii'), 'hex');
            }
            else {
                return null;
            }
        }
        // 3. Decrypt AES-128-ECB
        const decipher = createDecipheriv('aes-128-ecb', key, null);
        const data = Buffer.concat([decipher.update(encrypted), decipher.final()]);
        // 4. Detect format from magic bytes
        const isPng = data[0] === 0x89 && data[1] === 0x50;
        const mimeType = isPng ? 'image/png' : 'image/jpeg';
        const ext = isPng ? 'png' : 'jpg';
        return { mimeType, data, fileName: `weixin-image.${ext}` };
    }
}
//# sourceMappingURL=weixin.js.map