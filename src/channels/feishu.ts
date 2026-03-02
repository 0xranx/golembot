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

    // Fetch the bot's own open_id so we can filter @mentions in group chats.
    let botOpenId: string | undefined;
    try {
      const botInfo = await this.client.bot.v3.info.get({});
      botOpenId = (botInfo as any).data?.bot?.open_id;
    } catch {
      console.warn('[feishu] Could not fetch bot open_id; group messages will be ignored');
    }

    const eventDispatcher = new lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (data: any) => {
        const { message, sender } = data;

        if (message.message_type !== 'text') return;

        let content: { text: string; mentions?: Array<{ key: string; id: { open_id: string } }> };
        try {
          content = JSON.parse(message.content);
        } catch {
          return;
        }

        const chatType: 'dm' | 'group' = message.chat_type === 'p2p' ? 'dm' : 'group';

        // In group chats, only respond when the bot is @mentioned.
        if (chatType === 'group') {
          if (botOpenId) {
            // Precise check: bot's open_id must appear in the mention list.
            const isMentioned = content.mentions?.some(m => m.id?.open_id === botOpenId) ?? false;
            if (!isMentioned) return;
          } else {
            // Fallback: if we couldn't fetch the bot's open_id, require at least one mention.
            const hasMention = (content.mentions?.length ?? 0) > 0;
            if (!hasMention) return;
          }
        }

        // Strip the bot's @mention key from the text before passing to the assistant.
        let text = content.text || '';
        if (chatType === 'group' && content.mentions?.length) {
          for (const m of content.mentions) {
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
