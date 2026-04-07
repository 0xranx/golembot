import { importPeer } from '../peer-require.js';
import { hasMarkdown, markdownToCard } from './feishu-format.js';
/** Detect image MIME type from magic bytes. */
function detectImageMime(data) {
    if (data[0] === 0x89 && data[1] === 0x50)
        return 'image/png';
    if (data[0] === 0xff && data[1] === 0xd8)
        return 'image/jpeg';
    if (data[0] === 0x47 && data[1] === 0x49)
        return 'image/gif';
    if (data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46)
        return 'image/webp';
    return 'image/png'; // fallback
}
export class FeishuAdapter {
    name = 'feishu';
    maxMessageLength = 4000;
    readReceiptHandler;
    config;
    client;
    wsClient;
    /** Bot's own open_id — resolved lazily on first group message, used for self-filtering. */
    botOpenId;
    userNameCache = new Map();
    /** Recent message IDs used to deduplicate re-delivered events. */
    seenMsgIds = new Set();
    static MAX_SEEN = 500;
    /** Cached group members: chatId → (displayName → open_id). */
    groupMemberCache = new Map();
    groupMemberCacheTime = new Map();
    static MEMBER_CACHE_TTL = 10 * 60 * 1000; // 10 minutes
    constructor(config) {
        this.config = config;
    }
    async resolveUserName(openId) {
        const cached = this.userNameCache.get(openId);
        if (cached)
            return cached;
        try {
            const token = await this.client.tokenManager.getTenantAccessToken();
            const resp = await fetch(`https://open.feishu.cn/open-apis/contact/v3/users/${openId}?user_id_type=open_id`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const json = (await resp.json());
            const name = json?.data?.user?.name;
            if (name)
                this.userNameCache.set(openId, name);
            return name;
        }
        catch {
            return undefined;
        }
    }
    /**
     * Download an image resource from a Feishu message.
     * Uses the IM v1 message resource API.
     */
    async downloadImage(messageId, imageKey) {
        const token = await this.client.tokenManager.getTenantAccessToken();
        const resp = await fetch(`https://open.feishu.cn/open-apis/im/v1/messages/${messageId}/resources/${imageKey}?type=image`, { headers: { Authorization: `Bearer ${token}` } });
        if (!resp.ok) {
            throw new Error(`Feishu image download failed: ${resp.status} ${resp.statusText}`);
        }
        const data = Buffer.from(await resp.arrayBuffer());
        const contentType = resp.headers.get('content-type') || '';
        const mimeType = contentType.startsWith('image/') ? contentType.split(';')[0] : detectImageMime(data);
        return { mimeType, data, fileName: `${imageKey}.${mimeType === 'image/png' ? 'png' : 'jpg'}` };
    }
    /**
     * Download a file resource (document, audio, etc.) from a Feishu message.
     * Uses the same IM v1 message resource API with type=file.
     */
    async downloadFile(messageId, fileKey, fileName) {
        const token = await this.client.tokenManager.getTenantAccessToken();
        const resp = await fetch(`https://open.feishu.cn/open-apis/im/v1/messages/${messageId}/resources/${fileKey}?type=file`, { headers: { Authorization: `Bearer ${token}` } });
        if (!resp.ok) {
            throw new Error(`Feishu file download failed: ${resp.status} ${resp.statusText}`);
        }
        const data = Buffer.from(await resp.arrayBuffer());
        const contentType = resp.headers.get('content-type') || 'application/octet-stream';
        const mimeType = contentType.split(';')[0];
        return { mimeType, data, fileName };
    }
    async start(onMessage) {
        let lark;
        try {
            lark = await importPeer('@larksuiteoapi/node-sdk');
        }
        catch {
            throw new Error('Feishu adapter requires @larksuiteoapi/node-sdk. Install it: npm install @larksuiteoapi/node-sdk');
        }
        const baseConfig = {
            appId: this.config.appId,
            appSecret: this.config.appSecret,
        };
        this.client = new lark.Client(baseConfig);
        // Bot's own open_id — fetched lazily via raw HTTP (client.bot namespace doesn't exist in SDK).
        // Stored as class property so fetchHistory() can also use it for self-filtering.
        const fetchBotOpenId = async () => {
            if (this.botOpenId)
                return this.botOpenId;
            try {
                const token = await this.client.tokenManager.getTenantAccessToken();
                const resp = await fetch('https://open.feishu.cn/open-apis/bot/v3/info', {
                    headers: { Authorization: `Bearer ${token}` },
                });
                const json = (await resp.json());
                this.botOpenId = json?.bot?.open_id;
                if (this.botOpenId)
                    console.log(`[feishu] Bot open_id resolved: ${this.botOpenId}`);
            }
            catch {
                // Will retry on the next group message.
            }
            return this.botOpenId;
        };
        // Best-effort initial fetch (non-blocking).
        fetchBotOpenId().catch(() => { });
        const events = {};
        // Read receipt event — fired when a user reads a message sent by the bot.
        // Requires the `im:message.message_read_v1` event subscription in Feishu console.
        if (this.readReceiptHandler) {
            const handler = this.readReceiptHandler;
            events['im.message.message_read_v1'] = (data) => {
                try {
                    const reader = data?.reader;
                    const readerId = reader?.reader_id?.open_id;
                    const messageIdList = data?.message_id_list ?? [];
                    const readTime = reader?.read_time
                        ? new Date(Number(reader.read_time)).toISOString()
                        : new Date().toISOString();
                    for (const mid of messageIdList) {
                        handler({
                            channelType: 'feishu',
                            messageId: mid,
                            readerId: readerId ?? 'unknown',
                            chatId: '', // not provided in the event payload
                            readTime,
                        });
                    }
                }
                catch {
                    // best-effort — never crash on read receipt processing
                }
            };
        }
        events['im.message.receive_v1'] = async (data) => {
            const { message, sender } = data;
            // Deduplicate re-delivered events.
            // Primary: message_id (always present in im.message.receive_v1 events).
            // Fallback: content-based dedup (chat_id + sender + text hash + 10s window)
            // to guard against SDK re-dispatches with different envelope IDs.
            const msgId = message.message_id;
            if (msgId) {
                if (this.seenMsgIds.has(msgId))
                    return;
                this.seenMsgIds.add(msgId);
                if (this.seenMsgIds.size > FeishuAdapter.MAX_SEEN) {
                    const entries = [...this.seenMsgIds];
                    this.seenMsgIds = new Set(entries.slice(entries.length >> 1));
                }
            }
            // Secondary dedup: same chat + sender + content within 10s window.
            // Lark WSClient may fire the handler twice for the same event.
            const contentKey = `${message.chat_id}:${sender?.sender_id?.open_id}:${message.content}`;
            if (this.seenMsgIds.has(contentKey))
                return;
            this.seenMsgIds.add(contentKey);
            // Auto-expire content keys after 10s.
            setTimeout(() => this.seenMsgIds.delete(contentKey), 10_000);
            // Parse message content based on type
            const msgType = message.message_type;
            if (msgType !== 'text' && msgType !== 'image' && msgType !== 'post' && msgType !== 'file' && msgType !== 'audio')
                return;
            let parsedContent;
            try {
                parsedContent = JSON.parse(message.content);
            }
            catch {
                return;
            }
            const mentions = message.mentions ?? [];
            const chatType = message.chat_type === 'p2p' ? 'dm' : 'group';
            // Detect if the bot is @mentioned in group chats.
            let isMentioned = false;
            if (chatType === 'group') {
                const resolvedId = await fetchBotOpenId();
                isMentioned = resolvedId ? mentions.some((m) => m.id?.open_id === resolvedId) : mentions.length > 0;
            }
            // Detect sender type for multi-bot awareness
            const senderType = sender?.sender_type === 'app' ? 'bot' : 'user';
            let text = '';
            const images = [];
            if (msgType === 'text') {
                text = parsedContent.text || '';
            }
            else if (msgType === 'image') {
                // Image-only message: download the image
                const imageKey = parsedContent.image_key;
                if (imageKey) {
                    try {
                        const img = await this.downloadImage(message.message_id, imageKey);
                        images.push(img);
                    }
                    catch (e) {
                        console.error('[feishu] Failed to download image:', e.message);
                        return;
                    }
                }
                text = '(image)';
            }
            else if (msgType === 'post') {
                // Rich text (post) message: extract text + inline images
                const content = parsedContent.content;
                // post content is structured as: { title, content: [[{tag, ...}, ...], ...] }
                // content is an array of lines, each line is an array of inline elements
                const lines = Array.isArray(content) ? content : [];
                const textParts = [];
                if (parsedContent.title)
                    textParts.push(parsedContent.title);
                for (const line of lines) {
                    if (!Array.isArray(line))
                        continue;
                    for (const el of line) {
                        if (el.tag === 'text')
                            textParts.push(el.text || '');
                        else if (el.tag === 'a')
                            textParts.push(el.text || el.href || '');
                        else if (el.tag === 'at')
                            textParts.push(el.user_name ? `@${el.user_name}` : '');
                        else if (el.tag === 'img' && el.image_key) {
                            try {
                                const img = await this.downloadImage(message.message_id, el.image_key);
                                images.push(img);
                            }
                            catch (e) {
                                console.error('[feishu] Failed to download inline image:', e.message);
                            }
                        }
                    }
                }
                text = textParts.join(' ').trim();
                if (!text && images.length > 0)
                    text = '(image)';
            }
            // File attachment handling
            const files = [];
            if (msgType === 'file') {
                const fileKey = parsedContent.file_key;
                const fileName = parsedContent.file_name || 'attachment';
                if (fileKey) {
                    try {
                        const file = await this.downloadFile(message.message_id, fileKey, fileName);
                        files.push(file);
                        text = `(file: ${fileName})`;
                    }
                    catch (e) {
                        console.error('[feishu] Failed to download file:', e.message);
                        return;
                    }
                }
            }
            else if (msgType === 'audio') {
                const fileKey = parsedContent.file_key;
                if (fileKey) {
                    try {
                        const file = await this.downloadFile(message.message_id, fileKey, 'voice.opus');
                        files.push(file);
                        text = '(audio)';
                    }
                    catch (e) {
                        console.error('[feishu] Failed to download audio:', e.message);
                        return;
                    }
                }
            }
            // Process @mentions in text:
            // - Strip the bot's own @mention key entirely
            // - Replace other users' @mention keys with readable @Name format
            if (chatType === 'group' && mentions.length) {
                for (const m of mentions) {
                    const isBot = this.botOpenId ? m.id?.open_id === this.botOpenId : true;
                    if (isBot) {
                        text = text.replace(m.key, '').trim();
                    }
                    else if (m.name) {
                        text = text.replace(m.key, `@${m.name}`);
                    }
                }
            }
            if (!text && images.length === 0 && files.length === 0)
                return;
            const senderId = sender.sender_id?.open_id || sender.sender_id?.user_id || '';
            const senderName = await this.resolveUserName(senderId);
            // Collect names of other @mentioned users/bots (not this bot).
            const otherMentionNames = [];
            if (chatType === 'group') {
                for (const m of mentions) {
                    const isBot = this.botOpenId ? m.id?.open_id === this.botOpenId : false;
                    if (!isBot && m.name)
                        otherMentionNames.push(m.name);
                }
            }
            const channelMsg = {
                channelType: 'feishu',
                senderId,
                senderName: senderName || senderId,
                chatId: message.chat_id,
                chatType,
                text,
                messageId: msgId,
                images: images.length > 0 ? images : undefined,
                files: files.length > 0 ? files : undefined,
                senderType,
                mentioned: chatType === 'group' ? isMentioned : undefined,
                mentionedOthers: otherMentionNames.length > 0 ? otherMentionNames : undefined,
                raw: data,
            };
            onMessage(channelMsg);
        };
        const eventDispatcher = new lark.EventDispatcher({}).register(events);
        this.wsClient = new lark.WSClient({
            ...baseConfig,
            loggerLevel: lark.LoggerLevel.info,
        });
        await this.wsClient.start({ eventDispatcher });
        console.log(`[feishu] WebSocket connection established`);
    }
    async getGroupMembers(chatId) {
        const cached = this.groupMemberCache.get(chatId);
        const ts = this.groupMemberCacheTime.get(chatId) ?? 0;
        if (cached && Date.now() - ts < FeishuAdapter.MEMBER_CACHE_TTL)
            return cached;
        if (!this.client)
            return new Map();
        try {
            const token = await this.client.tokenManager.getTenantAccessToken();
            const members = new Map();
            let pageToken;
            do {
                const url = new URL(`https://open.feishu.cn/open-apis/im/v1/chats/${chatId}/members`);
                url.searchParams.set('member_id_type', 'open_id');
                if (pageToken)
                    url.searchParams.set('page_token', pageToken);
                const resp = await fetch(url.toString(), {
                    headers: { Authorization: `Bearer ${token}` },
                });
                const json = (await resp.json());
                for (const item of json?.data?.items ?? []) {
                    if (item.name && item.member_id) {
                        members.set(item.name, item.member_id);
                    }
                }
                pageToken = json?.data?.has_more ? json?.data?.page_token : undefined;
            } while (pageToken);
            this.groupMemberCache.set(chatId, members);
            this.groupMemberCacheTime.set(chatId, Date.now());
            return members;
        }
        catch {
            return cached ?? new Map();
        }
    }
    async reply(msg, text, options) {
        if (!this.client)
            return;
        const mentions = options?.mentions;
        const hasMentions = mentions && mentions.length > 0;
        let content;
        let msgType;
        if (hasMarkdown(text) || hasMentions) {
            let mdText = text;
            if (hasMentions) {
                for (const m of mentions) {
                    mdText = mdText.replace(new RegExp(`@${m.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'), `<at id=${m.platformId}></at>`);
                }
            }
            content = JSON.stringify(markdownToCard(mdText));
            msgType = 'interactive';
        }
        else {
            content = JSON.stringify({ text });
            msgType = 'text';
        }
        // Use quote reply when we have the original message ID.
        if (msg.messageId) {
            await this.client.im.v1.message.reply({
                path: { message_id: msg.messageId },
                data: { content, msg_type: msgType },
            });
        }
        else {
            await this.client.im.v1.message.create({
                params: { receive_id_type: 'chat_id' },
                data: { receive_id: msg.chatId, content, msg_type: msgType },
            });
        }
    }
    async send(chatId, text) {
        if (!this.client)
            return;
        if (hasMarkdown(text)) {
            const card = markdownToCard(text);
            await this.client.im.v1.message.create({
                params: { receive_id_type: 'chat_id' },
                data: {
                    receive_id: chatId,
                    content: JSON.stringify(card),
                    msg_type: 'interactive',
                },
            });
        }
        else {
            await this.client.im.v1.message.create({
                params: { receive_id_type: 'chat_id' },
                data: {
                    receive_id: chatId,
                    content: JSON.stringify({ text }),
                    msg_type: 'text',
                },
            });
        }
    }
    /**
     * Fetch single-message detail to resolve @mentions.
     * Returns true if this bot is @mentioned, false if not, undefined on error.
     */
    async resolveMentioned(token, messageId) {
        try {
            const resp = await fetch(`https://open.feishu.cn/open-apis/im/v1/messages/${messageId}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const json = (await resp.json());
            if (json.code !== 0)
                return undefined;
            const mentions = json.data?.items?.[0]?.mentions ?? [];
            return mentions.some((m) => (m.id?.open_id ?? m.id) === this.botOpenId);
        }
        catch {
            return undefined;
        }
    }
    async fetchHistory(chatId, since, limit = 50) {
        if (!this.client)
            return [];
        const token = await this.client.tokenManager.getTenantAccessToken();
        const messages = [];
        let pageToken;
        // Feishu expects timestamps in seconds (string)
        const startTime = Math.floor(since.getTime() / 1000).toString();
        outer: do {
            const url = new URL('https://open.feishu.cn/open-apis/im/v1/messages');
            url.searchParams.set('container_id_type', 'chat');
            url.searchParams.set('container_id', chatId);
            url.searchParams.set('start_time', startTime);
            url.searchParams.set('sort_type', 'ByCreateTimeAsc');
            url.searchParams.set('page_size', String(Math.min(limit, 50)));
            if (pageToken)
                url.searchParams.set('page_token', pageToken);
            const resp = await fetch(url.toString(), {
                headers: { Authorization: `Bearer ${token}` },
            });
            const json = (await resp.json());
            if (json.code !== 0) {
                console.error(`[feishu] fetchHistory error: ${json.code} ${json.msg}`);
                break;
            }
            for (const item of json.data?.items ?? []) {
                if (messages.length >= limit)
                    break outer;
                // Skip only THIS bot's own messages (by open_id match).
                // Other bots' messages are preserved for multi-bot awareness.
                const isSelf = this.botOpenId && item.sender?.id === this.botOpenId;
                if (isSelf)
                    continue;
                const isBot = item.sender?.sender_type === 'app';
                const msgType = item.msg_type;
                if (msgType !== 'text' && msgType !== 'post')
                    continue;
                let text = '';
                try {
                    const content = JSON.parse(item.body?.content ?? '{}');
                    if (msgType === 'text') {
                        text = content.text || '';
                    }
                    else if (msgType === 'post') {
                        // Extract plain text from post
                        const lines = Array.isArray(content.content) ? content.content : [];
                        const parts = [];
                        if (content.title)
                            parts.push(content.title);
                        for (const line of lines) {
                            if (!Array.isArray(line))
                                continue;
                            for (const el of line) {
                                if (el.tag === 'text')
                                    parts.push(el.text || '');
                                else if (el.tag === 'a')
                                    parts.push(el.text || el.href || '');
                                else if (el.tag === 'at')
                                    parts.push(el.user_name ? `@${el.user_name}` : '');
                            }
                        }
                        text = parts.join(' ').trim();
                    }
                }
                catch {
                    continue;
                }
                if (!text)
                    continue;
                const senderId = item.sender?.id;
                const senderName = senderId ? await this.resolveUserName(senderId) : undefined;
                const createTime = item.create_time ? new Date(Number(item.create_time)).toISOString() : undefined;
                // The list-messages API doesn't return `mentions`.  For messages
                // containing @_user_N patterns, fetch the single-message detail API
                // to resolve whether THIS bot is @mentioned.
                let isMentioned;
                if (this.botOpenId && text.includes('@_user_')) {
                    isMentioned = await this.resolveMentioned(token, item.message_id);
                }
                messages.push({
                    channelType: 'feishu',
                    senderId: senderId || 'unknown',
                    senderName: senderName || senderId || 'unknown',
                    chatId,
                    chatType: 'group', // history is typically from group chats
                    text,
                    messageId: item.message_id,
                    senderType: isBot ? 'bot' : 'user',
                    mentioned: isMentioned,
                    raw: { ...item, _fetchedAt: createTime },
                });
            }
            pageToken = json.data?.has_more ? json.data?.page_token : undefined;
        } while (pageToken);
        return messages;
    }
    async listChats() {
        if (!this.client)
            return [];
        const token = await this.client.tokenManager.getTenantAccessToken();
        const chats = [];
        let pageToken;
        do {
            const url = new URL('https://open.feishu.cn/open-apis/im/v1/chats');
            if (pageToken)
                url.searchParams.set('page_token', pageToken);
            const resp = await fetch(url.toString(), {
                headers: { Authorization: `Bearer ${token}` },
            });
            const json = (await resp.json());
            if (json.code !== 0) {
                console.error(`[feishu] listChats error: ${json.code} ${json.msg}`);
                break;
            }
            for (const item of json.data?.items ?? []) {
                chats.push({
                    chatId: item.chat_id,
                    chatType: item.chat_type === 'p2p' ? 'dm' : 'group',
                });
            }
            pageToken = json.data?.has_more ? json.data?.page_token : undefined;
        } while (pageToken);
        return chats;
    }
    async stop() {
        // WSClient doesn't expose a clean close method in current SDK version;
        // setting to null allows GC to collect.
        this.wsClient = null;
        this.client = null;
    }
}
//# sourceMappingURL=feishu.js.map