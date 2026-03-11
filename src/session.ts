import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';

const GOLEM_DIR = '.golem';
const SESSION_FILE = 'sessions.json';
const HISTORY_FILE = 'history.jsonl';

const DEFAULT_KEY = 'default';

interface SessionEntry {
  engineSessionId: string;
  lastUsed: number; // unix ms
  engineType?: string; // e.g. "opencode", "claude-code", "cursor", "codex"
}

type SessionStore = Record<string, SessionEntry>;

export interface HistoryEntry {
  ts: string;
  sessionKey: string;
  role: 'user' | 'assistant';
  content: string;
  durationMs?: number;
  costUsd?: number;
}

function sessionPath(dir: string): string {
  return join(dir, GOLEM_DIR, SESSION_FILE);
}

function historyPath(dir: string, sessionKey?: string): string {
  if (!sessionKey) return join(dir, GOLEM_DIR, HISTORY_FILE);
  const safeKey = sessionKey.replace(/[^a-z0-9_:-]/gi, '-');
  return join(dir, GOLEM_DIR, 'history', `${safeKey}.jsonl`);
}

export function getHistoryPath(dir: string, sessionKey: string): string {
  return historyPath(dir, sessionKey);
}

async function readStore(dir: string): Promise<SessionStore> {
  try {
    const raw = await readFile(sessionPath(dir), 'utf-8');
    const data = JSON.parse(raw);

    // Migrate Phase 1 format: { engineSessionId: "xxx" } → { default: { engineSessionId: "xxx" } }
    if (typeof data.engineSessionId === 'string') {
      return data.engineSessionId
        ? { [DEFAULT_KEY]: { engineSessionId: data.engineSessionId, lastUsed: Date.now() } }
        : {};
    }

    return data as SessionStore;
  } catch {
    return {};
  }
}

async function writeStore(dir: string, store: SessionStore): Promise<void> {
  const golemDir = join(dir, GOLEM_DIR);
  await mkdir(golemDir, { recursive: true });
  await writeFile(sessionPath(dir), `${JSON.stringify(store, null, 2)}\n`, 'utf-8');
}

export async function loadSession(dir: string, key?: string, engineType?: string): Promise<string | undefined> {
  const store = await readStore(dir);
  const entry = store[key || DEFAULT_KEY];
  if (!entry) return undefined;
  // Invalidate session if it was saved by a different engine type to prevent
  // cross-engine session ID contamination (e.g. claude-code UUID passed to opencode).
  if (engineType && entry.engineType && entry.engineType !== engineType) return undefined;
  return entry.engineSessionId || undefined;
}

export async function saveSession(dir: string, sessionId: string, key?: string, engineType?: string): Promise<void> {
  const store = await readStore(dir);
  store[key || DEFAULT_KEY] = { engineSessionId: sessionId, lastUsed: Date.now(), engineType };
  await writeStore(dir, store);
}

export async function clearSession(dir: string, key?: string): Promise<void> {
  const store = await readStore(dir);
  delete store[key || DEFAULT_KEY];
  await writeStore(dir, store);
}

export async function pruneExpiredSessions(dir: string, maxAgeDays: number): Promise<void> {
  const store = await readStore(dir);
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  let changed = false;
  for (const key of Object.keys(store)) {
    const entry = store[key];
    // Entries without lastUsed (legacy) are kept until they get a lastUsed stamp
    if (entry.lastUsed && entry.lastUsed < cutoff) {
      delete store[key];
      changed = true;
    }
  }
  if (changed) await writeStore(dir, store);
}

export async function countSessions(dir: string): Promise<number> {
  const store = await readStore(dir);
  return Object.keys(store).length;
}

export async function listHistoryFiles(dir: string): Promise<string[]> {
  const histDir = join(dir, GOLEM_DIR, 'history');
  try {
    const files = await readdir(histDir);
    return files.filter((f) => f.endsWith('.jsonl')).map((f) => f.replace(/\.jsonl$/, ''));
  } catch {
    return [];
  }
}

export async function readHistory(
  dir: string,
  sessionKey: string,
  limit?: number,
): Promise<HistoryEntry[]> {
  const path = historyPath(dir, sessionKey);
  try {
    const raw = await readFile(path, 'utf-8');
    const lines = raw
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as HistoryEntry);
    if (limit && limit > 0) {
      return lines.slice(-limit);
    }
    return lines;
  } catch {
    return [];
  }
}

export async function appendHistory(dir: string, entry: HistoryEntry): Promise<void> {
  const path = historyPath(dir, entry.sessionKey);
  const line = `${JSON.stringify(entry)}\n`;
  try {
    await appendFile(path, line, 'utf-8');
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      await mkdir(join(dir, GOLEM_DIR, 'history'), { recursive: true });
      await appendFile(path, line, 'utf-8');
    }
    // other errors: best effort, silently ignored
  }
}
