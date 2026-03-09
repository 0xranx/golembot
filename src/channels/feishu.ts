import type { ChannelAdapter, ChannelMessage, ReplyOptions, MentionTarget, ReadReceipt, ImageAttachment } from '../channel.js';
import type { FeishuChannelConfig } from '../workspace.js';
import { hasMarkdown, markdownToPost, markdownToCard, injectMentionsIntoPost } from './feishu-format.js';
import { importPeer } from '../peer-require.js';

/** Detect image MIME type from magic bytes. */
function detectImageMime(data: Buffer): string {
  if (data[0] === 0x89 && data[1] === 0x50) return 'image/png';
  if (data[0] === 0xFF && data[1] === 0xD8) return 'image/jpeg';
  if (data[0] === 0x47 && data[1] === 0x49) return 'image/gif';
  if (data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46) return 'image/webp';
  return 'image/png'; // fallback
}

export class FeishuAdapter implements ChannelAdapter {
  readonly name = 'feishu';
  readonly maxMessageLength = 4000;
  readReceiptHandler?: (receipt: ReadReceipt) => void;
  private config: FeishuChannelConfig;
  private client: any;
  private wsClient: any;

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
  }

  private async resolveUserName(openId: string): Promise<string | undefined> {
    const cached = this.userNameCache.get(openId);
    if (cached) return cached;
    try {
      const token = await this.client.tokenManager.getTenantAccessToken();
      const resp = await fetch(`https://open.feishu.cn/open-apis/contact/v3/users/${openId}?user_id_type=open_id`, {
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
      `https://open.feishu.cn/open-apis/im/v1/messages/${messageId}/resources/${imageKey}?type=image`,
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

  async start(onMessage: (msg: ChannelMessage) => void): Promise<void> {
    let lark: any;
    try {
      lark = await importPeer('@larksuiteoapi/node-sdk');
    } catch {
      throw new Error(
        'Feishu adapter requires @larksuiteoapi/node-sdk. Install it: npm install @larksuiteoapi/node-sdk',
      );
    }

    const baseConfig = {
      appId: this.config.appId,
      appSecret: this.config.appSecret,
    };

    this.client = new lark.Client(baseConfig);

    // Bot's own open_id — fetched lazily via raw HTTP (client.bot namespace doesn't exist in SDK).
    let botOpenId: string | undefined;
    const fetchBotOpenId = async (): Promise<string | undefined> => {
      if (botOpenId) return botOpenId;
      try {
        const token = await this.client.tokenManager.getTenantAccessToken();
        const resp = await fetch('https://open.feishu.cn/open-apis/bot/v3/info', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = (await resp.json()) as any;
        botOpenId = json?.bot?.open_id;
        if (botOpenId) console.log(`[feishu] Bot open_id resolved: ${botOpenId}`);
      } catch {
        // Will retry on the next group message.
      }
      return botOpenId;
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
        if (msgType !== 'text' && msgType !== 'image' && msgType !== 'post') return;

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
          isMentioned = resolvedId
            ? mentions.some(m => m.id?.open_id === resolvedId)
            : mentions.length > 0;
        }

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

        // Process @mentions in text:
        // - Strip the bot's own @mention key entirely
        // - Replace other users' @mention keys with readable @Name format
        if (chatType === 'group' && mentions.length) {
          for (const m of mentions) {
            const isBot = botOpenId ? m.id?.open_id === botOpenId : true;
            if (isBot) {
              text = text.replace(m.key, '').trim();
            } else if (m.name) {
              text = text.replace(m.key, `@${m.name}`);
            }
          }
        }

        if (!text && images.length === 0) return;

        const senderId = sender.sender_id?.open_id || sender.sender_id?.user_id || '';
        const senderName = await this.resolveUserName(senderId);

        // Collect names of other @mentioned users/bots (not this bot).
        const otherMentionNames: string[] = [];
        if (chatType === 'group') {
          for (const m of mentions) {
            const isBot = botOpenId ? m.id?.open_id === botOpenId : false;
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
          images: images.length > 0 ? images : undefined,
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
        const url = new URL(`https://open.feishu.cn/open-apis/im/v1/chats/${chatId}/members`);
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

    if (hasMarkdown(text) || hasMentions) {
      // Card v2 (default) — best markdown rendering with native headings, lists, code blocks
      let mdText = text;
      if (hasMentions) {
        for (const m of mentions) {
          mdText = mdText.replace(
            new RegExp(`@${m.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'),
            `<at id=${m.platformId}></at>`,
          );
        }
      }
      const card = markdownToCard(mdText);
      await this.client.im.v1.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: msg.chatId,
          content: JSON.stringify(card),
          msg_type: 'interactive',
        },
      });
    } else {
      // Plain text
      await this.client.im.v1.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: msg.chatId,
          content: JSON.stringify({ text }),
          msg_type: 'text',
        },
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

  async stop(): Promise<void> {
    // WSClient doesn't expose a clean close method in current SDK version;
    // setting to null allows GC to collect.
    this.wsClient = null;
    this.client = null;
  }
}
