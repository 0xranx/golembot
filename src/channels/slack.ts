import type { ChannelAdapter, ChannelMessage, ImageAttachment, ReplyOptions } from '../channel.js';
import { importPeer } from '../peer-require.js';
import type { SlackChannelConfig } from '../workspace.js';
import { markdownToMrkdwn } from './slack-format.js';

export class SlackAdapter implements ChannelAdapter {
  readonly name = 'slack';
  readonly maxMessageLength = 4000;
  private config: SlackChannelConfig;
  private app: any;
  private userNameCache = new Map<string, string>();
  private seenMsgIds = new Set<string>();
  private static readonly MAX_SEEN = 500;

  constructor(config: SlackChannelConfig) {
    this.config = config;
  }

  private dedup(id: string | undefined): boolean {
    if (!id) return false;
    if (this.seenMsgIds.has(id)) return true;
    this.seenMsgIds.add(id);
    if (this.seenMsgIds.size > SlackAdapter.MAX_SEEN) {
      const entries = [...this.seenMsgIds];
      this.seenMsgIds = new Set(entries.slice(entries.length >> 1));
    }
    return false;
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

  /**
   * Download image files attached to a Slack message.
   * Slack files require a Bearer token for download.
   */
  private async downloadFiles(files: any[] | undefined): Promise<ImageAttachment[]> {
    if (!files || files.length === 0) return [];
    const images: ImageAttachment[] = [];
    for (const file of files) {
      if (!file.mimetype?.startsWith('image/')) continue;
      const url = file.url_private_download || file.url_private;
      if (!url) continue;
      try {
        const resp = await fetch(url, {
          headers: { Authorization: `Bearer ${this.config.botToken}` },
        });
        if (resp.ok) {
          const buf = Buffer.from(await resp.arrayBuffer());
          images.push({ mimeType: file.mimetype, data: buf, fileName: file.name });
        }
      } catch (e) {
        console.error('[slack] Failed to download file:', (e as Error).message);
      }
    }
    return images;
  }

  async start(onMessage: (msg: ChannelMessage) => void): Promise<void> {
    let boltModule: any;
    try {
      boltModule = await importPeer('@slack/bolt');
    } catch {
      throw new Error('Slack adapter requires @slack/bolt. Install it: npm install @slack/bolt');
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
      if (this.dedup(message.client_msg_id || message.ts)) return;

      // Download attached images (Slack file uploads)
      const images = await this.downloadFiles(message.files);

      if (!message.text && images.length === 0) return;

      const senderName = await this.resolveUserName(message.user);
      onMessage({
        channelType: 'slack',
        senderId: message.user,
        senderName,
        chatId: message.channel,
        chatType: 'dm',
        text: message.text || (images.length > 0 ? '(image)' : ''),
        messageId: message.ts,
        images: images.length > 0 ? images : undefined,
        raw: message,
      });
    });

    // Handle group @mention events
    this.app.event('app_mention', async ({ event }: any) => {
      if (!event.text) return;
      if (this.dedup(event.event_ts || event.ts)) return;
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
        messageId: event.ts,
        mentioned: true,
        raw: event,
      });
    });

    // Log all unhandled errors from Bolt
    this.app.error(async (error: any) => {
      console.error('[slack:error]', error);
    });

    // Validate token before starting Socket Mode to fail fast with a clear error
    // instead of crashing the process with an unhandled rejection.
    try {
      await this.app.client.auth.test();
    } catch (e) {
      this.app = null;
      throw new Error(`Slack auth failed: ${(e as Error).message}`);
    }

    await this.app.start();
    console.log(`[slack] Socket Mode connection established`);
  }

  async getGroupMembers(chatId: string): Promise<Map<string, string>> {
    if (!this.app) return new Map();
    try {
      const res = await this.app.client.conversations.members({ channel: chatId });
      const members = new Map<string, string>();
      for (const userId of res.members ?? []) {
        const name = await this.resolveUserName(userId);
        if (name) members.set(name, userId);
      }
      return members;
    } catch {
      return new Map();
    }
  }

  async reply(msg: ChannelMessage, text: string, options?: ReplyOptions): Promise<void> {
    if (!this.app) return;
    // Convert markdown first, then substitute mentions so <@ID> tokens don't get escaped.
    let mrkdwn = markdownToMrkdwn(text);
    if (options?.mentions) {
      for (const m of options.mentions) {
        mrkdwn = mrkdwn.replace(
          new RegExp(`@${m.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'),
          `<@${m.platformId}>`,
        );
      }
    }
    await this.app.client.chat.postMessage({
      channel: msg.chatId,
      text: mrkdwn,
      ...(msg.messageId ? { thread_ts: msg.messageId } : {}),
    });
  }

  async send(chatId: string, text: string): Promise<void> {
    if (!this.app) return;
    await this.app.client.chat.postMessage({
      channel: chatId,
      text: markdownToMrkdwn(text),
    });
  }

  async fetchHistory(chatId: string, since: Date, limit = 50): Promise<ChannelMessage[]> {
    if (!this.app) return [];
    const messages: ChannelMessage[] = [];

    try {
      const res = await this.app.client.conversations.history({
        token: this.config.botToken,
        channel: chatId,
        oldest: String(since.getTime() / 1000),
        limit,
        inclusive: false,
      });

      for (const msg of res.messages ?? []) {
        // Skip bot messages and subtypes (joins, edits, etc.)
        if (msg.bot_id || msg.subtype) continue;
        if (!msg.text) continue;

        const senderName = await this.resolveUserName(msg.user);

        messages.push({
          channelType: 'slack',
          senderId: msg.user || 'unknown',
          senderName,
          chatId,
          chatType: 'group', // determined by caller; conversations.history works for both
          text: msg.text,
          messageId: msg.ts,
          raw: msg,
        });
      }
    } catch (e) {
      console.error(`[slack] fetchHistory error:`, (e as Error).message);
    }

    // Slack returns newest first; reverse to chronological order
    return messages.reverse();
  }

  async listChats(): Promise<Array<{ chatId: string; chatType: 'dm' | 'group' }>> {
    if (!this.app) return [];
    const chats: Array<{ chatId: string; chatType: 'dm' | 'group' }> = [];

    // Try with private_channel first; fall back without if groups:read scope is missing
    const typesList = ['public_channel,private_channel,im', 'public_channel,im'];
    for (const types of typesList) {
      try {
        let cursor: string | undefined;
        do {
          const res = await this.app.client.conversations.list({
            token: this.config.botToken,
            types,
            exclude_archived: true,
            limit: 200,
            cursor,
          });

          for (const ch of res.channels ?? []) {
            if (!ch.is_member) continue;
            chats.push({
              chatId: ch.id!,
              chatType: ch.is_im ? 'dm' : 'group',
            });
          }

          cursor = res.response_metadata?.next_cursor || undefined;
        } while (cursor);
        break; // success — no need to retry with fewer types
      } catch (e) {
        if (chats.length === 0 && types.includes('private_channel')) {
          continue; // retry without private_channel
        }
        console.error(`[slack] listChats error:`, (e as Error).message);
      }
    }

    return chats;
  }

  async stop(): Promise<void> {
    if (this.app) {
      await this.app.stop();
      this.app = null;
    }
  }
}
