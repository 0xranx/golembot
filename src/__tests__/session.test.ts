import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  appendHistory,
  clearSession,
  countSessions,
  getHistoryPath,
  listHistoryFiles,
  loadSession,
  pruneExpiredSessions,
  readHistory,
  saveSession,
} from '../session.js';

describe('session', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'golem-test-session-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe('loadSession (default key)', () => {
    it('returns undefined when no session file exists', async () => {
      expect(await loadSession(dir)).toBeUndefined();
    });

    it('returns undefined when session file is empty JSON', async () => {
      await mkdir(join(dir, '.golem'), { recursive: true });
      await writeFile(join(dir, '.golem', 'sessions.json'), '{}\n', 'utf-8');
      expect(await loadSession(dir)).toBeUndefined();
    });

    it('returns session ID after save', async () => {
      await saveSession(dir, 'abc-123');
      expect(await loadSession(dir)).toBe('abc-123');
    });

    it('returns undefined when file is corrupted', async () => {
      await mkdir(join(dir, '.golem'), { recursive: true });
      await writeFile(join(dir, '.golem', 'sessions.json'), '{{broken', 'utf-8');
      expect(await loadSession(dir)).toBeUndefined();
    });
  });

  describe('Phase 1 format migration', () => {
    it('reads old-style { engineSessionId } as default key', async () => {
      await mkdir(join(dir, '.golem'), { recursive: true });
      await writeFile(
        join(dir, '.golem', 'sessions.json'),
        `${JSON.stringify({ engineSessionId: 'old-sess' })}\n`,
        'utf-8',
      );
      expect(await loadSession(dir)).toBe('old-sess');
      expect(await loadSession(dir, 'default')).toBe('old-sess');
    });

    it('treats empty engineSessionId as no session', async () => {
      await mkdir(join(dir, '.golem'), { recursive: true });
      await writeFile(join(dir, '.golem', 'sessions.json'), `${JSON.stringify({ engineSessionId: '' })}\n`, 'utf-8');
      expect(await loadSession(dir)).toBeUndefined();
    });
  });

  describe('multi-key (sessionKey)', () => {
    it('different keys have independent sessions', async () => {
      await saveSession(dir, 'sess-alice', 'user:alice');
      await saveSession(dir, 'sess-bob', 'user:bob');

      expect(await loadSession(dir, 'user:alice')).toBe('sess-alice');
      expect(await loadSession(dir, 'user:bob')).toBe('sess-bob');
      expect(await loadSession(dir)).toBeUndefined(); // default not set
    });

    it('clearing one key does not affect others', async () => {
      await saveSession(dir, 'sess-a', 'a');
      await saveSession(dir, 'sess-b', 'b');

      await clearSession(dir, 'a');
      expect(await loadSession(dir, 'a')).toBeUndefined();
      expect(await loadSession(dir, 'b')).toBe('sess-b');
    });

    it('overwrites session for same key', async () => {
      await saveSession(dir, 'old', 'k');
      await saveSession(dir, 'new', 'k');
      expect(await loadSession(dir, 'k')).toBe('new');
    });

    it('supports many concurrent keys', async () => {
      for (let i = 0; i < 20; i++) {
        await saveSession(dir, `sess-${i}`, `key-${i}`);
      }
      for (let i = 0; i < 20; i++) {
        expect(await loadSession(dir, `key-${i}`)).toBe(`sess-${i}`);
      }
    });

    it('default key coexists with named keys', async () => {
      await saveSession(dir, 'default-sess');
      await saveSession(dir, 'named-sess', 'named');

      expect(await loadSession(dir)).toBe('default-sess');
      expect(await loadSession(dir, 'named')).toBe('named-sess');

      await clearSession(dir);
      expect(await loadSession(dir)).toBeUndefined();
      expect(await loadSession(dir, 'named')).toBe('named-sess');
    });
  });

  describe('lastUsed timestamp', () => {
    it('saveSession records lastUsed', async () => {
      const before = Date.now();
      await saveSession(dir, 'ts-sess');
      const after = Date.now();

      const raw = JSON.parse(await readFile(join(dir, '.golem', 'sessions.json'), 'utf-8'));
      const entry = raw.default;
      expect(entry.lastUsed).toBeGreaterThanOrEqual(before);
      expect(entry.lastUsed).toBeLessThanOrEqual(after);
    });
  });

  describe('pruneExpiredSessions', () => {
    it('removes sessions older than maxAgeDays', async () => {
      const longAgo = Date.now() - 31 * 24 * 60 * 60 * 1000; // 31 days ago
      const store = {
        old: { engineSessionId: 'old-sess', lastUsed: longAgo },
        fresh: { engineSessionId: 'fresh-sess', lastUsed: Date.now() },
      };
      await mkdir(join(dir, '.golem'), { recursive: true });
      await writeFile(join(dir, '.golem', 'sessions.json'), `${JSON.stringify(store)}\n`);

      await pruneExpiredSessions(dir, 30);

      expect(await loadSession(dir, 'old')).toBeUndefined();
      expect(await loadSession(dir, 'fresh')).toBe('fresh-sess');
    });

    it('keeps sessions without lastUsed (legacy)', async () => {
      const store = { legacy: { engineSessionId: 'leg-sess' } };
      await mkdir(join(dir, '.golem'), { recursive: true });
      await writeFile(join(dir, '.golem', 'sessions.json'), `${JSON.stringify(store)}\n`);

      await pruneExpiredSessions(dir, 1);

      expect(await loadSession(dir, 'legacy')).toBe('leg-sess');
    });

    it('no-ops when no sessions file exists', async () => {
      await expect(pruneExpiredSessions(dir, 30)).resolves.toBeUndefined();
    });
  });

  describe('appendHistory', () => {
    it('writes per-session JSONL files', async () => {
      await appendHistory(dir, { ts: '2026-01-01T00:00:00Z', sessionKey: 'k', role: 'user', content: 'hi' });
      await appendHistory(dir, {
        ts: '2026-01-01T00:00:01Z',
        sessionKey: 'k',
        role: 'assistant',
        content: 'hello',
        durationMs: 500,
        costUsd: 0.01,
      });

      const raw = await readFile(join(dir, '.golem', 'history', 'k.jsonl'), 'utf-8');
      const lines = raw
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l));
      expect(lines).toHaveLength(2);
      expect(lines[0]).toEqual({ ts: '2026-01-01T00:00:00Z', sessionKey: 'k', role: 'user', content: 'hi' });
      expect(lines[1]).toMatchObject({ role: 'assistant', content: 'hello', durationMs: 500, costUsd: 0.01 });
    });

    it('creates .golem/history dir if missing', async () => {
      await appendHistory(dir, { ts: 'ts', sessionKey: 'k', role: 'user', content: 'test' });
      const raw = await readFile(join(dir, '.golem', 'history', 'k.jsonl'), 'utf-8');
      expect(raw).toContain('test');
    });

    it('different sessionKeys write to different files', async () => {
      await appendHistory(dir, { ts: 'ts', sessionKey: 'alice', role: 'user', content: 'msg-a' });
      await appendHistory(dir, { ts: 'ts', sessionKey: 'bob', role: 'user', content: 'msg-b' });

      const rawA = await readFile(join(dir, '.golem', 'history', 'alice.jsonl'), 'utf-8');
      const rawB = await readFile(join(dir, '.golem', 'history', 'bob.jsonl'), 'utf-8');
      expect(rawA).toContain('msg-a');
      expect(rawA).not.toContain('msg-b');
      expect(rawB).toContain('msg-b');
      expect(rawB).not.toContain('msg-a');
    });

    it('escapes special characters in sessionKey for filename', async () => {
      await appendHistory(dir, { ts: 'ts', sessionKey: 'slack:C123/U456', role: 'user', content: 'hi' });
      const raw = await readFile(join(dir, '.golem', 'history', 'slack:C123-U456.jsonl'), 'utf-8');
      expect(raw).toContain('hi');
    });
  });

  describe('getHistoryPath', () => {
    it('returns per-session path', () => {
      const p = getHistoryPath(dir, 'user:alice');
      expect(p).toBe(join(dir, '.golem', 'history', 'user:alice.jsonl'));
    });

    it('escapes special characters', () => {
      const p = getHistoryPath(dir, 'slack:C123/U456');
      expect(p).toBe(join(dir, '.golem', 'history', 'slack:C123-U456.jsonl'));
    });
  });

  describe('multi-user scenario', () => {
    it('simulates 3 users with interleaved conversations', async () => {
      // User A round 1
      await saveSession(dir, 'a-1', 'user:a');
      // User B round 1
      await saveSession(dir, 'b-1', 'user:b');
      // User A round 2 (resume)
      expect(await loadSession(dir, 'user:a')).toBe('a-1');
      await saveSession(dir, 'a-2', 'user:a');
      // User C joins
      expect(await loadSession(dir, 'user:c')).toBeUndefined();
      await saveSession(dir, 'c-1', 'user:c');
      // User B resets
      await clearSession(dir, 'user:b');
      expect(await loadSession(dir, 'user:b')).toBeUndefined();

      // Verify final state
      expect(await loadSession(dir, 'user:a')).toBe('a-2');
      expect(await loadSession(dir, 'user:c')).toBe('c-1');
    });
  });

  describe('countSessions', () => {
    it('returns 0 when no sessions exist', async () => {
      expect(await countSessions(dir)).toBe(0);
    });

    it('counts saved sessions', async () => {
      await saveSession(dir, 'sess-1', 'user:a');
      await saveSession(dir, 'sess-2', 'user:b');
      await saveSession(dir, 'sess-3', 'user:c');
      expect(await countSessions(dir)).toBe(3);
    });

    it('reflects cleared sessions', async () => {
      await saveSession(dir, 'sess-1', 'user:a');
      await saveSession(dir, 'sess-2', 'user:b');
      expect(await countSessions(dir)).toBe(2);
      await clearSession(dir, 'user:a');
      expect(await countSessions(dir)).toBe(1);
    });
  });

  describe('listHistoryFiles', () => {
    it('returns empty array when no history', async () => {
      expect(await listHistoryFiles(dir)).toEqual([]);
    });

    it('lists session keys from history files', async () => {
      await appendHistory(dir, { ts: new Date().toISOString(), sessionKey: 'user:alice', role: 'user', content: 'hi' });
      await appendHistory(dir, { ts: new Date().toISOString(), sessionKey: 'user:bob', role: 'user', content: 'hello' });
      const keys = await listHistoryFiles(dir);
      expect(keys).toContain('user:alice');
      expect(keys).toContain('user:bob');
      expect(keys.length).toBe(2);
    });
  });

  describe('readHistory', () => {
    it('returns empty array for non-existent session', async () => {
      expect(await readHistory(dir, 'nonexistent')).toEqual([]);
    });

    it('reads all entries', async () => {
      await appendHistory(dir, { ts: '2026-01-01T00:00:00Z', sessionKey: 'test', role: 'user', content: 'hello' });
      await appendHistory(dir, { ts: '2026-01-01T00:00:01Z', sessionKey: 'test', role: 'assistant', content: 'hi back' });
      const entries = await readHistory(dir, 'test');
      expect(entries.length).toBe(2);
      expect(entries[0].role).toBe('user');
      expect(entries[1].role).toBe('assistant');
    });

    it('respects limit parameter', async () => {
      for (let i = 0; i < 10; i++) {
        await appendHistory(dir, { ts: `2026-01-01T00:00:${String(i).padStart(2, '0')}Z`, sessionKey: 'limited', role: 'user', content: `msg ${i}` });
      }
      const entries = await readHistory(dir, 'limited', 3);
      expect(entries.length).toBe(3);
      expect(entries[0].content).toBe('msg 7');
      expect(entries[2].content).toBe('msg 9');
    });
  });
});
