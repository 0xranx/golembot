import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildSessionKey, stripMention, type ChannelAdapter, type ChannelMessage } from '../channel.js';
import type { StreamEvent } from '../engine.js';

vi.mock('../engine.js', async (importOriginal) => {
  const original = await importOriginal() as Record<string, unknown>;
  return {
    ...original,
    createEngine: vi.fn(() => ({
      async *invoke(prompt: string): AsyncIterable<StreamEvent> {
        yield { type: 'text', content: `Echo: ${prompt}` };
        yield { type: 'done', sessionId: 'mock-session' };
      },
    })),
  };
});

function createMockAdapter(name: string): ChannelAdapter & {
  _trigger: (msg: ChannelMessage) => void;
  _replies: Array<{ msg: ChannelMessage; text: string }>;
} {
  let handler: ((msg: ChannelMessage) => void) | null = null;
  const replies: Array<{ msg: ChannelMessage; text: string }> = [];

  return {
    name,
    _trigger(msg: ChannelMessage) {
      if (handler) handler(msg);
    },
    _replies: replies,
    async start(onMessage: (msg: ChannelMessage) => void) {
      handler = onMessage;
    },
    async reply(msg: ChannelMessage, text: string) {
      replies.push({ msg, text });
    },
    async stop() {
      handler = null;
    },
  };
}

// ── splitMessage tests ──────────────────────────────

describe('splitMessage', () => {
  // Import dynamically since gateway.ts has side-effect-free exports
  let splitMessage: (text: string, maxLen: number) => string[];

  beforeEach(async () => {
    const mod = await import('../gateway.js');
    splitMessage = mod.splitMessage;
  });

  it('returns single chunk when text fits', () => {
    expect(splitMessage('short text', 100)).toEqual(['short text']);
  });

  it('splits at paragraph boundary', () => {
    const text = 'Part one.\n\nPart two.\n\nPart three.';
    const chunks = splitMessage(text, 20);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every(c => c.length <= 20)).toBe(true);
  });

  it('splits at newline when no paragraph boundary', () => {
    const text = 'Line one\nLine two\nLine three\nLine four';
    const chunks = splitMessage(text, 20);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every(c => c.length <= 20)).toBe(true);
  });

  it('hard-cuts when no natural boundary', () => {
    const text = 'x'.repeat(50);
    const chunks = splitMessage(text, 20);
    expect(chunks.length).toBe(3);
    expect(chunks[0].length).toBe(20);
    expect(chunks[1].length).toBe(20);
    expect(chunks[2].length).toBe(10);
  });

  it('handles empty string', () => {
    expect(splitMessage('', 100)).toEqual(['']);
  });
});

describe('gateway integration', () => {
  // ── Message routing logic ─────────────────────

  describe('message routing', () => {
    it('builds correct session key for DM messages', () => {
      const msg: ChannelMessage = {
        channelType: 'feishu',
        senderId: 'user123',
        chatId: 'user123',
        chatType: 'dm',
        text: 'hello',
        raw: {},
      };
      expect(buildSessionKey(msg)).toBe('feishu:user123:user123');
    });

    it('builds correct session key for group messages', () => {
      const msg: ChannelMessage = {
        channelType: 'dingtalk',
        senderId: 'user456',
        chatId: 'group789',
        chatType: 'group',
        text: '@bot help',
        raw: {},
      };
      expect(buildSessionKey(msg)).toBe('dingtalk:group789:user456');
    });

    it('strips mentions for group messages', () => {
      const groupText = '@GolemBot help me with this';
      const stripped = stripMention(groupText);
      expect(stripped).toBe('help me with this');
    });

    it('preserves text for DM messages (no stripping needed)', () => {
      const dmText = 'help me with this';
      expect(stripMention(dmText)).toBe(dmText);
    });
  });

  // ── Mock adapter message flow ─────────────────

  describe('adapter message flow', () => {
    it('adapter receives messages and can reply', async () => {
      const adapter = createMockAdapter('test');
      const received: ChannelMessage[] = [];

      await adapter.start((msg) => received.push(msg));

      const testMsg: ChannelMessage = {
        channelType: 'test',
        senderId: 'sender1',
        chatId: 'chat1',
        chatType: 'dm',
        text: 'Hello world',
        raw: {},
      };

      adapter._trigger(testMsg);
      expect(received).toHaveLength(1);
      expect(received[0].text).toBe('Hello world');

      await adapter.reply(testMsg, 'Hi there!');
      expect(adapter._replies).toHaveLength(1);
      expect(adapter._replies[0].text).toBe('Hi there!');
    });

    it('adapter stops receiving after stop()', async () => {
      const adapter = createMockAdapter('test');
      const received: ChannelMessage[] = [];

      await adapter.start((msg) => received.push(msg));
      await adapter.stop();

      adapter._trigger({
        channelType: 'test',
        senderId: 's',
        chatId: 'c',
        chatType: 'dm',
        text: 'should not arrive',
        raw: {},
      });

      expect(received).toHaveLength(0);
    });

    it('multiple adapters work independently', async () => {
      const feishu = createMockAdapter('feishu');
      const dingtalk = createMockAdapter('dingtalk');

      const feishuMsgs: ChannelMessage[] = [];
      const dingtalkMsgs: ChannelMessage[] = [];

      await feishu.start((msg) => feishuMsgs.push(msg));
      await dingtalk.start((msg) => dingtalkMsgs.push(msg));

      feishu._trigger({
        channelType: 'feishu',
        senderId: 'u1',
        chatId: 'c1',
        chatType: 'dm',
        text: 'feishu msg',
        raw: {},
      });

      dingtalk._trigger({
        channelType: 'dingtalk',
        senderId: 'u2',
        chatId: 'c2',
        chatType: 'group',
        text: '@bot dingtalk msg',
        raw: {},
      });

      expect(feishuMsgs).toHaveLength(1);
      expect(dingtalkMsgs).toHaveLength(1);
      expect(feishuMsgs[0].text).toBe('feishu msg');
      expect(dingtalkMsgs[0].text).toBe('@bot dingtalk msg');
    });
  });

  // ── Full gateway flow simulation ──────────────

  describe('full gateway flow', () => {
    let dir: string;

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'golem-gw-'));
    });

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it('end-to-end: DM message → assistant.chat → reply', async () => {
      await mkdir(join(dir, 'skills', 'general'), { recursive: true });
      await writeFile(join(dir, 'golem.yaml'), 'name: gw-test\nengine: cursor\n');
      await writeFile(
        join(dir, 'skills', 'general', 'SKILL.md'),
        '---\nname: general\ndescription: General assistant\n---\n',
      );

      const { createAssistant } = await import('../index.js');
      const assistant = createAssistant({ dir });

      const adapter = createMockAdapter('feishu');
      await adapter.start(async (msg) => {
        const sessionKey = buildSessionKey(msg);
        let reply = '';
        for await (const event of assistant.chat(msg.text, { sessionKey })) {
          if (event.type === 'text') reply += event.content;
        }
        if (reply.trim()) {
          await adapter.reply(msg, reply.trim());
        }
      });

      adapter._trigger({
        channelType: 'feishu',
        senderId: 'user1',
        chatId: 'user1',
        chatType: 'dm',
        text: 'Hello',
        raw: {},
      });

      // Wait for async processing
      await new Promise(r => setTimeout(r, 100));

      expect(adapter._replies.length).toBeGreaterThanOrEqual(1);
      expect(adapter._replies[0].text).toContain('Echo: Hello');
    });

    it('end-to-end: group message with mention → strip → chat → reply', async () => {
      await mkdir(join(dir, 'skills', 'general'), { recursive: true });
      await writeFile(join(dir, 'golem.yaml'), 'name: gw-test\nengine: cursor\n');
      await writeFile(
        join(dir, 'skills', 'general', 'SKILL.md'),
        '---\nname: general\ndescription: General assistant\n---\n',
      );

      const { createAssistant } = await import('../index.js');
      const assistant = createAssistant({ dir });

      const adapter = createMockAdapter('dingtalk');
      await adapter.start(async (msg) => {
        const sessionKey = buildSessionKey(msg);
        const userText = msg.chatType === 'group' ? stripMention(msg.text) : msg.text;
        if (!userText) return;

        let reply = '';
        for await (const event of assistant.chat(userText, { sessionKey })) {
          if (event.type === 'text') reply += event.content;
        }
        if (reply.trim()) {
          await adapter.reply(msg, reply.trim());
        }
      });

      adapter._trigger({
        channelType: 'dingtalk',
        senderId: 'user2',
        chatId: 'group1',
        chatType: 'group',
        text: '@GolemBot what is 2+2',
        raw: {},
      });

      await new Promise(r => setTimeout(r, 100));

      expect(adapter._replies.length).toBeGreaterThanOrEqual(1);
      expect(adapter._replies[0].text).toContain('Echo: what is 2+2');
    });

    it('handles empty text after mention stripping gracefully', async () => {
      const adapter = createMockAdapter('feishu');
      await adapter.start(async (msg) => {
        const userText = msg.chatType === 'group' ? stripMention(msg.text) : msg.text;
        if (!userText) return;
        await adapter.reply(msg, 'should not reach');
      });

      adapter._trigger({
        channelType: 'feishu',
        senderId: 'u',
        chatId: 'g',
        chatType: 'group',
        text: '@GolemBot',
        raw: {},
      });

      await new Promise(r => setTimeout(r, 50));
      expect(adapter._replies).toHaveLength(0);
    });
  });

  // ── Session isolation across channels ─────────

  describe('session isolation', () => {
    it('different channels create different session keys', () => {
      const feishuKey = buildSessionKey({
        channelType: 'feishu',
        senderId: 'user1',
        chatId: 'chat1',
        chatType: 'dm',
        text: 'hi',
        raw: {},
      });

      const dingtalkKey = buildSessionKey({
        channelType: 'dingtalk',
        senderId: 'user1',
        chatId: 'chat1',
        chatType: 'dm',
        text: 'hi',
        raw: {},
      });

      expect(feishuKey).not.toBe(dingtalkKey);
    });

    it('same user in different chats gets different sessions', () => {
      const key1 = buildSessionKey({
        channelType: 'feishu',
        senderId: 'user1',
        chatId: 'group-a',
        chatType: 'group',
        text: 'hi',
        raw: {},
      });

      const key2 = buildSessionKey({
        channelType: 'feishu',
        senderId: 'user1',
        chatId: 'group-b',
        chatType: 'group',
        text: 'hi',
        raw: {},
      });

      expect(key1).not.toBe(key2);
    });
  });
});
