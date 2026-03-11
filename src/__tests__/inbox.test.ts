import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { InboxEntry } from '../inbox.js';
import { InboxStore } from '../inbox.js';

describe('InboxStore', () => {
  let dir: string;
  let store: InboxStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'golem-test-inbox-'));
    store = new InboxStore(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // enqueue
  // -----------------------------------------------------------------------

  describe('enqueue', () => {
    it('creates .golem dir and writes entry to JSONL', async () => {
      const entry = await store.enqueue({
        sessionKey: 'telegram:123:user1',
        message: 'hello',
        source: 'telegram',
        channelMsg: {
          channelType: 'telegram',
          senderId: 'user1',
          chatId: '123',
          chatType: 'dm',
          messageId: 'msg-1',
        },
      });

      expect(entry.id).toHaveLength(8);
      expect(entry.status).toBe('pending');
      expect(entry.ts).toBeTruthy();
      expect(entry.message).toBe('hello');

      const raw = await readFile(join(dir, '.golem', 'inbox.jsonl'), 'utf-8');
      const parsed = JSON.parse(raw.trim());
      expect(parsed.id).toBe(entry.id);
    });

    it('appends multiple entries', async () => {
      await store.enqueue({ sessionKey: 'k1', message: 'one', source: 'test' });
      await store.enqueue({ sessionKey: 'k2', message: 'two', source: 'test' });

      const raw = await readFile(join(dir, '.golem', 'inbox.jsonl'), 'utf-8');
      const lines = raw.trim().split('\n');
      expect(lines).toHaveLength(2);
    });
  });

  // -----------------------------------------------------------------------
  // getPending
  // -----------------------------------------------------------------------

  describe('getPending', () => {
    it('returns empty array when no file exists', async () => {
      expect(await store.getPending()).toEqual([]);
    });

    it('returns only pending entries', async () => {
      await store.enqueue({ sessionKey: 'k1', message: 'one', source: 'test' });
      await store.enqueue({ sessionKey: 'k2', message: 'two', source: 'test' });
      const pending = await store.getPending();
      expect(pending).toHaveLength(2);
      expect(pending[0].message).toBe('one');
    });

    it('recovers processing entries back to pending (crash recovery)', async () => {
      // Manually write a processing entry to simulate crash
      await mkdir(join(dir, '.golem'), { recursive: true });
      const entry: InboxEntry = {
        id: 'abcd1234',
        ts: new Date().toISOString(),
        status: 'processing',
        sessionKey: 'k1',
        message: 'interrupted',
        source: 'test',
      };
      await writeFile(join(dir, '.golem', 'inbox.jsonl'), `${JSON.stringify(entry)}\n`, 'utf-8');

      const pending = await store.getPending();
      expect(pending).toHaveLength(1);
      expect(pending[0].status).toBe('pending');
      expect(pending[0].id).toBe('abcd1234');

      // Verify it was rewritten to disk
      const raw = await readFile(join(dir, '.golem', 'inbox.jsonl'), 'utf-8');
      const parsed = JSON.parse(raw.trim());
      expect(parsed.status).toBe('pending');
    });

    it('skips done/failed entries', async () => {
      await mkdir(join(dir, '.golem'), { recursive: true });
      const entries = [
        {
          id: 'a1',
          ts: '2026-01-01T00:00:00Z',
          status: 'done',
          sessionKey: 'k1',
          message: 'ok',
          source: 'test',
          processedAt: '2026-01-01T00:01:00Z',
        },
        {
          id: 'a2',
          ts: '2026-01-01T00:00:00Z',
          status: 'failed',
          sessionKey: 'k2',
          message: 'err',
          source: 'test',
          processedAt: '2026-01-01T00:01:00Z',
        },
        { id: 'a3', ts: '2026-01-01T00:00:00Z', status: 'pending', sessionKey: 'k3', message: 'wait', source: 'test' },
      ];
      const content = `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`;
      await writeFile(join(dir, '.golem', 'inbox.jsonl'), content, 'utf-8');

      const pending = await store.getPending();
      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe('a3');
    });
  });

  // -----------------------------------------------------------------------
  // updateStatus
  // -----------------------------------------------------------------------

  describe('updateStatus', () => {
    it('updates entry status and sets processedAt for done', async () => {
      const entry = await store.enqueue({ sessionKey: 'k1', message: 'hello', source: 'test' });
      await store.updateStatus(entry.id, 'processing');

      let pending = await store.getPending();
      // processing should be recovered to pending by getPending
      expect(pending).toHaveLength(1);

      await store.updateStatus(entry.id, 'done');
      pending = await store.getPending();
      expect(pending).toHaveLength(0);
    });

    it('stores error message on failure', async () => {
      const entry = await store.enqueue({ sessionKey: 'k1', message: 'hello', source: 'test' });
      await store.updateStatus(entry.id, 'failed', { error: 'timeout' });

      const raw = await readFile(join(dir, '.golem', 'inbox.jsonl'), 'utf-8');
      const parsed = JSON.parse(raw.trim());
      expect(parsed.status).toBe('failed');
      expect(parsed.error).toBe('timeout');
      expect(parsed.processedAt).toBeTruthy();
    });

    it('no-ops for non-existent id', async () => {
      await store.enqueue({ sessionKey: 'k1', message: 'hello', source: 'test' });
      // Should not throw
      await store.updateStatus('nonexistent', 'done');
    });
  });

  // -----------------------------------------------------------------------
  // compact
  // -----------------------------------------------------------------------

  describe('compact', () => {
    it('removes completed entries older than maxAgeDays', async () => {
      await mkdir(join(dir, '.golem'), { recursive: true });
      const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
      const recent = new Date().toISOString();
      const entries = [
        { id: 'a1', ts: old, status: 'done', sessionKey: 'k1', message: 'old', source: 'test', processedAt: old },
        {
          id: 'a2',
          ts: recent,
          status: 'done',
          sessionKey: 'k2',
          message: 'recent',
          source: 'test',
          processedAt: recent,
        },
        { id: 'a3', ts: old, status: 'pending', sessionKey: 'k3', message: 'still pending', source: 'test' },
      ];
      const content = `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`;
      await writeFile(join(dir, '.golem', 'inbox.jsonl'), content, 'utf-8');

      const removed = await store.compact(7);
      expect(removed).toBe(1); // only the old done entry

      const raw = await readFile(join(dir, '.golem', 'inbox.jsonl'), 'utf-8');
      const remaining = raw
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l));
      expect(remaining).toHaveLength(2);
      expect(remaining.map((e: any) => e.id).sort()).toEqual(['a2', 'a3']);
    });

    it('returns 0 when nothing to compact', async () => {
      await store.enqueue({ sessionKey: 'k1', message: 'hello', source: 'test' });
      const removed = await store.compact(7);
      expect(removed).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // has (dedup)
  // -----------------------------------------------------------------------

  describe('has', () => {
    it('returns false for unseen messages', () => {
      expect(store.has('telegram', 'msg-1')).toBe(false);
    });

    it('returns true after enqueue with messageId', async () => {
      await store.enqueue({
        sessionKey: 'k1',
        message: 'hello',
        source: 'telegram',
        channelMsg: {
          channelType: 'telegram',
          senderId: 'u1',
          chatId: 'c1',
          chatType: 'dm',
          messageId: 'msg-1',
        },
      });
      expect(store.has('telegram', 'msg-1')).toBe(true);
      expect(store.has('telegram', 'msg-2')).toBe(false);
    });

    it('dedup uses channelType not source', async () => {
      // source='history-fetch' but channelType='feishu' — has() should use channelType
      await store.enqueue({
        sessionKey: 'k1',
        message: 'triage',
        source: 'history-fetch',
        channelMsg: {
          channelType: 'feishu',
          senderId: 'u1',
          chatId: 'c1',
          chatType: 'group',
          messageId: 'msg-hf-1',
        },
      });
      // Should be findable by channelType, not source
      expect(store.has('feishu', 'msg-hf-1')).toBe(true);
      expect(store.has('history-fetch', 'msg-hf-1')).toBe(false);
    });

    it('populates dedup set from getPending', async () => {
      await mkdir(join(dir, '.golem'), { recursive: true });
      const entry: InboxEntry = {
        id: 'abcd1234',
        ts: new Date().toISOString(),
        status: 'pending',
        sessionKey: 'k1',
        message: 'hello',
        source: 'feishu',
        channelMsg: {
          channelType: 'feishu',
          senderId: 'u1',
          chatId: 'c1',
          chatType: 'dm',
          messageId: 'msg-feishu-1',
        },
      };
      await writeFile(join(dir, '.golem', 'inbox.jsonl'), `${JSON.stringify(entry)}\n`, 'utf-8');

      // New store instance — dedup set is empty
      const store2 = new InboxStore(dir);
      expect(store2.has('feishu', 'msg-feishu-1')).toBe(false);

      // After getPending, dedup set should be populated
      await store2.getPending();
      expect(store2.has('feishu', 'msg-feishu-1')).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Malformed JSONL resilience
  // -----------------------------------------------------------------------

  describe('resilience', () => {
    it('skips malformed lines in JSONL', async () => {
      await mkdir(join(dir, '.golem'), { recursive: true });
      const good = JSON.stringify({
        id: 'a1',
        ts: '2026-01-01T00:00:00Z',
        status: 'pending',
        sessionKey: 'k1',
        message: 'ok',
        source: 'test',
      });
      await writeFile(join(dir, '.golem', 'inbox.jsonl'), `${good}\n{{broken\n`, 'utf-8');

      const pending = await store.getPending();
      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe('a1');
    });
  });
});
