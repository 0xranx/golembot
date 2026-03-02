import type { ChannelAdapter, ChannelMessage } from '../channel.js';
import type { FeishuChannelConfig } from '../workspace.js';

export class FeishuAdapter implements ChannelAdapter {
  readonly name = 'feishu';
  private config: FeishuChannelConfig;
  private client: any;
  private wsClient: any;

  constructor(config: FeishuChannelConfig) {
    this.config = config;
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

        // In group chats, only respond when the bot is @mentioned.
        if (chatType === 'group') {
          const resolvedId = await fetchBotOpenId();
          if (resolvedId) {
            const isMentioned = mentions.some(m => m.id?.open_id === resolvedId);
            if (!isMentioned) return;
          } else {
            // Last-resort fallback: require at least one @mention in the message.
            if (mentions.length === 0) return;
          }
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

        const channelMsg: ChannelMessage = {
          channelType: 'feishu',
          senderId: sender.sender_id?.open_id || sender.sender_id?.user_id || '',
          senderName: sender.sender_id?.open_id,
          chatId: message.chat_id,
          chatType,
          text,
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

  async reply(msg: ChannelMessage, text: string): Promise<void> {
    if (!this.client) return;
    await this.client.im.v1.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: msg.chatId,
        content: JSON.stringify({ text }),
        msg_type: 'text',
      },
    });
  }

  async stop(): Promise<void> {
    // WSClient doesn't expose a clean close method in current SDK version;
    // setting to null allows GC to collect.
    this.wsClient = null;
    this.client = null;
  }
}
