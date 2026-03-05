import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildSessionKey, stripMention, type ChannelAdapter, type ChannelMessage, type ReplyOptions } from '../channel.js';
import type { StreamEvent } from '../engine.js';
import type { GolemConfig } from '../workspace.js';

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

      await adapter.start((msg) => { received.push(msg); });

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

      await adapter.start((msg) => { received.push(msg); });
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

      await feishu.start((msg) => { feishuMsgs.push(msg); });
      await dingtalk.start((msg) => { dingtalkMsgs.push(msg); });

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

// ── handleMessage integration tests ──────────────────────────────────────────
//
// These tests exercise the full gateway message-handling pipeline
// (group policies, session key scoping, history buffer, safety valves, etc.)
// using mock assistant and adapter objects — no real IM credentials required.

// Use plain functions with a callCount counter to avoid vi.fn() ↔ typed-function mismatch.
type MockAssistant = {
  chat(message: string, opts?: { sessionKey?: string }): AsyncIterable<StreamEvent>;
  callCount: number;
  lastSessionKey: string | undefined;
  lastPrompt: string | undefined;
};

function makeMockAssistant(replyText: string): MockAssistant {
  const obj: MockAssistant = {
    callCount: 0,
    lastSessionKey: undefined,
    lastPrompt: undefined,
    async *chat(message: string, opts: { sessionKey?: string } = {}) {
      obj.callCount++;
      obj.lastPrompt = message;
      obj.lastSessionKey = opts.sessionKey;
      yield { type: 'text' as const, content: replyText };
      yield { type: 'done' as const, sessionId: 'mock-sid' };
    },
  };
  return obj;
}

function makeThrowingAssistant(): MockAssistant {
  const obj: MockAssistant = {
    callCount: 0,
    lastSessionKey: undefined,
    lastPrompt: undefined,
    async *chat(message: string, opts: { sessionKey?: string } = {}) {
      obj.callCount++;
      obj.lastPrompt = message;
      obj.lastSessionKey = opts.sessionKey;
      throw new Error('network failure');
      yield { type: 'done' as const, sessionId: 'x' }; // unreachable — keeps TS happy
    },
  };
  return obj;
}

function makeErrorEventAssistant(): MockAssistant {
  const obj: MockAssistant = {
    callCount: 0,
    lastSessionKey: undefined,
    lastPrompt: undefined,
    async *chat(message: string, opts: { sessionKey?: string } = {}) {
      obj.callCount++;
      obj.lastPrompt = message;
      obj.lastSessionKey = opts.sessionKey;
      yield { type: 'error' as const, message: 'engine blew up' };
    },
  };
  return obj;
}

type MockAdapter = {
  replies: Array<{ msg: ChannelMessage; text: string; options?: ReplyOptions }>;
  reply(msg: ChannelMessage, text: string, options?: ReplyOptions): Promise<void>;
  maxMessageLength?: number;
  getGroupMembers?: (chatId: string) => Promise<Map<string, string>>;
};

function makeMockAdapter(maxLen?: number): MockAdapter {
  const obj: MockAdapter = {
    replies: [],
    maxMessageLength: maxLen,
    async reply(msg: ChannelMessage, text: string, options?: ReplyOptions) {
      obj.replies.push({ msg, text, options });
    },
  };
  return obj;
}

function makeConfig(overrides: Partial<GolemConfig> = {}): GolemConfig {
  return { name: 'golem', engine: 'cursor', ...overrides } as GolemConfig;
}

function makeGroupMsg(overrides: Partial<ChannelMessage> = {}): ChannelMessage {
  return {
    channelType: 'slack',
    senderId: 'U001',
    senderName: 'alice',
    chatId: 'C123',
    chatType: 'group',
    text: '@golem hello',
    raw: {},
    ...overrides,
  };
}

function makeDmMsg(overrides: Partial<ChannelMessage> = {}): ChannelMessage {
  return {
    channelType: 'slack',
    senderId: 'U001',
    senderName: 'alice',
    chatId: 'C001',
    chatType: 'dm',
    text: 'hello',
    raw: {},
    ...overrides,
  };
}

describe('handleMessage — full gateway pipeline', () => {
  let dir: string;
  let handleMessage: typeof import('../gateway.js').handleMessage;
  let groupHistories: typeof import('../gateway.js').groupHistories;
  let groupTurnCounters: typeof import('../gateway.js').groupTurnCounters;
  let groupLastActivity: typeof import('../gateway.js').groupLastActivity;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'golem-hm-'));
    const mod = await import('../gateway.js');
    handleMessage = mod.handleMessage;
    groupHistories = mod.groupHistories;
    groupTurnCounters = mod.groupTurnCounters;
    groupLastActivity = mod.groupLastActivity;
    groupHistories.clear();
    groupTurnCounters.clear();
    groupLastActivity.clear();
  });

  afterEach(async () => {
    groupHistories.clear();
    groupTurnCounters.clear();
    groupLastActivity.clear();
    await rm(dir, { recursive: true, force: true });
  });

  // ── Session key scoping ─────────────────────────────────────────────────

  describe('session key scoping', () => {
    it('DM message uses per-user session key (channelType:chatId:senderId)', async () => {
      const assistant = makeMockAssistant('hi');
      const adapter = makeMockAdapter();
      const msg = makeDmMsg();
      await handleMessage(msg, makeConfig(), assistant, adapter, 'slack', false, dir);
      expect(assistant.lastSessionKey).toBe('slack:C001:U001');
    });

    it('group message uses group-scoped session key (channelType:chatId, no senderId)', async () => {
      const assistant = makeMockAssistant('hi');
      const adapter = makeMockAdapter();
      const msg = makeGroupMsg();
      await handleMessage(msg, makeConfig(), assistant, adapter, 'slack', false, dir);
      expect(assistant.lastSessionKey).toBe('slack:C123');
    });

    it('two different users in the same group share a session key', async () => {
      const assistant = makeMockAssistant('hi');
      const adapter = makeMockAdapter();
      const msg1 = makeGroupMsg({ senderId: 'U001', senderName: 'alice' });
      const msg2 = makeGroupMsg({ senderId: 'U002', senderName: 'bob' });
      await handleMessage(msg1, makeConfig(), assistant, adapter, 'slack', false, dir);
      const key1 = assistant.lastSessionKey;
      await handleMessage(msg2, makeConfig(), assistant, adapter, 'slack', false, dir);
      const key2 = assistant.lastSessionKey;
      expect(key1).toBe(key2);
      expect(key1).toBe('slack:C123');
    });
  });

  // ── mention-only policy ─────────────────────────────────────────────────

  describe('groupPolicy: mention-only (default)', () => {
    it('calls assistant.chat when bot is @mentioned', async () => {
      const assistant = makeMockAssistant('pong');
      const adapter = makeMockAdapter();
      const msg = makeGroupMsg({ text: '@golem ping' });
      await handleMessage(msg, makeConfig(), assistant, adapter, 'slack', false, dir);
      expect(assistant.callCount).toBe(1);
      expect(adapter.replies).toHaveLength(1);
      expect(adapter.replies[0].text).toBe('pong');
    });

    it('skips assistant.chat when bot is NOT mentioned', async () => {
      const assistant = makeMockAssistant('should not send');
      const adapter = makeMockAdapter();
      const msg = makeGroupMsg({ text: 'hello everyone' });
      await handleMessage(msg, makeConfig(), assistant, adapter, 'slack', false, dir);
      expect(assistant.callCount).toBe(0);
      expect(adapter.replies).toHaveLength(0);
    });

    it('honours msg.mentioned=true even without @BotName in text (Discord-style)', async () => {
      const assistant = makeMockAssistant('discord reply');
      const adapter = makeMockAdapter();
      // Text already normalized to @golem by Discord adapter, but msg.mentioned also set
      const msg = makeGroupMsg({ text: '@golem hello', mentioned: true });
      await handleMessage(msg, makeConfig(), assistant, adapter, 'discord', false, dir);
      expect(assistant.callCount).toBe(1);
    });

    it('msg.mentioned=true triggers response even when text has no @BotName', async () => {
      const assistant = makeMockAssistant('ok');
      const adapter = makeMockAdapter();
      // Simulate Discord adapter without botName: text still has raw token
      const msg = makeGroupMsg({ text: '<@U123456> help', mentioned: true });
      await handleMessage(msg, makeConfig(), assistant, adapter, 'discord', false, dir);
      expect(assistant.callCount).toBe(1);
    });

    it('still updates history even when message is skipped (not mentioned)', async () => {
      const assistant = makeMockAssistant('x');
      const adapter = makeMockAdapter();
      const msg = makeGroupMsg({ text: 'just chatting' });
      await handleMessage(msg, makeConfig(), assistant, adapter, 'slack', false, dir);
      // history should have the message even though bot didn't reply
      const hist = groupHistories.get('slack:C123');
      expect(hist).toBeDefined();
      expect(hist!.length).toBe(1);
      expect(hist![0].senderName).toBe('alice');
    });
  });

  // ── smart policy ────────────────────────────────────────────────────────

  describe('groupPolicy: smart', () => {
    const config = makeConfig({ groupChat: { groupPolicy: 'smart' } } as any);

    it('calls assistant.chat for all group messages (not just mentions)', async () => {
      const assistant = makeMockAssistant('great point');
      const adapter = makeMockAdapter();
      const msg = makeGroupMsg({ text: 'anyone know how to fix this?' });
      await handleMessage(msg, config, assistant, adapter, 'slack', false, dir);
      expect(assistant.callCount).toBe(1);
    });

    it('injects [PASS] instruction in prompt when NOT mentioned', async () => {
      const assistant = makeMockAssistant('noted');
      const adapter = makeMockAdapter();
      const msg = makeGroupMsg({ text: 'general discussion' });
      await handleMessage(msg, config, assistant, adapter, 'slack', false, dir);
      expect(assistant.lastPrompt).toContain('[PASS]');
    });

    it('does NOT inject [PASS] instruction when @mentioned', async () => {
      const assistant = makeMockAssistant('sure');
      const adapter = makeMockAdapter();
      const msg = makeGroupMsg({ text: '@golem explain this' });
      await handleMessage(msg, config, assistant, adapter, 'slack', false, dir);
      expect(assistant.lastPrompt).not.toContain('[System:');
    });

    it('[PASS] sentinel: adapter.reply is NOT called when agent returns [PASS]', async () => {
      const assistant = makeMockAssistant('[PASS]');
      const adapter = makeMockAdapter();
      const msg = makeGroupMsg({ text: 'just chatting' });
      await handleMessage(msg, config, assistant, adapter, 'slack', false, dir);
      expect(adapter.replies).toHaveLength(0);
    });

    it('[PASS] does not increment turn counter', async () => {
      const assistant = makeMockAssistant('[PASS]');
      const adapter = makeMockAdapter();
      const msg = makeGroupMsg({ text: 'topic shift' });
      await handleMessage(msg, config, assistant, adapter, 'slack', false, dir);
      expect(groupTurnCounters.get('slack:C123') ?? 0).toBe(0);
    });

    it('normal reply increments turn counter', async () => {
      const assistant = makeMockAssistant('good question');
      const adapter = makeMockAdapter();
      const msg = makeGroupMsg({ text: '@golem help' });
      await handleMessage(msg, config, assistant, adapter, 'slack', false, dir);
      expect(groupTurnCounters.get('slack:C123')).toBe(1);
    });
  });

  // ── always policy ───────────────────────────────────────────────────────

  describe('groupPolicy: always', () => {
    const config = makeConfig({ groupChat: { groupPolicy: 'always' } } as any);

    it('replies to every group message regardless of mention', async () => {
      const assistant = makeMockAssistant('hello there');
      const adapter = makeMockAdapter();
      const msg = makeGroupMsg({ text: 'good morning' }); // no @mention
      await handleMessage(msg, config, assistant, adapter, 'slack', false, dir);
      expect(assistant.callCount).toBe(1);
      expect(adapter.replies).toHaveLength(1);
    });
  });

  // ── Bot self-exclusion ──────────────────────────────────────────────────

  describe('bot self-exclusion', () => {
    it('skips messages where senderName matches config.name', async () => {
      const assistant = makeMockAssistant('loop');
      const adapter = makeMockAdapter();
      // The bot itself sent this message (e.g. broadcast adapters echo back)
      const msg = makeGroupMsg({ senderName: 'golem', text: '@golem hi' });
      await handleMessage(msg, makeConfig(), assistant, adapter, 'slack', false, dir);
      expect(assistant.callCount).toBe(0);
    });

    it('does not add bot-self message to history', async () => {
      const assistant = makeMockAssistant('x');
      const adapter = makeMockAdapter();
      const msg = makeGroupMsg({ senderName: 'golem', text: '@golem feedback' });
      await handleMessage(msg, makeConfig(), assistant, adapter, 'slack', false, dir);
      expect(groupHistories.get('slack:C123')).toBeUndefined();
    });
  });

  // ── maxTurns safety valve ───────────────────────────────────────────────

  describe('maxTurns safety valve', () => {
    it('stops processing when turn counter reaches maxTurns', async () => {
      const config = makeConfig({ groupChat: { groupPolicy: 'always', maxTurns: 2 } } as any);
      const assistant = makeMockAssistant('reply');
      const adapter = makeMockAdapter();
      // Pre-fill the turn counter to maxTurns; also set lastActivity so the idle-reset
      // heuristic (which fires when lastActivity === 0) doesn't clear the counter.
      groupTurnCounters.set('slack:C123', 2);
      groupLastActivity.set('slack:C123', Date.now());
      const msg = makeGroupMsg({ text: 'yet another message' });
      await handleMessage(msg, config, assistant, adapter, 'slack', false, dir);
      expect(assistant.callCount).toBe(0);
    });

    it('allows processing when turn counter is below maxTurns', async () => {
      const config = makeConfig({ groupChat: { groupPolicy: 'always', maxTurns: 3 } } as any);
      const assistant = makeMockAssistant('still going');
      const adapter = makeMockAdapter();
      groupTurnCounters.set('slack:C123', 2); // below threshold
      const msg = makeGroupMsg({ text: 'one more' });
      await handleMessage(msg, config, assistant, adapter, 'slack', false, dir);
      expect(assistant.callCount).toBe(1);
    });

    it('resets turn counter after GROUP_TURN_RESET_MS of inactivity', async () => {
      const { GROUP_TURN_RESET_MS } = await import('../gateway.js');
      const config = makeConfig({ groupChat: { groupPolicy: 'always', maxTurns: 1 } } as any);
      const assistant = makeMockAssistant('revived');
      const adapter = makeMockAdapter();
      // Simulate counter at limit and last activity more than 1h ago
      groupTurnCounters.set('slack:C123', 1);
      groupLastActivity.set('slack:C123', Date.now() - GROUP_TURN_RESET_MS - 1);
      const msg = makeGroupMsg({ text: 'wake up' });
      await handleMessage(msg, config, assistant, adapter, 'slack', false, dir);
      // Counter was reset, so assistant.chat should have been called
      expect(assistant.callCount).toBe(1);
    });
  });

  // ── History buffer management ───────────────────────────────────────────

  describe('history buffer', () => {
    it('adds user messages to history', async () => {
      const assistant = makeMockAssistant('ack');
      const adapter = makeMockAdapter();
      const msg = makeGroupMsg({ text: '@golem remember this' });
      await handleMessage(msg, makeConfig(), assistant, adapter, 'slack', false, dir);
      const hist = groupHistories.get('slack:C123')!;
      expect(hist.some(h => h.senderName === 'alice' && !h.isBot)).toBe(true);
    });

    it('adds bot reply to history with isBot=true', async () => {
      const assistant = makeMockAssistant('done!');
      const adapter = makeMockAdapter();
      const msg = makeGroupMsg({ text: '@golem do it' });
      await handleMessage(msg, makeConfig(), assistant, adapter, 'slack', false, dir);
      const hist = groupHistories.get('slack:C123')!;
      expect(hist.some(h => h.isBot && h.text === 'done!')).toBe(true);
    });

    it('respects historyLimit by discarding oldest entries', async () => {
      const config = makeConfig({ groupChat: { historyLimit: 3 } } as any);
      const assistant = makeMockAssistant('ok');
      const adapter = makeMockAdapter();
      // Send 3 messages (each with mention so they process)
      for (let i = 0; i < 3; i++) {
        await handleMessage(
          makeGroupMsg({ text: `@golem msg${i}`, senderId: `U00${i}` }),
          config, assistant, adapter, 'slack', false, dir,
        );
      }
      const hist = groupHistories.get('slack:C123')!;
      expect(hist.length).toBeLessThanOrEqual(3);
    });

    it('injects previous history into prompt for subsequent messages', async () => {
      const assistant = makeMockAssistant('got it');
      const adapter = makeMockAdapter();
      // First message
      await handleMessage(makeGroupMsg({ text: '@golem first' }), makeConfig(), assistant, adapter, 'slack', false, dir);
      // Second message — prompt should contain history section
      await handleMessage(makeGroupMsg({ text: '@golem second' }), makeConfig(), assistant, adapter, 'slack', false, dir);
      expect(assistant.lastPrompt).toContain('--- Recent group conversation ---');
    });
  });

  // ── DM handling ─────────────────────────────────────────────────────────

  describe('DM handling', () => {
    it('DM text includes private conversation context', async () => {
      const assistant = makeMockAssistant('ok');
      const adapter = makeMockAdapter();
      const msg = makeDmMsg({ text: '@golem test' });
      await handleMessage(msg, makeConfig(), assistant, adapter, 'slack', false, dir);
      // DM: text is wrapped with system context (sender name + private chat indicator)
      expect(assistant.lastPrompt).toContain('[System: This is a private 1-on-1 conversation with alice.]');
      expect(assistant.lastPrompt).toContain('@golem test');
    });

    it('DM context uses senderId when senderName is missing', async () => {
      const assistant = makeMockAssistant('ok');
      const adapter = makeMockAdapter();
      const msg = makeDmMsg({ text: 'hello', senderName: undefined });
      await handleMessage(msg, makeConfig(), assistant, adapter, 'slack', false, dir);
      expect(assistant.lastPrompt).toContain('[System: This is a private 1-on-1 conversation with U001.]');
    });

    it('DM does not use group state Maps', async () => {
      const assistant = makeMockAssistant('reply');
      const adapter = makeMockAdapter();
      const msg = makeDmMsg();
      await handleMessage(msg, makeConfig(), assistant, adapter, 'slack', false, dir);
      expect(groupHistories.size).toBe(0);
      expect(groupTurnCounters.size).toBe(0);
    });
  });

  // ── Message splitting ───────────────────────────────────────────────────

  describe('message splitting', () => {
    it('long replies are split and each chunk sent as a separate reply', async () => {
      // 50 chars reply, adapter max = 20 → should split into 3 chunks
      const longReply = 'x'.repeat(50);
      const assistant = makeMockAssistant(longReply);
      const adapter = makeMockAdapter(20); // maxMessageLength = 20
      const msg = makeDmMsg();
      await handleMessage(msg, makeConfig(), assistant, adapter, 'slack', false, dir);
      expect(adapter.replies.length).toBeGreaterThanOrEqual(3);
      for (const r of adapter.replies) {
        expect(r.text.length).toBeLessThanOrEqual(20);
      }
    });

    it('short reply is sent as single chunk', async () => {
      const assistant = makeMockAssistant('short');
      const adapter = makeMockAdapter(100);
      const msg = makeDmMsg();
      await handleMessage(msg, makeConfig(), assistant, adapter, 'slack', false, dir);
      expect(adapter.replies).toHaveLength(1);
    });
  });

  // ── Error handling ──────────────────────────────────────────────────────

  describe('error handling', () => {
    it('engine error event → sends fallback error reply', async () => {
      const assistant = makeErrorEventAssistant();
      const adapter = makeMockAdapter();
      const msg = makeDmMsg();
      await handleMessage(msg, makeConfig(), assistant, adapter, 'slack', false, dir);
      expect(adapter.replies).toHaveLength(1);
      expect(adapter.replies[0].text).toContain('error occurred');
    });

    it('exception in assistant.chat → sends fallback error reply', async () => {
      const assistant = makeThrowingAssistant();
      const adapter = makeMockAdapter();
      const msg = makeDmMsg();
      await handleMessage(msg, makeConfig(), assistant, adapter, 'slack', false, dir);
      expect(adapter.replies).toHaveLength(1);
      expect(adapter.replies[0].text).toContain('error occurred');
    });

    it('empty text after mention stripping → no assistant.chat call', async () => {
      const assistant = makeMockAssistant('should not send');
      const adapter = makeMockAdapter();
      const msg = makeGroupMsg({ text: '@golem' }); // strips to empty string
      await handleMessage(msg, makeConfig(), assistant, adapter, 'slack', false, dir);
      expect(assistant.callCount).toBe(0);
      expect(adapter.replies).toHaveLength(0);
    });
  });

  // ── clearGroupChatState (/reset integration) ────────────────────────────

  describe('clearGroupChatState — /reset integration', () => {
    it('clearing state resets history, turn counter, and last-activity', async () => {
      const { clearGroupChatState } = await import('../gateway.js');
      const key = 'slack:C123';
      groupHistories.set(key, [{ senderName: 'alice', text: 'hi', isBot: false }]);
      groupTurnCounters.set(key, 5);
      groupLastActivity.set(key, Date.now());

      clearGroupChatState(key);

      expect(groupHistories.has(key)).toBe(false);
      expect(groupTurnCounters.has(key)).toBe(false);
      expect(groupLastActivity.has(key)).toBe(false);
    });

    it('after reset, a previously maxTurns-blocked group can reply again', async () => {
      const { clearGroupChatState } = await import('../gateway.js');
      const config = makeConfig({ groupChat: { groupPolicy: 'always', maxTurns: 1 } } as any);
      const assistant = makeMockAssistant('back!');
      const adapter = makeMockAdapter();
      const key = 'slack:C123';

      groupTurnCounters.set(key, 1); // at limit
      groupLastActivity.set(key, Date.now()); // prevent idle-reset heuristic from clearing the counter
      const blockedMsg = makeGroupMsg({ text: 'blocked' });
      await handleMessage(blockedMsg, config, assistant, adapter, 'slack', false, dir);
      expect(assistant.callCount).toBe(0);

      clearGroupChatState(key);

      const unblockedMsg = makeGroupMsg({ text: 'try again' });
      await handleMessage(unblockedMsg, config, assistant, adapter, 'slack', false, dir);
      expect(assistant.callCount).toBe(1);
    });
  });

  // ── parseMentions ───────────────────────────────────────────────────────

  describe('parseMentions', () => {
    let parseMentions: typeof import('../gateway.js').parseMentions;

    beforeEach(async () => {
      const mod = await import('../gateway.js');
      parseMentions = mod.parseMentions;
    });

    it('returns empty mentions when memberCache is empty', () => {
      const result = parseMentions('hello @alice', new Map());
      expect(result.mentions).toEqual([]);
      expect(result.text).toBe('hello @alice');
    });

    it('resolves a single @mention against memberCache', () => {
      const cache = new Map([['alice', 'ou_alice_001']]);
      const result = parseMentions('hello @alice please help', cache);
      expect(result.mentions).toEqual([{ name: 'alice', platformId: 'ou_alice_001' }]);
    });

    it('resolves multiple different @mentions', () => {
      const cache = new Map([
        ['alice', 'ou_alice'],
        ['bob', 'ou_bob'],
      ]);
      const result = parseMentions('@alice and @bob please review', cache);
      expect(result.mentions).toHaveLength(2);
      expect(result.mentions).toContainEqual({ name: 'alice', platformId: 'ou_alice' });
      expect(result.mentions).toContainEqual({ name: 'bob', platformId: 'ou_bob' });
    });

    it('deduplicates repeated @mentions of the same person', () => {
      const cache = new Map([['alice', 'ou_alice']]);
      const result = parseMentions('@alice hey @alice are you there', cache);
      expect(result.mentions).toHaveLength(1);
    });

    it('ignores @mentions not in memberCache', () => {
      const cache = new Map([['alice', 'ou_alice']]);
      const result = parseMentions('@alice and @charlie', cache);
      expect(result.mentions).toHaveLength(1);
      expect(result.mentions[0].name).toBe('alice');
    });

    it('resolves Chinese name @mentions', () => {
      const cache = new Map([['小舟', 'ou_xiaozhou']]);
      const result = parseMentions('好的，@小舟 你来处理', cache);
      expect(result.mentions).toEqual([{ name: '小舟', platformId: 'ou_xiaozhou' }]);
    });

    it('preserves original text unchanged', () => {
      const cache = new Map([['alice', 'ou_alice']]);
      const original = 'hello @alice world';
      const result = parseMentions(original, cache);
      expect(result.text).toBe(original);
    });

    it('returns empty mentions when text has no @ patterns', () => {
      const cache = new Map([['alice', 'ou_alice']]);
      const result = parseMentions('hello world', cache);
      expect(result.mentions).toEqual([]);
    });
  });

  // ── outgoing @mention integration ─────────────────────────────────────

  describe('outgoing @mention in group replies', () => {
    it('calls getGroupMembers and passes resolved mentions to adapter.reply', async () => {
      const assistant = makeMockAssistant('好的，@小舟 你来处理这个任务');
      const adapter = makeMockAdapter();
      adapter.getGroupMembers = async (chatId: string) => {
        return new Map([['小舟', 'ou_xiaozhou_001']]);
      };
      const msg = makeGroupMsg({ text: '@golem assign task' });
      const config = makeConfig({ groupChat: { groupPolicy: 'mention-only' } } as any);
      await handleMessage(msg, config, assistant, adapter, 'slack', false, dir);

      expect(adapter.replies.length).toBeGreaterThanOrEqual(1);
      const lastReply = adapter.replies[adapter.replies.length - 1];
      expect(lastReply.options?.mentions).toBeDefined();
      expect(lastReply.options!.mentions).toContainEqual({
        name: '小舟',
        platformId: 'ou_xiaozhou_001',
      });
    });

    it('does not call getGroupMembers for DM replies', async () => {
      let called = false;
      const assistant = makeMockAssistant('hello @alice');
      const adapter = makeMockAdapter();
      adapter.getGroupMembers = async () => {
        called = true;
        return new Map([['alice', 'ou_alice']]);
      };
      const msg = makeDmMsg({ text: 'hi' });
      await handleMessage(msg, makeConfig(), assistant, adapter, 'slack', false, dir);

      expect(called).toBe(false);
      // DM reply should not have mentions options
      expect(adapter.replies[0].options).toBeUndefined();
    });

    it('passes no mentions when adapter lacks getGroupMembers', async () => {
      const assistant = makeMockAssistant('hey @alice');
      const adapter = makeMockAdapter();
      // no getGroupMembers on adapter
      const msg = makeGroupMsg({ text: '@golem hello' });
      const config = makeConfig({ groupChat: { groupPolicy: 'mention-only' } } as any);
      await handleMessage(msg, config, assistant, adapter, 'slack', false, dir);

      expect(adapter.replies.length).toBeGreaterThanOrEqual(1);
      // Without getGroupMembers, no mentions should be resolved
      expect(adapter.replies[0].options).toBeUndefined();
    });

    it('passes no mentions when reply text has no @patterns matching members', async () => {
      const assistant = makeMockAssistant('sure, I will handle it');
      const adapter = makeMockAdapter();
      adapter.getGroupMembers = async () => new Map([['alice', 'ou_alice']]);
      const msg = makeGroupMsg({ text: '@golem do it' });
      const config = makeConfig({ groupChat: { groupPolicy: 'mention-only' } } as any);
      await handleMessage(msg, config, assistant, adapter, 'slack', false, dir);

      expect(adapter.replies.length).toBeGreaterThanOrEqual(1);
      expect(adapter.replies[0].options).toBeUndefined();
    });

    it('gracefully handles getGroupMembers throwing an error', async () => {
      const assistant = makeMockAssistant('hello @alice');
      const adapter = makeMockAdapter();
      adapter.getGroupMembers = async () => { throw new Error('API error'); };
      const msg = makeGroupMsg({ text: '@golem hi' });
      const config = makeConfig({ groupChat: { groupPolicy: 'mention-only' } } as any);
      await handleMessage(msg, config, assistant, adapter, 'slack', false, dir);

      // Should still reply, just without mentions
      expect(adapter.replies.length).toBeGreaterThanOrEqual(1);
      expect(adapter.replies[0].options).toBeUndefined();
    });
  });
});
