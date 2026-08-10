import type { ChannelAdapter, ChannelMessage, OutboundMedia, ReplyOptions } from '../channel.js';
import { importPeer } from '../peer-require.js';
import type { WecomChannelConfig } from '../workspace.js';

interface StreamState {
  streamId: string;
  frame: any;
  timer: ReturnType<typeof setTimeout> | null;
}

export class WecomAdapter implements ChannelAdapter {
  readonly name = 'wecom';
  readonly maxMessageLength = 2048;
  private config: WecomChannelConfig;
  private wsClient: any = null;
  private seenMsgIds = new Set<string>();
  private static readonly MAX_SEEN = 500;
  /** chatId -> (display name -> userid), accumulated from incoming group frames. */
  private groupMemberCache = new Map<string, Map<string, string>>();
  private static readonly MEMBER_CACHE_TTL = 10 * 60 * 1000;
  private groupMemberCacheTime = new Map<string, number>();
  private streams = new Map<string, StreamState>();

  constructor(config: WecomChannelConfig) {
    this.config = config;
  }

  async start(onMessage: (msg: ChannelMessage) => void): Promise<void> {
    let AiBot: any;
    try {
      AiBot = await importPeer('@wecom/aibot-node-sdk');
    } catch {
      throw new Error('WeCom adapter requires @wecom/aibot-node-sdk. Install it: npm install @wecom/aibot-node-sdk');
    }

    // Support both default and named exports
    const WSClient = AiBot.WSClient || AiBot.default?.WSClient || AiBot.default;
    if (!WSClient) {
      throw new Error('Invalid @wecom/aibot-node-sdk: WSClient not found');
    }

    const wsOpts: Record<string, unknown> = {
      botId: this.config.botId,
      secret: this.config.secret,
    };
    if (this.config.websocketUrl) wsOpts.url = this.config.websocketUrl;

    this.wsClient = new WSClient(wsOpts);

    this.wsClient.on('message.text', (frame: any) => {
      this.handleFrame(frame, onMessage);
    });

    this.wsClient.on('message.image', (frame: any) => {
      this.handleFrame(frame, onMessage, '(image)');
    });

    await this.wsClient.connect();
    console.log('[wecom] WebSocket connection established');
  }

  private handleFrame(frame: any, onMessage: (msg: ChannelMessage) => void, fallbackText?: string): void {
    const body = frame?.body ?? frame;
    const msgId: string | undefined = body.msgid || body.msgId || body.message_id;
    if (msgId) {
      if (this.seenMsgIds.has(msgId)) return;
      this.seenMsgIds.add(msgId);
      if (this.seenMsgIds.size > WecomAdapter.MAX_SEEN) {
        const entries = [...this.seenMsgIds];
        this.seenMsgIds = new Set(entries.slice(entries.length >> 1));
      }
    }

    const text =
      body.text?.content ||
      body.content?.text ||
      (typeof body.text === 'string' ? body.text : undefined) ||
      fallbackText ||
      '';
    if (!text) return;

    const senderId = body.from?.userid || body.userId || (typeof body.from === 'string' ? body.from : '') || '';
    const chatType = body.chattype || body.chatType || body.chat_type;
    const isGroup = chatType === 'group';
    const chatId = body.chatid || body.chatId || body.conversation_id || (!isGroup ? senderId : '');
    const senderName: string | undefined = body.userName || body.from_name;

    if (isGroup && chatId && senderId && senderName) {
      let members = this.groupMemberCache.get(chatId);
      if (!members) {
        members = new Map();
        this.groupMemberCache.set(chatId, members);
      }
      members.set(senderName, senderId);
      this.groupMemberCacheTime.set(chatId, Date.now());
    }

    const channelMsg: ChannelMessage = {
      channelType: 'wecom',
      senderId,
      senderName,
      chatId,
      chatType: isGroup ? 'group' : 'dm',
      text,
      messageId: msgId,
      mentioned: isGroup ? true : undefined,
      raw: frame,
    };

    onMessage(channelMsg);
  }

  async getGroupMembers(chatId: string): Promise<Map<string, string>> {
    // WeCom Smart Bot does not expose a member list API; return the cache
    // accumulated from incoming group frames in handleFrame.
    const cached = this.groupMemberCache.get(chatId);
    if (!cached) return new Map();
    const ts = this.groupMemberCacheTime.get(chatId) ?? 0;
    if (Date.now() - ts >= WecomAdapter.MEMBER_CACHE_TTL) {
      this.groupMemberCache.delete(chatId);
      this.groupMemberCacheTime.delete(chatId);
      return new Map();
    }
    return cached;
  }

  async reply(msg: ChannelMessage, text: string, options?: ReplyOptions): Promise<void> {
    if (!this.wsClient) return;
    const frame = msg.raw;

    let processedText = text;
    const mentions = options?.mentions;
    if (mentions && mentions.length > 0) {
      for (const m of mentions) {
        processedText = processedText.replace(
          new RegExp(`@${m.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'),
          `<@${m.platformId}>`,
        );
      }
    }

    const state = this.streams.get(msg.chatId);
    if (state) {
      if (state.frame !== frame) {
        // Cross-conversation (group<->dm): silently close old stream, then process new message
        this.wsClient.replyStream(state.frame, state.streamId, '', true).catch(() => {});
        this.streams.delete(msg.chatId);
        // Falls through to no-state branch below to send directly
      } else {
        this.wsClient.replyStream(state.frame, state.streamId, processedText, true).catch(() => {});
        // Immediately open new empty stream (WeCom native loading UI)
        const newStreamId = `reply-${Date.now()}`;
        this.streams.set(msg.chatId, { streamId: newStreamId, frame, timer: null });
        this.wsClient.replyStream(frame, newStreamId, '', false).catch(() => {});
      }
    }
    if (!this.streams.has(msg.chatId)) {
      // No previous stream (slash command etc.), send directly without opening new loading stream
      const streamId = `reply-${Date.now()}`;
      this.wsClient.replyStream(frame, streamId, processedText, true).catch(() => {});
    }
    if (state?.timer) {
      clearTimeout(state.timer);
    }
  }

  async sendStatus(_msg: ChannelMessage, _text: string): Promise<string> {
    // Don't send visible message (WeCom native loading UI is sufficient), only return status ID to maintain gateway lifecycle
    return `silent-${Date.now()}`;
  }

  async clearStatus(_msg: ChannelMessage, _statusId: string): Promise<void> {
    const state = this.streams.get(_msg.chatId);
    if (!state) return;
    if (state.timer) {
      clearTimeout(state.timer);
    }
    if (this.wsClient) {
      this.wsClient.replyStream(state.frame, state.streamId, 'mission complete \u2705', true).catch(() => {});
    }
    this.streams.delete(_msg.chatId);
  }

  async typing(msg: ChannelMessage): Promise<void> {
    if (!this.wsClient) return;
    try {
      await this.wsClient.sendTyping?.(msg.chatId);
    } catch {}
    const state = this.streams.get(msg.chatId);
    if (!state) {
      const streamId = `reply-${Date.now()}`;
      this.streams.set(msg.chatId, { streamId, frame: msg.raw, timer: null });
      this.wsClient.replyStream(msg.raw, streamId, '', false).catch(() => {});
    }
  }

  async send(chatId: string, text: string): Promise<void> {
    if (!this.wsClient) return;
    await this.wsClient.sendMessage(chatId, { msgtype: 'text', text: { content: text } });
  }

  async sendMedia(msg: ChannelMessage, media: OutboundMedia): Promise<void> {
    if (!this.wsClient) return;

    const minSize = 5;
    if (media.data.length < minSize) {
      throw new Error(`Media too small: file is ${media.data.length} bytes, minimum is ${minSize} bytes`);
    }

    const maxSize = media.kind === 'image' ? 10 * 1024 * 1024 : 20 * 1024 * 1024;
    if (media.data.length > maxSize) {
      const kindLabel = media.kind === 'image' ? 'image' : 'file';
      const maxMB = media.kind === 'image' ? 10 : 20;
      throw new Error(
        `Media too large: ${kindLabel} is ${(media.data.length / (1024 * 1024)).toFixed(1)}MB, maximum is ${maxMB}MB`,
      );
    }

    const filename = media.fileName ?? (media.kind === 'image' ? 'image.png' : 'attachment.bin');

    const upload = await this.wsClient.uploadMedia(media.data, {
      type: media.kind,
      filename,
    });

    if (msg.raw) {
      await this.wsClient.replyMedia(msg.raw, media.kind, upload.media_id);
    } else {
      await this.wsClient.sendMediaMessage(msg.chatId, media.kind, upload.media_id);
    }
  }

  async stop(): Promise<void> {
    if (this.wsClient) {
      await this.wsClient.disconnect?.();
      this.wsClient = null;
    }
  }
}
