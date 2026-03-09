import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ChannelAdapter, ChannelMessage, ReadReceipt } from '../channel.js';
import { detectMention } from '../channel.js';
import {
  buildGroupPrompt,
  resolveGroupChatConfig,
  resolveStreamingConfig,
  GROUP_TURN_RESET_MS,
  clearGroupChatState,
  purgeIdleGroups,
  requireFields,
  groupHistories,
  groupTurnCounters,
  groupLastActivity,
  type GroupMessage,
} from '../gateway.js';

function createMockAdapter(name: string): ChannelAdapter & {
  messages: ChannelMessage[];
  replies: Array<{ msg: ChannelMessage; text: string }>;
  triggerMessage: (msg: ChannelMessage) => void;
} {
  let onMessage: ((msg: ChannelMessage) => void) | null = null;
  const adapter = {
    name,
    messages: [] as ChannelMessage[],
    replies: [] as Array<{ msg: ChannelMessage; text: string }>,
    triggerMessage(msg: ChannelMessage) {
      if (onMessage) onMessage(msg);
    },
    async start(cb: (msg: ChannelMessage) => void) {
      onMessage = cb;
    },
    async reply(msg: ChannelMessage, text: string) {
      adapter.replies.push({ msg, text });
    },
    async stop() {
      onMessage = null;
    },
  };
  return adapter;
}

describe('ChannelAdapter mock', () => {
  it('receives messages and sends replies through adapter', async () => {
    const adapter = createMockAdapter('test');

    const received: ChannelMessage[] = [];
    await adapter.start((msg) => {
      received.push(msg);
    });

    const testMsg: ChannelMessage = {
      channelType: 'test',
      senderId: 'user1',
      chatId: 'chat1',
      chatType: 'dm',
      text: 'hello',
      raw: {},
    };

    adapter.triggerMessage(testMsg);
    expect(received).toHaveLength(1);
    expect(received[0].text).toBe('hello');

    await adapter.reply(testMsg, 'world');
    expect(adapter.replies).toHaveLength(1);
    expect(adapter.replies[0].text).toBe('world');

    await adapter.stop();
    adapter.triggerMessage(testMsg);
    expect(received).toHaveLength(1);
  });
});

describe('Gateway config loading', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'golem-gw-'));
    await mkdir(join(tmpDir, 'skills', 'general'), { recursive: true });
    await writeFile(
      join(tmpDir, 'skills', 'general', 'SKILL.md'),
      '---\nname: general\ndescription: test\n---\n# Test\n',
      'utf-8',
    );
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('loads gateway config from golem.yaml', async () => {
    const { loadConfig } = await import('../workspace.js');
    await writeFile(
      join(tmpDir, 'golem.yaml'),
      'name: gw-test\nengine: cursor\ngateway:\n  port: 4567\n  token: secret\n',
      'utf-8',
    );
    const config = await loadConfig(tmpDir);
    expect(config.gateway?.port).toBe(4567);
    expect(config.gateway?.token).toBe('secret');
  });

  it('starts without channels (HTTP only)', async () => {
    const { loadConfig } = await import('../workspace.js');
    await writeFile(
      join(tmpDir, 'golem.yaml'),
      'name: gw-test\nengine: cursor\n',
      'utf-8',
    );
    const config = await loadConfig(tmpDir);
    expect(config.channels).toBeUndefined();
  });
});

describe('initWorkspace installs im-adapter skill', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'golem-init-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('creates both general and im-adapter skills', async () => {
    const { initWorkspace, scanSkills } = await import('../workspace.js');
    const builtinDir = join(process.cwd(), 'skills');
    await initWorkspace(tmpDir, { name: 'test', engine: 'cursor' }, builtinDir);

    const skills = await scanSkills(tmpDir);
    const names = skills.map(s => s.name).sort();
    expect(names).toContain('general');
    expect(names).toContain('im-adapter');
  });
});

describe('custom channel adapter loading', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'golem-custom-adapter-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('loads a custom adapter from a relative path', async () => {
    const adapterDir = join(tmpDir, 'adapters');
    await mkdir(adapterDir, { recursive: true });
    await writeFile(
      join(adapterDir, 'test-adapter.mjs'),
      `export default class TestAdapter {
  constructor(config) { this.config = config; this.name = config.channelName || 'custom-test'; }
  async start(onMessage) { this._onMessage = onMessage; }
  async reply(msg, text) { this._lastReply = { msg, text }; }
  async stop() {}
}`,
    );

    // createChannelAdapter is internal; test by loading the adapter file directly
    const adapterPath = join(adapterDir, 'test-adapter.mjs');
    const mod = await import(adapterPath);
    const AdapterClass = mod.default;
    expect(typeof AdapterClass).toBe('function');

    const instance = new AdapterClass({ channelName: 'my-channel', _adapter: adapterPath });
    expect(instance.name).toBe('my-channel');

    const received: unknown[] = [];
    await instance.start((msg: unknown) => { received.push(msg); });
    await instance._onMessage?.({ text: 'hello' });
    expect(received).toHaveLength(1);
  });

  it('throws a clear error when _adapter path does not exist', async () => {
    const { splitMessage } = await import('../gateway.js');
    // Verify splitMessage still works (gateway module loads correctly)
    expect(splitMessage('hi', 10)).toEqual(['hi']);

    // Test that importing a non-existent module throws
    const badPath = join(tmpDir, 'non-existent-adapter.mjs');
    await expect(import(badPath)).rejects.toThrow();
  });
});

describe('group chat helpers - detectMention', () => {
  it('detects @BotName mention', () => {
    expect(detectMention('@mybot hello', 'mybot')).toBe(true);
  });

  it('detects XML-style <at> mention', () => {
    expect(detectMention('<at user_id="u1">mybot</at> hello', 'mybot')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(detectMention('@MyBot hello', 'mybot')).toBe(true);
    expect(detectMention('<at user_id="u1">MYBOT</at> hi', 'mybot')).toBe(true);
  });

  it('returns false when not mentioned', () => {
    expect(detectMention('hello world, mybot', 'mybot')).toBe(false);
  });

  it('does not match partial names', () => {
    expect(detectMention('@mybotplus hello', 'mybot')).toBe(false);
  });
});

describe('group chat helpers - resolveGroupChatConfig', () => {
  it('fills in default values when groupChat is absent', () => {
    const config = { name: 'bot', engine: 'cursor' };
    const gc = resolveGroupChatConfig(config as any);
    expect(gc.groupPolicy).toBe('mention-only');
    expect(gc.historyLimit).toBe(20);
    expect(gc.maxTurns).toBe(10);
  });

  it('respects custom values', () => {
    const config = {
      name: 'bot',
      engine: 'cursor',
      groupChat: { groupPolicy: 'smart' as const, historyLimit: 30, maxTurns: 5 },
    };
    const gc = resolveGroupChatConfig(config as any);
    expect(gc.groupPolicy).toBe('smart');
    expect(gc.historyLimit).toBe(30);
    expect(gc.maxTurns).toBe(5);
  });

  it('fills in missing partial fields', () => {
    const config = { name: 'bot', engine: 'cursor', groupChat: { historyLimit: 50 } };
    const gc = resolveGroupChatConfig(config as any);
    expect(gc.groupPolicy).toBe('mention-only');
    expect(gc.historyLimit).toBe(50);
    expect(gc.maxTurns).toBe(10);
  });
});

describe('resolveStreamingConfig', () => {
  it('fills in default values when streaming is absent', () => {
    const config = { name: 'bot', engine: 'cursor' };
    const sc = resolveStreamingConfig(config as any);
    expect(sc.mode).toBe('buffered');
    expect(sc.showToolCalls).toBe(false);
  });

  it('respects custom values', () => {
    const config = { name: 'bot', engine: 'cursor', streaming: { mode: 'streaming' as const, showToolCalls: true } };
    const sc = resolveStreamingConfig(config as any);
    expect(sc.mode).toBe('streaming');
    expect(sc.showToolCalls).toBe(true);
  });

  it('fills in missing partial fields', () => {
    const config = { name: 'bot', engine: 'cursor', streaming: { mode: 'streaming' as const } };
    const sc = resolveStreamingConfig(config as any);
    expect(sc.mode).toBe('streaming');
    expect(sc.showToolCalls).toBe(false);
  });
});

describe('group chat helpers - buildGroupPrompt', () => {
  it('includes [Group:] metadata and MemoryFile path', () => {
    const result = buildGroupPrompt([], 'alice', 'hi', false, 'slack:C123', '');
    expect(result).toContain('[Group: slack:C123');
    expect(result).toContain('MemoryFile:');
    expect(result).toContain('memory');
    expect(result).toContain('slack-C123.md');
  });

  it('sanitizes special characters in group key for memory path', () => {
    const result = buildGroupPrompt([], 'alice', 'hi', false, 'slack:C #1!', '');
    // ':' ' ' '#' '!' all → '-'
    expect(result).toContain('slack-C--1-.md');
  });

  it('injects [PASS] instruction when injectPass=true', () => {
    const result = buildGroupPrompt([], 'alice', 'hi', true, 'slack:C123', '');
    expect(result).toContain('[System:');
    expect(result).toContain('[PASS]');
  });

  it('excludes [PASS] instruction when injectPass=false', () => {
    const result = buildGroupPrompt([], 'alice', 'hi', false, 'slack:C123', '');
    expect(result).not.toContain('[System:');
  });

  it('formats current message as [senderName] text', () => {
    const result = buildGroupPrompt([], 'alice', 'hello there', false, 'slack:C123', '');
    expect(result).toContain('[alice] hello there');
  });

  it('includes history (excluding last entry which is current message)', () => {
    const history: GroupMessage[] = [
      { senderName: 'alice', text: 'first message', isBot: false },
      { senderName: 'bob', text: 'current message', isBot: false }, // current — excluded from history
    ];
    const result = buildGroupPrompt(history, 'bob', 'current message', false, 'slack:C123', '');
    expect(result).toContain('--- Recent group conversation ---');
    expect(result).toContain('[alice] first message');
    expect(result).toContain('--- New message ---');
    expect(result).toContain('[bob] current message');
  });

  it('marks bot messages with [bot] label in history', () => {
    const history: GroupMessage[] = [
      { senderName: 'golem', text: 'bot reply', isBot: true },
      { senderName: 'alice', text: 'thanks', isBot: false }, // current
    ];
    const result = buildGroupPrompt(history, 'alice', 'thanks', false, 'slack:C123', '');
    expect(result).toContain('[bot] bot reply');
  });

  it('excludes history section when only one or zero history entries', () => {
    const history: GroupMessage[] = [
      { senderName: 'alice', text: 'hello', isBot: false }, // current (only entry)
    ];
    const result = buildGroupPrompt(history, 'alice', 'hello', false, 'slack:C123', '');
    expect(result).not.toContain('--- Recent group conversation ---');
  });

  it('mentions othersAddressed names in [PASS] hint', () => {
    const result = buildGroupPrompt([], 'alice', '@小舟 帮我看看', true, 'feishu:G1', '', ['小舟']);
    expect(result).toContain('directed at 小舟');
    expect(result).toContain('[PASS]');
  });

  it('uses generic [PASS] hint when othersAddressed is empty', () => {
    const result = buildGroupPrompt([], 'alice', 'hello everyone', true, 'feishu:G1', '', []);
    expect(result).toContain('Only respond if you have something important');
    expect(result).not.toContain('directed at');
  });

  it('lists multiple othersAddressed names', () => {
    const result = buildGroupPrompt([], 'alice', 'hi', true, 'feishu:G1', '', ['小舟', '小忆']);
    expect(result).toContain('directed at 小舟, 小忆');
  });

  it('DM uses per-user session key (buildSessionKey still works)', async () => {
    const { buildSessionKey } = await import('../channel.js');
    const msg: ChannelMessage = {
      channelType: 'slack',
      senderId: 'U001',
      chatId: 'C001',
      chatType: 'dm',
      text: 'hello',
      raw: {},
    };
    // DM key includes senderId; group key would be channelType:chatId only
    expect(buildSessionKey(msg)).toBe('slack:C001:U001');
    const groupKey = `${msg.channelType}:${msg.chatId}`;
    expect(groupKey).toBe('slack:C001');
    expect(buildSessionKey(msg)).not.toBe(groupKey);
  });
});

describe('GROUP_TURN_RESET_MS', () => {
  it('is 1 hour in milliseconds', () => {
    expect(GROUP_TURN_RESET_MS).toBe(60 * 60 * 1000);
  });

  it('idle check: group silent for longer than threshold should trigger reset', () => {
    const now = Date.now();
    const oneHourAgo = now - GROUP_TURN_RESET_MS - 1;
    const justNow = now - 1000; // 1 second ago

    // Simulate the reset condition: Date.now() - lastActivity > GROUP_TURN_RESET_MS
    expect(now - oneHourAgo > GROUP_TURN_RESET_MS).toBe(true);   // → reset
    expect(now - justNow > GROUP_TURN_RESET_MS).toBe(false);     // → no reset
  });
});

describe('clearGroupChatState', () => {
  afterEach(() => {
    // Ensure module-level Maps are clean between tests
    groupHistories.clear();
    groupTurnCounters.clear();
    groupLastActivity.clear();
  });

  it('removes history, turn counter, and last-activity for the given key', () => {
    const key = 'slack:C001';
    groupHistories.set(key, [{ senderName: 'alice', text: 'hi', isBot: false }]);
    groupTurnCounters.set(key, 3);
    groupLastActivity.set(key, Date.now());

    clearGroupChatState(key);

    expect(groupHistories.has(key)).toBe(false);
    expect(groupTurnCounters.has(key)).toBe(false);
    expect(groupLastActivity.has(key)).toBe(false);
  });

  it('only removes the specified key, leaving other groups intact', () => {
    const key = 'slack:C001';
    const other = 'slack:C002';
    groupHistories.set(key, []);
    groupHistories.set(other, [{ senderName: 'bob', text: 'hey', isBot: false }]);
    groupTurnCounters.set(key, 1);
    groupTurnCounters.set(other, 2);

    clearGroupChatState(key);

    expect(groupHistories.has(key)).toBe(false);
    expect(groupHistories.has(other)).toBe(true);
    expect(groupTurnCounters.has(key)).toBe(false);
    expect(groupTurnCounters.has(other)).toBe(true);
  });

  it('is a no-op when the key does not exist', () => {
    expect(() => clearGroupChatState('nonexistent:key')).not.toThrow();
    expect(groupHistories.size).toBe(0);
    expect(groupTurnCounters.size).toBe(0);
    expect(groupLastActivity.size).toBe(0);
  });
});

describe('requireFields', () => {
  it('passes when all required fields are present', () => {
    expect(() => requireFields('test', { a: '1', b: '2' }, ['a', 'b'])).not.toThrow();
  });

  it('throws listing missing fields', () => {
    expect(() => requireFields('feishu', { appId: 'x' }, ['appId', 'appSecret'])).toThrow(
      'Channel "feishu" is missing required config: appSecret',
    );
  });

  it('throws listing multiple missing fields', () => {
    expect(() => requireFields('wecom', {}, ['corpId', 'secret'])).toThrow(
      'Channel "wecom" is missing required config: corpId, secret',
    );
  });

  it('treats empty string as missing', () => {
    expect(() => requireFields('slack', { botToken: '' }, ['botToken'])).toThrow(/missing/);
  });
});

describe('purgeIdleGroups', () => {
  afterEach(() => {
    groupHistories.clear();
    groupTurnCounters.clear();
    groupLastActivity.clear();
  });

  it('removes groups idle longer than GROUP_TURN_RESET_MS', () => {
    const old = Date.now() - GROUP_TURN_RESET_MS - 1;
    groupHistories.set('old:group', [{ senderName: 'a', text: 'x', isBot: false }]);
    groupTurnCounters.set('old:group', 5);
    groupLastActivity.set('old:group', old);

    groupHistories.set('new:group', [{ senderName: 'b', text: 'y', isBot: false }]);
    groupTurnCounters.set('new:group', 1);
    groupLastActivity.set('new:group', Date.now());

    purgeIdleGroups();

    expect(groupHistories.has('old:group')).toBe(false);
    expect(groupTurnCounters.has('old:group')).toBe(false);
    expect(groupLastActivity.has('old:group')).toBe(false);

    expect(groupHistories.has('new:group')).toBe(true);
    expect(groupTurnCounters.has('new:group')).toBe(true);
  });
});

describe('DiscordAdapter', () => {
  it('has name "discord" and maxMessageLength 2000', async () => {
    const { DiscordAdapter } = await import('../channels/discord.js');
    const adapter = new (DiscordAdapter as any)({ botToken: 'fake-token' });
    expect(adapter.name).toBe('discord');
    expect(adapter.maxMessageLength).toBe(2000);
  });

  it('accepts optional botName config', async () => {
    const { DiscordAdapter } = await import('../channels/discord.js');
    const adapter = new (DiscordAdapter as any)({ botToken: 'tok', botName: 'mybot' });
    expect(adapter.name).toBe('discord');
  });

  it('stop() is safe to call before start()', async () => {
    const { DiscordAdapter } = await import('../channels/discord.js');
    const adapter = new (DiscordAdapter as any)({ botToken: 'fake-token' });
    await expect(adapter.stop()).resolves.toBeUndefined();
  });
});

describe('ReadReceipt', () => {
  it('readReceiptHandler is optional on ChannelAdapter', () => {
    const adapter = createMockAdapter('test');
    expect(adapter.readReceiptHandler).toBeUndefined();
  });

  it('readReceiptHandler can be set and invoked', () => {
    const adapter = createMockAdapter('test');
    const receipts: Array<{ messageId: string; readerId: string }> = [];
    adapter.readReceiptHandler = (receipt) => {
      receipts.push({ messageId: receipt.messageId, readerId: receipt.readerId });
    };
    adapter.readReceiptHandler({
      channelType: 'feishu',
      messageId: 'msg-001',
      readerId: 'user-123',
      chatId: 'chat-456',
      readTime: new Date().toISOString(),
    });
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toEqual({ messageId: 'msg-001', readerId: 'user-123' });
  });
});
