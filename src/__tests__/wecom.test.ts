import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelMessage } from '../channel.js';

// Mock @wecom/aibot-node-sdk
const mockConnect = vi.fn().mockResolvedValue(undefined);
const mockDisconnect = vi.fn().mockResolvedValue(undefined);
const mockReplyStream = vi.fn().mockResolvedValue(undefined);
const mockSendMessage = vi.fn().mockResolvedValue(undefined);
const mockUploadMedia = vi.fn();
const mockReplyMedia = vi.fn().mockResolvedValue(undefined);
const mockSendMediaMessage = vi.fn().mockResolvedValue(undefined);
// biome-ignore lint/complexity/noBannedTypes: mock handler map for test
const handlers = new Map<string, Function>();
const constructorArgs: any[] = [];

class MockWSClient {
  constructor(opts: any) {
    constructorArgs.push(opts);
  }
  connect = mockConnect;
  disconnect = mockDisconnect;
  replyStream = mockReplyStream;
  sendMessage = mockSendMessage;
  uploadMedia = mockUploadMedia;
  replyMedia = mockReplyMedia;
  sendMediaMessage = mockSendMediaMessage;
  // biome-ignore lint/complexity/noBannedTypes: mock
  on(event: string, handler: Function) {
    handlers.set(event, handler);
  }
}

vi.mock('../peer-require.js', () => ({
  importPeer: vi.fn().mockResolvedValue({
    WSClient: MockWSClient,
  }),
}));

// Must import after mock
const { WecomAdapter } = await import('../channels/wecom.js');

describe('WecomAdapter', () => {
  let adapter: InstanceType<typeof WecomAdapter>;
  let onMessage: (msg: ChannelMessage) => void;
  let onMessageMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    handlers.clear();
    constructorArgs.length = 0;
    adapter = new WecomAdapter({ botId: 'bot-123', secret: 'secret-456' });
    onMessageMock = vi.fn();
    onMessage = onMessageMock as unknown as (msg: ChannelMessage) => void;
    await adapter.start(onMessage);
  });

  afterEach(async () => {
    await adapter.stop();
  });

  describe('start', () => {
    it('creates WSClient with correct config', () => {
      expect(constructorArgs).toHaveLength(1);
      expect(constructorArgs[0]).toEqual({
        botId: 'bot-123',
        secret: 'secret-456',
      });
    });

    it('passes websocketUrl when configured', async () => {
      constructorArgs.length = 0;
      handlers.clear();
      const adapter2 = new WecomAdapter({
        botId: 'bot-789',
        secret: 'secret',
        websocketUrl: 'wss://custom.example.com',
      });
      await adapter2.start(() => {});
      expect(constructorArgs).toHaveLength(1);
      expect(constructorArgs[0]).toEqual({
        botId: 'bot-789',
        secret: 'secret',
        url: 'wss://custom.example.com',
      });
      await adapter2.stop();
    });

    it('registers message.text and message.image handlers', () => {
      expect(handlers.has('message.text')).toBe(true);
      expect(handlers.has('message.image')).toBe(true);
    });

    it('calls wsClient.connect()', () => {
      expect(mockConnect).toHaveBeenCalledOnce();
    });
  });

  describe('message handling', () => {
    it('emits channel message on text frame', () => {
      const textHandler = handlers.get('message.text')!;
      textHandler({
        msgId: 'msg-1',
        userId: 'user-1',
        userName: 'Alice',
        chatId: 'chat-1',
        chatType: 'dm',
        content: { text: 'Hello bot' },
      });

      expect(onMessageMock).toHaveBeenCalledOnce();
      const msg: ChannelMessage = onMessageMock.mock.calls[0][0];
      expect(msg.channelType).toBe('wecom');
      expect(msg.senderId).toBe('user-1');
      expect(msg.senderName).toBe('Alice');
      expect(msg.chatId).toBe('chat-1');
      expect(msg.chatType).toBe('dm');
      expect(msg.text).toBe('Hello bot');
      expect(msg.messageId).toBe('msg-1');
    });

    it('deduplicates messages by msgId', () => {
      const textHandler = handlers.get('message.text')!;
      const frame = { msgId: 'dup-1', userId: 'u', chatId: 'c', content: { text: 'hi' } };

      textHandler(frame);
      textHandler(frame);

      expect(onMessageMock).toHaveBeenCalledOnce();
    });

    it('handles group messages', () => {
      const textHandler = handlers.get('message.text')!;
      textHandler({
        msgId: 'msg-g1',
        userId: 'user-2',
        chatId: 'group-1',
        chatType: 'group',
        content: { text: 'Group msg' },
        mentioned: true,
      });

      const msg: ChannelMessage = onMessageMock.mock.calls[0][0];
      expect(msg.chatType).toBe('group');
      expect(msg.mentioned).toBe(true);
    });

    it('handles image frame with fallback text', () => {
      const imageHandler = handlers.get('message.image')!;
      imageHandler({
        msgId: 'img-1',
        userId: 'user-3',
        chatId: 'chat-2',
      });

      const msg: ChannelMessage = onMessageMock.mock.calls[0][0];
      expect(msg.text).toBe('(image)');
    });

    it('parses SDK callback fields from frame.body and keeps raw frame', () => {
      const textHandler = handlers.get('message.text')!;
      const frame = {
        event: 'message.text',
        body: {
          msgid: 'body-msg-1',
          from: { userid: 'user-body-1' },
          from_name: 'Body User',
          chattype: 'group',
          chatid: 'group-body-1',
          text: { content: 'Hello from body' },
          mentioned: true,
        },
      };

      textHandler(frame);

      expect(onMessageMock).toHaveBeenCalledOnce();
      const msg: ChannelMessage = onMessageMock.mock.calls[0][0];
      expect(msg.senderId).toBe('user-body-1');
      expect(msg.senderName).toBe('Body User');
      expect(msg.chatId).toBe('group-body-1');
      expect(msg.chatType).toBe('group');
      expect(msg.text).toBe('Hello from body');
      expect(msg.messageId).toBe('body-msg-1');
      expect(msg.mentioned).toBe(true);
      expect(msg.raw).toBe(frame);
    });

    it('falls back to senderId as chatId for single-chat SDK callbacks', () => {
      const textHandler = handlers.get('message.text')!;
      textHandler({
        body: {
          msgId: 'body-msg-2',
          userId: 'user-body-2',
          chatType: 'single',
          content: { text: 'DM via body' },
        },
      });

      expect(onMessageMock).toHaveBeenCalledOnce();
      const msg: ChannelMessage = onMessageMock.mock.calls[0][0];
      expect(msg.senderId).toBe('user-body-2');
      expect(msg.chatId).toBe('user-body-2');
      expect(msg.chatType).toBe('dm');
      expect(msg.text).toBe('DM via body');
      expect(msg.messageId).toBe('body-msg-2');
    });
  });

  describe('reply', () => {
    const msg: ChannelMessage = {
      channelType: 'wecom',
      senderId: 'u1',
      chatId: 'c1',
      chatType: 'dm',
      text: 'hi',
      raw: { frameData: 'original' },
    };

    it('without prior stream: sends text directly, no loading stream', async () => {
      // no active stream (no typing before) → sends text directly
      await adapter.reply(msg, 'Reply text');

      expect(mockReplyStream).toHaveBeenCalledTimes(1);
      const [frame, _s, text, isFinal] = mockReplyStream.mock.calls[0];
      expect(frame).toEqual({ frameData: 'original' });
      expect(text).toBe('Reply text');
      expect(isFinal).toBe(true);
    });
    it('replaces @Name with <@userid> in sent text', async () => {
      await adapter.reply(msg, 'Thanks @Alice and @Bob!', {
        mentions: [
          { name: 'Alice', platformId: 'userid-alice' },
          { name: 'Bob', platformId: 'userid-bob' },
        ],
      });

      const [, , text] = mockReplyStream.mock.calls[0];
      expect(text).toBe('Thanks <@userid-alice> and <@userid-bob>!');
    });

    it('escapes regex special characters in mention names', async () => {
      await adapter.reply(msg, 'Hello @Dr.A+Smith', {
        mentions: [{ name: 'Dr.A+Smith', platformId: 'userid-dr' }],
      });

      const [, , text] = mockReplyStream.mock.calls[0];
      expect(text).toBe('Hello <@userid-dr>');
    });

    it('each reply closes old thinking and starts new one', async () => {
      // Set up an active thinking stream first (simulate typing)
      await adapter.typing(msg);
      mockReplyStream.mockClear();

      await adapter.reply(msg, 'Part 1');
      // call 0: close typing stream with 'Part 1' (finish=true)
      // call 1: start new thinking stream (finish=false)
      expect(mockReplyStream).toHaveBeenCalledTimes(2);
      const [, , text0, isFinal0] = mockReplyStream.mock.calls[0];
      const [, , text1, isFinal1] = mockReplyStream.mock.calls[1];
      expect(text0).toBe('Part 1');
      expect(isFinal0).toBe(true);
      expect(text1).toBe('');
      expect(isFinal1).toBe(false);

      mockReplyStream.mockClear();
      await adapter.reply(msg, 'Part 2');
      expect(mockReplyStream).toHaveBeenCalledTimes(2);
      const [, , text2, isFinal2] = mockReplyStream.mock.calls[0];
      expect(text2).toBe('Part 2');
      expect(isFinal2).toBe(true);
    });

    it('ignores empty mentions array', async () => {
      await adapter.reply(msg, 'Plain reply', { mentions: [] });

      const [, , text, isFinal] = mockReplyStream.mock.calls[0];
      expect(text).toBe('Plain reply');
      expect(isFinal).toBe(true);
    });

    it('silently closes old stream when frame differs (cross-session)', async () => {
      const msgA: ChannelMessage = { ...msg, raw: { frameData: 'sessionA' } };
      const msgB: ChannelMessage = { ...msg, raw: { frameData: 'sessionB' } };

      await adapter.typing(msgA); // opens stream on frameA
      mockReplyStream.mockClear();

      // reply from different session should close old stream silently, then open new
      await adapter.reply(msgB, 'Msg from B');

      expect(mockReplyStream).toHaveBeenCalledTimes(2);
      // call 0: close old stream silently with empty text
      const [f0, , text0, isFinal0] = mockReplyStream.mock.calls[0];
      expect(f0).toEqual({ frameData: 'sessionA' });
      expect(text0).toBe('');
      expect(isFinal0).toBe(true);
      // call 1: new stream sends text directly (no prior stream for sessionB)
      const [f1, , text1, isFinal1] = mockReplyStream.mock.calls[1];
      expect(f1).toEqual({ frameData: 'sessionB' });
      expect(text1).toBe('Msg from B');
      expect(isFinal1).toBe(true);
    });
  });

  describe('clearStatus', () => {
    const msg: ChannelMessage = {
      channelType: 'wecom',
      senderId: 'u1',
      chatId: 'c1',
      chatType: 'dm',
      text: 'hi',
      raw: { frameData: 'original' },
    };

    it('closes stream with mission complete\u2705 (no image msgItem)', async () => {
      await adapter.typing(msg); // opens loading stream
      mockReplyStream.mockClear();

      await adapter.clearStatus(msg, 'status-1');

      expect(mockReplyStream).toHaveBeenCalledTimes(1);
      const callArgs = mockReplyStream.mock.calls[0];
      expect(callArgs[0]).toEqual({ frameData: 'original' });
      expect(callArgs[2]).toBe('mission complete \u2705');
      expect(callArgs[3]).toBe(true);
      expect(callArgs[4]).toBeUndefined();
    });
  });

  describe('per-chatId stream isolation', () => {
    it('typing creates independent streams for different chatIds', async () => {
      const msgA: ChannelMessage = {
        channelType: 'wecom',
        senderId: 'uA',
        chatId: 'chat-A',
        chatType: 'dm',
        text: 'hi',
        raw: { frameData: 'A' },
      };
      const msgB: ChannelMessage = {
        channelType: 'wecom',
        senderId: 'uB',
        chatId: 'chat-B',
        chatType: 'dm',
        text: 'hi',
        raw: { frameData: 'B' },
      };

      await adapter.typing(msgA);
      await adapter.typing(msgB);

      expect(mockReplyStream).toHaveBeenCalledTimes(2);
      const [frameA, streamIdA] = mockReplyStream.mock.calls[0];
      const [frameB, streamIdB] = mockReplyStream.mock.calls[1];
      expect(frameA).toEqual({ frameData: 'A' });
      expect(frameB).toEqual({ frameData: 'B' });
      expect(streamIdA).toMatch(/^reply-\d+$/);
      expect(streamIdB).toMatch(/^reply-\d+$/);
    });

    it('clearStatus only closes the stream for its own chatId', async () => {
      const msgA: ChannelMessage = {
        channelType: 'wecom',
        senderId: 'uA',
        chatId: 'chat-A',
        chatType: 'dm',
        text: 'hi',
        raw: { frameData: 'A' },
      };
      const msgB: ChannelMessage = {
        channelType: 'wecom',
        senderId: 'uB',
        chatId: 'chat-B',
        chatType: 'dm',
        text: 'hi',
        raw: { frameData: 'B' },
      };

      await adapter.typing(msgA);
      await adapter.typing(msgB);
      mockReplyStream.mockClear();

      await adapter.clearStatus(msgA, 'status-A');

      // Should only close A's stream, not B's
      expect(mockReplyStream).toHaveBeenCalledTimes(1);
      const [closedFrame] = mockReplyStream.mock.calls[0];
      expect(closedFrame).toEqual({ frameData: 'A' });
    });

    it('reply in one chatId does not close another chatId stream', async () => {
      const msgA: ChannelMessage = {
        channelType: 'wecom',
        senderId: 'uA',
        chatId: 'chat-A',
        chatType: 'dm',
        text: 'hi',
        raw: { frameData: 'A' },
      };
      const msgB: ChannelMessage = {
        channelType: 'wecom',
        senderId: 'uB',
        chatId: 'chat-B',
        chatType: 'dm',
        text: 'hi',
        raw: { frameData: 'B' },
      };

      await adapter.typing(msgA);
      mockReplyStream.mockClear();

      await adapter.reply(msgB, 'Reply from B');

      // Should send B's reply directly (no stream for B to close)
      // Should NOT touch A's stream
      expect(mockReplyStream).toHaveBeenCalledTimes(1);
      const [frame, , text] = mockReplyStream.mock.calls[0];
      expect(frame).toEqual({ frameData: 'B' });
      expect(text).toBe('Reply from B');
    });
  });

  describe('getGroupMembers', () => {
    it('returns empty map for unknown chat', async () => {
      const members = await adapter.getGroupMembers('no-such-chat');
      expect(members.size).toBe(0);
    });

    it('accumulates name→userid mapping from group frames', async () => {
      const textHandler = handlers.get('message.text')!;
      textHandler({
        msgId: 'gm-1',
        userId: 'userid-alice',
        userName: 'Alice',
        chatId: 'group-1',
        chatType: 'group',
        content: { text: 'hello' },
      });
      textHandler({
        body: {
          msgid: 'gm-2',
          from: { userid: 'userid-bob' },
          from_name: 'Bob',
          chattype: 'group',
          chatid: 'group-1',
          text: { content: 'hi all' },
        },
      });

      const members = await adapter.getGroupMembers('group-1');
      expect(members.get('Alice')).toBe('userid-alice');
      expect(members.get('Bob')).toBe('userid-bob');
      expect(members.size).toBe(2);
    });

    it('does not cache senders from DM frames', async () => {
      const textHandler = handlers.get('message.text')!;
      textHandler({
        msgId: 'dm-1',
        userId: 'userid-carol',
        userName: 'Carol',
        chatId: 'dm-chat',
        chatType: 'dm',
        content: { text: 'hi' },
      });

      const members = await adapter.getGroupMembers('dm-chat');
      expect(members.size).toBe(0);
    });

    it('expires member cache after TTL', async () => {
      vi.useFakeTimers();
      try {
        const textHandler = handlers.get('message.text')!;
        textHandler({
          msgId: 'gm-ttl',
          userId: 'userid-dave',
          userName: 'Dave',
          chatId: 'group-ttl',
          chatType: 'group',
          content: { text: 'hello' },
        });

        expect((await adapter.getGroupMembers('group-ttl')).get('Dave')).toBe('userid-dave');

        vi.setSystemTime(Date.now() + 11 * 60 * 1000);
        expect((await adapter.getGroupMembers('group-ttl')).size).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('typing', () => {
    const msg: ChannelMessage = {
      channelType: 'wecom',
      senderId: 'u1',
      chatId: 'chat-1',
      chatType: 'dm',
      text: 'hi',
      raw: {},
    };

    it('calls wsClient.sendTyping when supported', async () => {
      const mockSendTyping = vi.fn().mockResolvedValue(undefined);
      (adapter as any).wsClient.sendTyping = mockSendTyping;

      await adapter.typing(msg);

      expect(mockSendTyping).toHaveBeenCalledWith('chat-1');
    });

    it('no-ops when SDK does not support typing', async () => {
      await expect(adapter.typing(msg)).resolves.toBeUndefined();
    });

    it('swallows errors from sendTyping', async () => {
      (adapter as any).wsClient.sendTyping = vi.fn().mockRejectedValue(new Error('not supported'));

      await expect(adapter.typing(msg)).resolves.toBeUndefined();
    });
  });

  describe('send', () => {
    it('calls wsClient.sendMessage with correct params', async () => {
      await adapter.send('chat-target', 'Proactive message');

      expect(mockSendMessage).toHaveBeenCalledOnce();
      expect(mockSendMessage).toHaveBeenCalledWith('chat-target', {
        msgtype: 'text',
        text: { content: 'Proactive message' },
      });
    });
  });

  describe('sendMedia', () => {
    const msg: ChannelMessage = {
      channelType: 'wecom',
      senderId: 'u1',
      chatId: 'chat-1',
      chatType: 'dm',
      text: 'hi',
      raw: { frameData: 'incoming-frame' },
    };

    const smallImage = Buffer.alloc(100);
    const smallFile = Buffer.alloc(200);

    beforeEach(() => {
      mockUploadMedia.mockReset();
      mockReplyMedia.mockReset();
      mockSendMediaMessage.mockReset();
    });

    it('sendMedia image: uploads with correct Buffer + metadata and calls replyMedia (all formats)', async () => {
      mockUploadMedia.mockResolvedValue({
        type: 'image',
        media_id: 'media-img-1',
        created_at: '2025-01-01T00:00:00Z',
      });

      const pngImage = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01, 0x02, 0x03, 0x04, 0x05]);

      await adapter.sendMedia(msg, { kind: 'image', data: pngImage, fileName: 'chart.png' });

      expect(mockUploadMedia).toHaveBeenCalledOnce();
      expect(mockUploadMedia).toHaveBeenCalledWith(pngImage, { type: 'image', filename: 'chart.png' });
      expect(mockReplyMedia).toHaveBeenCalledOnce();
      expect(mockReplyMedia).toHaveBeenCalledWith({ frameData: 'incoming-frame' }, 'image', 'media-img-1');
      expect(mockSendMediaMessage).not.toHaveBeenCalled();
    });

    it('sendMedia JPEG image: goes through uploadMedia + replyMedia (no inline path)', async () => {
      mockUploadMedia.mockResolvedValue({
        type: 'image',
        media_id: 'media-jpg-1',
        created_at: '2025-01-01T00:00:00Z',
      });

      const jpgImage = Buffer.from([0xff, 0xd8, 0xff, 0x01, 0x02]);

      await adapter.sendMedia(msg, { kind: 'image', data: jpgImage, fileName: 'photo.jpg' });

      expect(mockUploadMedia).toHaveBeenCalledOnce();
      expect(mockUploadMedia).toHaveBeenCalledWith(jpgImage, { type: 'image', filename: 'photo.jpg' });
      expect(mockReplyMedia).toHaveBeenCalledOnce();
      expect(mockReplyMedia).toHaveBeenCalledWith({ frameData: 'incoming-frame' }, 'image', 'media-jpg-1');
      expect(mockSendMediaMessage).not.toHaveBeenCalled();
    });

    it('sendMedia file: uploads with correct Buffer + metadata and calls replyMedia', async () => {
      mockUploadMedia.mockResolvedValue({
        type: 'file',
        media_id: 'media-file-1',
        created_at: '2025-01-01T00:00:00Z',
      });

      await adapter.sendMedia(msg, { kind: 'file', data: smallFile, fileName: 'doc.pdf' });

      expect(mockUploadMedia).toHaveBeenCalledOnce();
      expect(mockUploadMedia).toHaveBeenCalledWith(smallFile, { type: 'file', filename: 'doc.pdf' });
      expect(mockReplyMedia).toHaveBeenCalledOnce();
      expect(mockReplyMedia).toHaveBeenCalledWith({ frameData: 'incoming-frame' }, 'file', 'media-file-1');
      expect(mockSendMediaMessage).not.toHaveBeenCalled();
    });

    it('sendMedia image without fileName defaults to image.png', async () => {
      mockUploadMedia.mockResolvedValue({
        type: 'image',
        media_id: 'media-default-img',
        created_at: '2025-01-01T00:00:00Z',
      });

      await adapter.sendMedia(msg, { kind: 'image', data: smallImage });

      expect(mockUploadMedia).toHaveBeenCalledWith(smallImage, { type: 'image', filename: 'image.png' });
    });

    it('sendMedia file without fileName defaults to attachment.bin', async () => {
      mockUploadMedia.mockResolvedValue({
        type: 'file',
        media_id: 'media-default-file',
        created_at: '2025-01-01T00:00:00Z',
      });

      await adapter.sendMedia(msg, { kind: 'file', data: smallFile });

      expect(mockUploadMedia).toHaveBeenCalledWith(smallFile, { type: 'file', filename: 'attachment.bin' });
    });

    it('sendMedia image < 5 bytes throws', async () => {
      const tiny = Buffer.from([0x89, 0x50, 0x4e]); // 3 bytes (below 5-byte minimum)

      await expect(adapter.sendMedia(msg, { kind: 'image', data: tiny })).rejects.toThrow(
        /too small.*3 bytes.*minimum is 5/i,
      );
      expect(mockUploadMedia).not.toHaveBeenCalled();
    });

    it('sendMedia file < 5 bytes throws', async () => {
      const tiny = Buffer.from([0x01, 0x02, 0x03]); // 3 bytes

      await expect(adapter.sendMedia(msg, { kind: 'file', data: tiny })).rejects.toThrow(
        /too small.*3 bytes.*minimum is 5/i,
      );
      expect(mockUploadMedia).not.toHaveBeenCalled();
    });

    it('oversized image (>10MB) rejects, uploadMedia NOT called', async () => {
      const oversized = Buffer.alloc(10 * 1024 * 1024 + 1);

      await expect(adapter.sendMedia(msg, { kind: 'image', data: oversized })).rejects.toThrow(
        /too large.*image.*10\.0MB.*maximum is 10MB/i,
      );
      expect(mockUploadMedia).not.toHaveBeenCalled();
    });

    it('oversized file (>20MB) rejects, uploadMedia NOT called', async () => {
      const oversized = Buffer.alloc(20 * 1024 * 1024 + 1);

      await expect(adapter.sendMedia(msg, { kind: 'file', data: oversized })).rejects.toThrow(
        /too large.*file.*20\.0MB.*maximum is 20MB/i,
      );
      expect(mockUploadMedia).not.toHaveBeenCalled();
    });

    it('msg.raw undefined → falls back to sendMediaMessage', async () => {
      mockUploadMedia.mockResolvedValue({
        type: 'image',
        media_id: 'media-fallback',
        created_at: '2025-01-01T00:00:00Z',
      });

      const noRawMsg: ChannelMessage = {
        channelType: 'wecom',
        senderId: 'u1',
        chatId: 'chat-proactive',
        chatType: 'dm',
        text: 'hi',
        raw: undefined,
      };

      await adapter.sendMedia(noRawMsg, { kind: 'image', data: smallImage });

      expect(mockUploadMedia).toHaveBeenCalledOnce();
      expect(mockReplyMedia).not.toHaveBeenCalled();
      expect(mockSendMediaMessage).toHaveBeenCalledOnce();
      expect(mockSendMediaMessage).toHaveBeenCalledWith('chat-proactive', 'image', 'media-fallback');
    });

    it('wsClient null → resolves silently', async () => {
      await adapter.stop(); // sets wsClient to null

      await expect(adapter.sendMedia(msg, { kind: 'image', data: smallImage })).resolves.toBeUndefined();
      expect(mockUploadMedia).not.toHaveBeenCalled();
    });
  });

  describe('stop', () => {
    it('calls wsClient.disconnect()', async () => {
      await adapter.stop();
      expect(mockDisconnect).toHaveBeenCalledOnce();
    });
  });
});
