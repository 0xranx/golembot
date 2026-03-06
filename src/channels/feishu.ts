import type { ChannelAdapter, ChannelMessage, ReplyOptions, MentionTarget } from '../channel.js';
import type { FeishuChannelConfig } from '../workspace.js';
import { hasMarkdown, markdownToPost, markdownToCard, injectMentionsIntoPost } from './feishu-format.js';

export class FeishuAdapter implements ChannelAdapter {
  readonly name = 'feishu';
  readonly maxMessageLength = 4000;
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

  async start(onMessage: (msg: ChannelMessage) => void): Promise<void> {
    let lark: any;
    try {
      lark = await import('@larksuiteoapi/node-sdk');
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

    const eventDispatcher = new lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (data: any) => {
        const { message, sender } = data;

        // Deduplicate re-delivered events.
        const msgId: string | undefined = message.message_id;
        if (msgId) {
          if (this.seenMsgIds.has(msgId)) return;
          this.seenMsgIds.add(msgId);
          if (this.seenMsgIds.size > FeishuAdapter.MAX_SEEN) {
            // Evict oldest half.
            const entries = [...this.seenMsgIds];
            this.seenMsgIds = new Set(entries.slice(entries.length >> 1));
          }
        }

        if (message.message_type !== 'text') return;

        let content: { text: string };
        try {
          content = JSON.parse(message.content);
        } catch {
          return;
        }

        // Mentions are on message.mentions (not inside content JSON).
        type Mention = { key: string; id: { open_id: string } };
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

        // Strip the bot's @mention key from the text before passing to the assistant.
        let text = content.text || '';
        if (chatType === 'group' && mentions.length) {
          for (const m of mentions) {
            const isBot = botOpenId ? m.id?.open_id === botOpenId : true;
            if (isBot) {
              text = text.replace(m.key, '').trim();
            }
          }
        }

        if (!text) return;

        const senderId = sender.sender_id?.open_id || sender.sender_id?.user_id || '';
        const senderName = await this.resolveUserName(senderId);
        const channelMsg: ChannelMessage = {
          channelType: 'feishu',
          senderId,
          senderName: senderName || senderId,
          chatId: message.chat_id,
          chatType,
          text,
          mentioned: chatType === 'group' ? isMentioned : undefined,
          raw: data,
        };

        onMessage(channelMsg);
      },
    });

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

  async stop(): Promise<void> {
    // WSClient doesn't expose a clean close method in current SDK version;
    // setting to null allows GC to collect.
    this.wsClient = null;
    this.client = null;
  }
}
