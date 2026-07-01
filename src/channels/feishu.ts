import type {
  ChannelAdapter,
  ChannelMessage,
  FileAttachment,
  ImageAttachment,
  ReadReceipt,
  ReplyOptions,
} from '../channel.js';
import { importPeer } from '../peer-require.js';
import type { FeishuChannelConfig } from '../workspace.js';
import { hasMarkdown, markdownToCard } from './feishu-format.js';

const FEISHU_OPEN_API_BASE_URL = 'https://open.feishu.cn';
const LARK_OPEN_API_BASE_URL = 'https://open.larksuite.com';

export function resolveFeishuOpenApiBaseUrl(domain?: string): string {
  const rawDomain = domain?.trim();
  const normalizedDomain = rawDomain?.toLowerCase();
  if (!normalizedDomain || normalizedDomain === 'feishu') return FEISHU_OPEN_API_BASE_URL;
  if (normalizedDomain === 'lark' || normalizedDomain === 'larksuite') return LARK_OPEN_API_BASE_URL;
  if (rawDomain && /^https?:\/\//i.test(rawDomain)) return rawDomain.replace(/\/+$/, '');

  throw new Error(
    `Invalid channels.feishu.domain: ${domain}. Use "feishu", "lark", or a full https:// OpenAPI base URL.`,
  );
}

export function buildFeishuClientConfig(config: FeishuChannelConfig): {
  appId: string;
  appSecret: string;
  domain: string;
} {
  return {
    appId: config.appId,
    appSecret: config.appSecret,
    domain: resolveFeishuOpenApiBaseUrl(config.domain),
  };
}

/** Detect image MIME type from magic bytes. */
function detectImageMime(data: Buffer): string {
  if (data[0] === 0x89 && data[1] === 0x50) return 'image/png';
  if (data[0] === 0xff && data[1] === 0xd8) return 'image/jpeg';
  if (data[0] === 0x47 && data[1] === 0x49) return 'image/gif';
  if (data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46) return 'image/webp';
  return 'image/png'; // fallback
}

export class FeishuAdapter implements ChannelAdapter {
  readonly name = 'feishu';
  readonly maxMessageLength = 4000;
  readReceiptHandler?: (receipt: ReadReceipt) => void;
  private config: FeishuChannelConfig;
  private openApiBaseUrl: string;
  private client: any;
  private wsClient: any;

  /** Bot's own open_id — resolved lazily on first group message, used for self-filtering. */
  private botOpenId: string | undefined;

  private userNameCache = new Map<string, string>();
  /** Recent message IDs used to deduplicate re-delivered events. */
  private seenMsgIds = new Set<string>();
  private static readonly MAX_SEEN = 500;

  /** Cached group members: chatId → (displayName → open_id). */
  private groupMemberCache = new Map<string, Map<string, string>>();
  private groupMemberCacheTime = new Map<string, number>();
  private static readonly MEMBER_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

  constructor(config: FeishuChannelConfig) {
    this.config = config;
    this.openApiBaseUrl = buildFeishuClientConfig(config).domain;
  }

  private openApiUrl(path: string): string {
    return `${this.openApiBaseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  }

  private async resolveUserName(openId: string): Promise<string | undefined> {
    const cached = this.userNameCache.get(openId);
    if (cached) return cached;
    try {
      const token = await this.client.tokenManager.getTenantAccessToken();
      const resp = await fetch(this.openApiUrl(`/open-apis/contact/v3/users/${openId}?user_id_type=open_id`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = (await resp.json()) as any;
      const name = json?.data?.user?.name;
      if (name) this.userNameCache.set(openId, name);
      return name;
    } catch {
      return undefined;
    }
  }

  /**
   * Download an image resource from a Feishu message.
   * Uses the IM v1 message resource API.
   */
  private async downloadImage(messageId: string, imageKey: string): Promise<ImageAttachment> {
    const token = await this.client.tokenManager.getTenantAccessToken();
    const resp = await fetch(
      this.openApiUrl(`/open-apis/im/v1/messages/${messageId}/resources/${imageKey}?type=image`),
      { headers: { Authorization: `Bearer ${token}` } },
    );
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
  private async downloadFile(messageId: string, fileKey: string, fileName: string): Promise<FileAttachment> {
    const token = await this.client.tokenManager.getTenantAccessToken();
    const resp = await fetch(this.openApiUrl(`/open-apis/im/v1/messages/${messageId}/resources/${fileKey}?type=file`), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) {
      throw new Error(`Feishu file download failed: ${resp.status} ${resp.statusText}`);
    }
    const data = Buffer.from(await resp.arrayBuffer());
    const contentType = resp.headers.get('content-type') || 'application/octet-stream';
    const mimeType = contentType.split(';')[0];
    return { mimeType, data, fileName };
  }

  async start(onMessage: (msg: ChannelMessage) => void): Promise<void> {
    let lark: any;
    try {
      lark = await importPeer('@larksuiteoapi/node-sdk');
    } catch {
      throw new Error(
        'Feishu adapter requires @larksuiteoapi/node-sdk. Install it: npm install @larksuiteoapi/node-sdk',
      );
    }

    const baseConfig = buildFeishuClientConfig(this.config);

    this.client = new lark.Client(baseConfig);

    // Bot's own open_id — fetched lazily via raw HTTP (client.bot namespace doesn't exist in SDK).
    // Stored as class property so fetchHistory() can also use it for self-filtering.
    const fetchBotOpenId = async (): Promise<string | undefined> => {
      if (this.botOpenId) return this.botOpenId;
      try {
        const token = await this.client.tokenManager.getTenantAccessToken();
        const resp = await fetch(this.openApiUrl('/open-apis/bot/v3/info'), {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = (await resp.json()) as any;
        this.botOpenId = json?.bot?.open_id;
        if (this.botOpenId) console.log(`[feishu] Bot open_id resolved: ${this.botOpenId}`);
      } catch {
        // Will retry on the next group message.
      }
      return this.botOpenId;
    };

    // Best-effort initial fetch (non-blocking).
    fetchBotOpenId().catch(() => {});

    const events: Record<string, (data: any) => void | Promise<void>> = {};

    // Read receipt event — fired when a user reads a message sent by the bot.
    // Requires the `im:message.message_read_v1` event subscription in Feishu console.
    if (this.readReceiptHandler) {
      const handler = this.readReceiptHandler;
      events['im.message.message_read_v1'] = (data: any) => {
        try {
          const reader = data?.reader;
          const readerId = reader?.reader_id?.open_id;
          const messageIdList: string[] = data?.message_id_list ?? [];
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
        } catch {
          // best-effort — never crash on read receipt processing
        }
      };
    }

    events['im.message.receive_v1'] = async (data: any) => {
      const { message, sender } = data;

      // Deduplicate re-delivered events.
      // Primary: message_id (always present in im.message.receive_v1 events).
      // Fallback: content-based dedup (chat_id + sender + text hash + 10s window)
      // to guard against SDK re-dispatches with different envelope IDs.
      const msgId: string | undefined = message.message_id;
      if (msgId) {
        if (this.seenMsgIds.has(msgId)) return;
        this.seenMsgIds.add(msgId);
        if (this.seenMsgIds.size > FeishuAdapter.MAX_SEEN) {
          const entries = [...this.seenMsgIds];
          this.seenMsgIds = new Set(entries.slice(entries.length >> 1));
        }
      }

      // Secondary dedup: same chat + sender + content within 10s window.
      // Lark WSClient may fire the handler twice for the same event.
      const contentKey = `${message.chat_id}:${sender?.sender_id?.open_id}:${message.content}`;
      if (this.seenMsgIds.has(contentKey)) return;
      this.seenMsgIds.add(contentKey);
      // Auto-expire content keys after 10s.
      setTimeout(() => this.seenMsgIds.delete(contentKey), 10_000);

      // Parse message content based on type
      const msgType = message.message_type;
      if (msgType !== 'text' && msgType !== 'image' && msgType !== 'post' && msgType !== 'file' && msgType !== 'audio')
        return;

      let parsedContent: Record<string, any>;
      try {
        parsedContent = JSON.parse(message.content);
      } catch {
        return;
      }

      // Mentions are on message.mentions (not inside content JSON).
      type Mention = { key: string; id: { open_id: string }; name?: string };
      const mentions: Mention[] = message.mentions ?? [];

      const chatType: 'dm' | 'group' = message.chat_type === 'p2p' ? 'dm' : 'group';

      // Detect if the bot is @mentioned in group chats.
      let isMentioned = false;
      if (chatType === 'group') {
        const resolvedId = await fetchBotOpenId();
        isMentioned = resolvedId ? mentions.some((m) => m.id?.open_id === resolvedId) : mentions.length > 0;
      }

      // Detect sender type for multi-bot awareness
      const senderType: 'user' | 'bot' | undefined = sender?.sender_type === 'app' ? 'bot' : 'user';

      let text = '';
      const images: ImageAttachment[] = [];

      if (msgType === 'text') {
        text = parsedContent.text || '';
      } else if (msgType === 'image') {
        // Image-only message: download the image
        const imageKey = parsedContent.image_key;
        if (imageKey) {
          try {
            const img = await this.downloadImage(message.message_id, imageKey);
            images.push(img);
          } catch (e) {
            console.error('[feishu] Failed to download image:', (e as Error).message);
            return;
          }
        }
        text = '(image)';
      } else if (msgType === 'post') {
        // Rich text (post) message: extract text + inline images
        const content = parsedContent.content;
        // post content is structured as: { title, content: [[{tag, ...}, ...], ...] }
        // content is an array of lines, each line is an array of inline elements
        const lines: any[][] = Array.isArray(content) ? content : [];
        const textParts: string[] = [];
        if (parsedContent.title) textParts.push(parsedContent.title);
        for (const line of lines) {
          if (!Array.isArray(line)) continue;
          for (const el of line as any[]) {
            if (el.tag === 'text') textParts.push(el.text || '');
            else if (el.tag === 'a') textParts.push(el.text || el.href || '');
            else if (el.tag === 'at') textParts.push(el.user_name ? `@${el.user_name}` : '');
            else if (el.tag === 'img' && el.image_key) {
              try {
                const img = await this.downloadImage(message.message_id, el.image_key);
                images.push(img);
              } catch (e) {
                console.error('[feishu] Failed to download inline image:', (e as Error).message);
              }
            }
          }
        }
        text = textParts.join(' ').trim();
        if (!text && images.length > 0) text = '(image)';
      }

      // File attachment handling
      const files: FileAttachment[] = [];

      if (msgType === 'file') {
        const fileKey = parsedContent.file_key;
        const fileName = parsedContent.file_name || 'attachment';
        if (fileKey) {
          try {
            const file = await this.downloadFile(message.message_id, fileKey, fileName);
            files.push(file);
            text = `(file: ${fileName})`;
          } catch (e) {
            console.error('[feishu] Failed to download file:', (e as Error).message);
            return;
          }
        }
      } else if (msgType === 'audio') {
        const fileKey = parsedContent.file_key;
        if (fileKey) {
          try {
            const file = await this.downloadFile(message.message_id, fileKey, 'voice.opus');
            files.push(file);
            text = '(audio)';
          } catch (e) {
            console.error('[feishu] Failed to download audio:', (e as Error).message);
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
          } else if (m.name) {
            text = text.replace(m.key, `@${m.name}`);
          }
        }
      }

      if (!text && images.length === 0 && files.length === 0) return;

      const senderId = sender.sender_id?.open_id || sender.sender_id?.user_id || '';
      const senderName = await this.resolveUserName(senderId);

      // Collect names of other @mentioned users/bots (not this bot).
      const otherMentionNames: string[] = [];
      if (chatType === 'group') {
        for (const m of mentions) {
          const isBot = this.botOpenId ? m.id?.open_id === this.botOpenId : false;
          if (!isBot && m.name) otherMentionNames.push(m.name);
        }
      }

      const channelMsg: ChannelMessage = {
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
      pingTimeout: this.config.pingTimeout ?? 30,
      onReady: () => console.log('[feishu] WS ready'),
      onReconnecting: () => console.log('[feishu] WS reconnecting...'),
      onReconnected: () => console.log('[feishu] WS reconnected'),
      onError: (err: unknown) => console.error('[feishu] WS error:', (err as Error)?.message),
    });

    await this.wsClient.start({ eventDispatcher });
    console.log(`[feishu] WebSocket connection established`);
  }

  async getGroupMembers(chatId: string): Promise<Map<string, string>> {
    const cached = this.groupMemberCache.get(chatId);
    const ts = this.groupMemberCacheTime.get(chatId) ?? 0;
    if (cached && Date.now() - ts < FeishuAdapter.MEMBER_CACHE_TTL) return cached;

    if (!this.client) return new Map();

    try {
      const token = await this.client.tokenManager.getTenantAccessToken();
      const members = new Map<string, string>();
      let pageToken: string | undefined;

      do {
        const url = new URL(this.openApiUrl(`/open-apis/im/v1/chats/${chatId}/members`));
        url.searchParams.set('member_id_type', 'open_id');
        if (pageToken) url.searchParams.set('page_token', pageToken);

        const resp = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = (await resp.json()) as any;

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
    } catch {
      return cached ?? new Map();
    }
  }

  async reply(msg: ChannelMessage, text: string, options?: ReplyOptions): Promise<void> {
    if (!this.client) return;

    const mentions = options?.mentions;
    const hasMentions = mentions && mentions.length > 0;

    let content: string;
    let msgType: string;

    if (hasMarkdown(text) || hasMentions) {
      let mdText = text;
      if (hasMentions) {
        for (const m of mentions) {
          mdText = mdText.replace(
            new RegExp(`@${m.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'),
            `<at id=${m.platformId}></at>`,
          );
        }
      }
      content = JSON.stringify(markdownToCard(mdText));
      msgType = 'interactive';
    } else {
      content = JSON.stringify({ text });
      msgType = 'text';
    }

    // Use quote reply when we have the original message ID.
    if (msg.messageId) {
      await this.client.im.v1.message.reply({
        path: { message_id: msg.messageId },
        data: { content, msg_type: msgType },
      });
    } else {
      await this.client.im.v1.message.create({
        params: { receive_id_type: 'chat_id' },
        data: { receive_id: msg.chatId, content, msg_type: msgType },
      });
    }
  }

  async send(chatId: string, text: string): Promise<void> {
    if (!this.client) return;

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
    } else {
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
  private async resolveMentioned(token: string, messageId: string): Promise<boolean | undefined> {
    try {
      const resp = await fetch(this.openApiUrl(`/open-apis/im/v1/messages/${messageId}`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = (await resp.json()) as any;
      if (json.code !== 0) return undefined;
      const mentions: any[] = json.data?.items?.[0]?.mentions ?? [];
      return mentions.some((m: any) => (m.id?.open_id ?? m.id) === this.botOpenId);
    } catch {
      return undefined;
    }
  }

  async fetchHistory(chatId: string, since: Date, limit = 50): Promise<ChannelMessage[]> {
    if (!this.client) return [];
    const token = await this.client.tokenManager.getTenantAccessToken();
    const messages: ChannelMessage[] = [];
    let pageToken: string | undefined;
    // Feishu expects timestamps in seconds (string)
    const startTime = Math.floor(since.getTime() / 1000).toString();

    outer: do {
      const url = new URL(this.openApiUrl('/open-apis/im/v1/messages'));
      url.searchParams.set('container_id_type', 'chat');
      url.searchParams.set('container_id', chatId);
      url.searchParams.set('start_time', startTime);
      url.searchParams.set('sort_type', 'ByCreateTimeAsc');
      url.searchParams.set('page_size', String(Math.min(limit, 50)));
      if (pageToken) url.searchParams.set('page_token', pageToken);

      const resp = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = (await resp.json()) as any;
      if (json.code !== 0) {
        console.error(`[feishu] fetchHistory error: ${json.code} ${json.msg}`);
        break;
      }

      for (const item of json.data?.items ?? []) {
        if (messages.length >= limit) break outer;

        // Skip only THIS bot's own messages (by open_id match).
        // Other bots' messages are preserved for multi-bot awareness.
        const isSelf = this.botOpenId && item.sender?.id === this.botOpenId;
        if (isSelf) continue;

        const isBot = item.sender?.sender_type === 'app';

        const msgType = item.msg_type;
        if (msgType !== 'text' && msgType !== 'post') continue;

        let text = '';
        try {
          const content = JSON.parse(item.body?.content ?? '{}');
          if (msgType === 'text') {
            text = content.text || '';
          } else if (msgType === 'post') {
            // Extract plain text from post
            const lines: any[][] = Array.isArray(content.content) ? content.content : [];
            const parts: string[] = [];
            if (content.title) parts.push(content.title);
            for (const line of lines) {
              if (!Array.isArray(line)) continue;
              for (const el of line) {
                if (el.tag === 'text') parts.push(el.text || '');
                else if (el.tag === 'a') parts.push(el.text || el.href || '');
                else if (el.tag === 'at') parts.push(el.user_name ? `@${el.user_name}` : '');
              }
            }
            text = parts.join(' ').trim();
          }
        } catch {
          continue;
        }

        if (!text) continue;

        const senderId = item.sender?.id;
        const senderName = senderId ? await this.resolveUserName(senderId) : undefined;
        const createTime = item.create_time ? new Date(Number(item.create_time)).toISOString() : undefined;

        // The list-messages API doesn't return `mentions`.  For messages
        // containing @_user_N patterns, fetch the single-message detail API
        // to resolve whether THIS bot is @mentioned.
        let isMentioned: boolean | undefined;
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

  async listChats(): Promise<Array<{ chatId: string; chatType: 'dm' | 'group' }>> {
    if (!this.client) return [];
    const token = await this.client.tokenManager.getTenantAccessToken();
    const chats: Array<{ chatId: string; chatType: 'dm' | 'group' }> = [];
    let pageToken: string | undefined;

    do {
      const url = new URL(this.openApiUrl('/open-apis/im/v1/chats'));
      if (pageToken) url.searchParams.set('page_token', pageToken);

      const resp = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = (await resp.json()) as any;
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

  async stop(): Promise<void> {
    if (this.wsClient) {
      try {
        this.wsClient.close();
      } catch {}
    }
    this.wsClient = null;
    this.client = null;
  }
}
