import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelAdapter, ChannelMessage } from '../channel.js';
import { buildTriagePrompt, fetchMissedMessages, type TriageMessage, WatermarkStore } from '../history-fetcher.js';
import { InboxStore } from '../inbox.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockAdapter(overrides?: Partial<ChannelAdapter>): ChannelAdapter {
  return {
    name: 'mock',
    start: vi.fn(),
    reply: vi.fn(),
    stop: vi.fn(),
    ...overrides,
  };
}

function makeMsg(partial: Partial<ChannelMessage>): ChannelMessage {
  return {
    channelType: 'feishu',
    senderId: 'u1',
    senderName: 'Alice',
    chatId: 'chat1',
    chatType: 'group',
    text: 'hello',
    raw: {},
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildTriagePrompt', () => {
  it('formats messages with system preamble', () => {
    const messages: TriageMessage[] = [
      { ts: '2026-03-11T10:00:00Z', senderName: 'Alice', text: 'Help with PR' },
      { ts: '2026-03-11T10:05:00Z', senderName: 'Bob', text: 'Deploy status?' },
      { ts: '2026-03-11T10:30:00Z', senderName: 'Alice', text: 'Never mind, done' },
    ];

    const prompt = buildTriagePrompt(messages, 'feishu:oc_xxx');

    expect(prompt).toContain('You have been offline');
    expect(prompt).toContain('feishu:oc_xxx');
    expect(prompt).toContain('[2026-03-11T10:00:00Z] Alice: Help with PR');
    expect(prompt).toContain('[2026-03-11T10:05:00Z] Bob: Deploy status?');
    expect(prompt).toContain('[2026-03-11T10:30:00Z] Alice: Never mind, done');
  });

  it('includes instructions for batch reply and skip', () => {
    const prompt = buildTriagePrompt([{ ts: '2026-01-01T00:00:00Z', senderName: 'User', text: 'hi' }], 'slack:C123');
    expect(prompt).toContain('Batch-reply');
    expect(prompt).toContain('Skip or briefly acknowledge');
    expect(prompt).toContain('[SKIP]');
  });
});

describe('WatermarkStore', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'golem-test-watermark-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns undefined for unknown keys', async () => {
    const store = new WatermarkStore(dir);
    await store.load();
    expect(store.get('feishu:xxx')).toBeUndefined();
  });

  it('persists and loads watermarks', async () => {
    const store = new WatermarkStore(dir);
    await store.load();
    const now = new Date('2026-03-11T10:00:00Z');
    store.set('feishu:chat1', now);
    await store.save();

    const store2 = new WatermarkStore(dir);
    await store2.load();
    expect(store2.get('feishu:chat1')?.toISOString()).toBe('2026-03-11T10:00:00.000Z');
  });

  it('handles missing file gracefully', async () => {
    const store = new WatermarkStore(dir);
    await store.load(); // should not throw
    expect(store.get('any')).toBeUndefined();
  });
});

describe('fetchMissedMessages', () => {
  let dir: string;
  let inbox: InboxStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'golem-test-historyfetch-'));
    inbox = new InboxStore(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('fetches history and enqueues triage prompt', async () => {
    const adapter = makeMockAdapter({
      listChats: vi.fn().mockResolvedValue([{ chatId: 'chat1', chatType: 'group' as const }]),
      fetchHistory: vi
        .fn()
        .mockResolvedValue([
          makeMsg({ messageId: 'msg1', text: 'hello', senderName: 'Alice' }),
          makeMsg({ messageId: 'msg2', text: 'world', senderName: 'Bob' }),
        ]),
    });

    const adapters = new Map<string, ChannelAdapter>([['feishu', adapter]]);
    const watermarks = new WatermarkStore(dir);
    await watermarks.load();

    const count = await fetchMissedMessages(
      { dir, adapters, inbox, config: { initialLookbackMinutes: 60 }, verbose: false },
      watermarks,
    );

    expect(count).toBe(1); // 1 chat with new messages

    const pending = await inbox.getPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].source).toBe('history-fetch');
    expect(pending[0].message).toContain('Alice: hello');
    expect(pending[0].message).toContain('Bob: world');
    expect(pending[0].message).toContain('You have been offline');
  });

  it('skips adapters without fetchHistory', async () => {
    const adapter = makeMockAdapter(); // no fetchHistory
    const adapters = new Map<string, ChannelAdapter>([['telegram', adapter]]);
    const watermarks = new WatermarkStore(dir);
    await watermarks.load();

    const count = await fetchMissedMessages({ dir, adapters, inbox, config: {}, verbose: false }, watermarks);

    expect(count).toBe(0);
  });

  it('deduplicates messages already in inbox', async () => {
    // Pre-enqueue a message
    await inbox.enqueue({
      sessionKey: 'feishu:chat1',
      message: 'existing',
      source: 'feishu',
      channelMsg: {
        channelType: 'feishu',
        senderId: 'u1',
        chatId: 'chat1',
        chatType: 'group',
        messageId: 'msg1',
      },
    });

    const adapter = makeMockAdapter({
      listChats: vi.fn().mockResolvedValue([{ chatId: 'chat1', chatType: 'group' as const }]),
      fetchHistory: vi.fn().mockResolvedValue([makeMsg({ messageId: 'msg1', text: 'already seen' })]),
    });

    const adapters = new Map<string, ChannelAdapter>([['feishu', adapter]]);
    const watermarks = new WatermarkStore(dir);
    await watermarks.load();

    const count = await fetchMissedMessages({ dir, adapters, inbox, config: {}, verbose: false }, watermarks);

    expect(count).toBe(0); // all messages deduped

    const pending = await inbox.getPending();
    // Only the pre-enqueued one (from source 'feishu', not 'history-fetch')
    expect(pending).toHaveLength(1);
    expect(pending[0].source).toBe('feishu');
  });

  it('updates watermarks after fetch', async () => {
    const adapter = makeMockAdapter({
      listChats: vi.fn().mockResolvedValue([{ chatId: 'chat1', chatType: 'group' as const }]),
      fetchHistory: vi
        .fn()
        .mockResolvedValue([makeMsg({ messageId: 'msg1', raw: { _fetchedAt: '2026-03-11T12:00:00Z' } })]),
    });

    const adapters = new Map<string, ChannelAdapter>([['feishu', adapter]]);
    const watermarks = new WatermarkStore(dir);
    await watermarks.load();

    await fetchMissedMessages({ dir, adapters, inbox, config: {}, verbose: false }, watermarks);

    // Watermark should be updated to 1ms after the latest message time
    expect(watermarks.get('feishu:chat1')?.toISOString()).toBe('2026-03-11T12:00:00.001Z');

    // Verify persisted to disk
    const raw = await readFile(join(dir, '.golem', 'watermarks.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed['feishu:chat1']).toBe('2026-03-11T12:00:00.001Z');
  });

  it('handles fetchHistory errors gracefully', async () => {
    const adapter = makeMockAdapter({
      listChats: vi.fn().mockResolvedValue([{ chatId: 'chat1', chatType: 'group' as const }]),
      fetchHistory: vi.fn().mockRejectedValue(new Error('API down')),
    });

    const adapters = new Map<string, ChannelAdapter>([['feishu', adapter]]);
    const watermarks = new WatermarkStore(dir);
    await watermarks.load();

    // Should not throw
    const count = await fetchMissedMessages({ dir, adapters, inbox, config: {}, verbose: false }, watermarks);

    expect(count).toBe(0);
  });

  it('handles listChats errors gracefully', async () => {
    const adapter = makeMockAdapter({
      listChats: vi.fn().mockRejectedValue(new Error('Network error')),
      fetchHistory: vi.fn(),
    });

    const adapters = new Map<string, ChannelAdapter>([['feishu', adapter]]);
    const watermarks = new WatermarkStore(dir);
    await watermarks.load();

    const count = await fetchMissedMessages({ dir, adapters, inbox, config: {}, verbose: false }, watermarks);

    expect(count).toBe(0);
  });
});
