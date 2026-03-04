import type { ChannelAdapter, ChannelMessage } from '../channel.js';
import type { SlackChannelConfig } from '../workspace.js';

export class SlackAdapter implements ChannelAdapter {
  readonly name = 'slack';
  readonly maxMessageLength = 4000;
  private config: SlackChannelConfig;
  private app: any;
  private userNameCache = new Map<string, string>();

  constructor(config: SlackChannelConfig) {
    this.config = config;
  }

  private async resolveUserName(userId: string): Promise<string | undefined> {
    const cached = this.userNameCache.get(userId);
    if (cached) return cached;
    try {
      const res = await this.app.client.users.info({ user: userId });
      const name = res.user?.profile?.display_name || res.user?.real_name;
      if (name) this.userNameCache.set(userId, name);
      return name;
    } catch {
      return undefined;
    }
  }

  async start(onMessage: (msg: ChannelMessage) => void): Promise<void> {
    let boltModule: any;
    try {
      boltModule = await import('@slack/bolt');
    } catch {
      throw new Error(
        'Slack adapter requires @slack/bolt. Install it: npm install @slack/bolt',
      );
    }

    const { App } = boltModule;
    this.app = new App({
      token: this.config.botToken,
      appToken: this.config.appToken,
      socketMode: true,
    });

    // Handle DM messages (channel_type === 'im')
    this.app.message(async ({ message }: any) => {
      if (message.subtype) return; // ignore edits, bot messages, etc.
      if (message.channel_type !== 'im') return; // group messages handled via app_mention
      if (!message.text) return;

      const senderName = await this.resolveUserName(message.user);
      onMessage({
        channelType: 'slack',
        senderId: message.user,
        senderName,
        chatId: message.channel,
        chatType: 'dm',
        text: message.text,
        raw: message,
      });
    });

    // Handle group @mention events
    this.app.event('app_mention', async ({ event }: any) => {
      if (!event.text) return;
      // Strip <@BOT_ID> prefix(es)
      const text = event.text.replace(/<@[A-Z0-9]+>/g, '').trim();
      if (!text) return;

      const senderName = await this.resolveUserName(event.user);
      onMessage({
        channelType: 'slack',
        senderId: event.user,
        senderName,
        chatId: event.channel,
        chatType: 'group',
        text,
        mentioned: true,
        raw: event,
      });
    });

    // Log all unhandled errors from Bolt
    this.app.error(async (error: any) => {
      console.error('[slack:error]', error);
    });

    await this.app.start();
    console.log(`[slack] Socket Mode connection established`);
  }

  async reply(msg: ChannelMessage, text: string): Promise<void> {
    if (!this.app) return;
    await this.app.client.chat.postMessage({
      channel: msg.chatId,
      text,
    });
  }

  async stop(): Promise<void> {
    if (this.app) {
      await this.app.stop();
      this.app = null;
    }
  }
}
