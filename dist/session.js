import { appendFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const GOLEM_DIR = '.golem';
const SESSION_FILE = 'sessions.json';
const HISTORY_FILE = 'history.jsonl';
const DEFAULT_KEY = 'default';
function sessionPath(dir) {
    return join(dir, GOLEM_DIR, SESSION_FILE);
}
function historyPath(dir, sessionKey) {
    if (!sessionKey)
        return join(dir, GOLEM_DIR, HISTORY_FILE);
    const safeKey = sessionKey.replace(/[^a-z0-9_:-]/gi, '-');
    return join(dir, GOLEM_DIR, 'history', `${safeKey}.jsonl`);
}
export function getHistoryPath(dir, sessionKey) {
    return historyPath(dir, sessionKey);
}
export function getFallbackSessionKey(sessionKey) {
    if (!sessionKey)
        return undefined;
    const m = /^slack:([^:]+):([^:]+):thread:(.+)$/.exec(sessionKey);
    if (!m)
        return undefined;
    const [, chatId, senderId] = m;
    return `slack:${chatId}:${senderId}`;
}
async function readStore(dir) {
    try {
        const raw = await readFile(sessionPath(dir), 'utf-8');
        const data = JSON.parse(raw);
        // Migrate Phase 1 format: { engineSessionId: "xxx" } → { default: { engineSessionId: "xxx" } }
        if (typeof data.engineSessionId === 'string') {
            return data.engineSessionId
                ? { [DEFAULT_KEY]: { engineSessionId: data.engineSessionId, lastUsed: Date.now() } }
                : {};
        }
        return data;
    }
    catch {
        return {};
    }
}
async function writeStore(dir, store) {
    const golemDir = join(dir, GOLEM_DIR);
    await mkdir(golemDir, { recursive: true });
    await writeFile(sessionPath(dir), `${JSON.stringify(store, null, 2)}\n`, 'utf-8');
}
export async function loadSession(dir, key, engineType) {
    const store = await readStore(dir);
    const resolvedKey = key || DEFAULT_KEY;
    const entry = store[resolvedKey];
    if (!entry)
        return undefined;
    // Invalidate session if it was saved by a different engine type to prevent
    // cross-engine session ID contamination (e.g. claude-code UUID passed to opencode).
    if (engineType && entry.engineType && entry.engineType !== engineType)
        return undefined;
    return entry.engineSessionId || undefined;
}
export async function saveSession(dir, sessionId, key, engineType) {
    const store = await readStore(dir);
    store[key || DEFAULT_KEY] = { engineSessionId: sessionId, lastUsed: Date.now(), engineType };
    await writeStore(dir, store);
}
export async function clearSession(dir, key) {
    const store = await readStore(dir);
    delete store[key || DEFAULT_KEY];
    await writeStore(dir, store);
}
export async function clearHistory(dir, sessionKey) {
    const path = historyPath(dir, sessionKey || DEFAULT_KEY);
    await rm(path, { force: true });
}
export async function resetConversation(dir, key) {
    await clearSession(dir, key);
    await clearHistory(dir, key);
}
export async function pruneExpiredSessions(dir, maxAgeDays) {
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
    if (changed)
        await writeStore(dir, store);
}
export async function countSessions(dir) {
    const store = await readStore(dir);
    return Object.keys(store).length;
}
export async function listHistoryFiles(dir) {
    const histDir = join(dir, GOLEM_DIR, 'history');
    try {
        const files = await readdir(histDir);
        return files.filter((f) => f.endsWith('.jsonl')).map((f) => f.replace(/\.jsonl$/, ''));
    }
    catch {
        return [];
    }
}
export async function readHistory(dir, sessionKey, limit) {
    const path = historyPath(dir, sessionKey);
    try {
        const raw = await readFile(path, 'utf-8');
        const lines = raw
            .split('\n')
            .filter((l) => l.trim())
            .map((l) => JSON.parse(l));
        if (limit && limit > 0) {
            return lines.slice(-limit);
        }
        return lines;
    }
    catch {
        return [];
    }
}
export async function appendHistory(dir, entry) {
    const path = historyPath(dir, entry.sessionKey);
    const line = `${JSON.stringify(entry)}\n`;
    try {
        await appendFile(path, line, 'utf-8');
    }
    catch (e) {
        if (e.code === 'ENOENT') {
            await mkdir(join(dir, GOLEM_DIR, 'history'), { recursive: true });
            await appendFile(path, line, 'utf-8');
        }
        // other errors: best effort, silently ignored
    }
}
//# sourceMappingURL=session.js.map