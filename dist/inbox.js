import { randomBytes } from 'node:crypto';
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const GOLEM_DIR = '.golem';
const INBOX_FILE = 'inbox.jsonl';
function inboxPath(dir) {
    return join(dir, GOLEM_DIR, INBOX_FILE);
}
function generateId() {
    return randomBytes(4).toString('hex');
}
// ---------------------------------------------------------------------------
// InboxStore
// ---------------------------------------------------------------------------
export class InboxStore {
    dir;
    /** In-memory dedup set: `${source}:${messageId}` */
    seen = new Set();
    /** Tracks latest real-time (non-history-fetch) enqueue per session. */
    realtimeTs = new Map();
    constructor(dir) {
        this.dir = dir;
    }
    /**
     * Returns true if the session had a real-time (non-history-fetch) message
     * enqueued within the last `withinMs` milliseconds.
     */
    hasRecentActivity(sessionKey, withinMs) {
        const ts = this.realtimeTs.get(sessionKey);
        if (!ts)
            return false;
        return Date.now() - ts < withinMs;
    }
    /** Returns the timestamp (ms) of the latest real-time enqueue for a session, or 0. */
    getLastRealtimeTs(sessionKey) {
        return this.realtimeTs.get(sessionKey) ?? 0;
    }
    /** Update session activity to current time (called after Agent finishes responding). */
    touchRealtimeTs(sessionKey) {
        this.realtimeTs.set(sessionKey, Date.now());
    }
    /** Check if a message has already been enqueued (by channelType + messageId). */
    has(channelType, messageId) {
        return this.seen.has(`${channelType}:${messageId}`);
    }
    /** Mark a messageId as seen without enqueuing an entry. Used by history-fetch to register individual message IDs. */
    markSeen(channelType, messageId) {
        this.seen.add(`${channelType}:${messageId}`);
    }
    /** Append a new entry to the JSONL file. */
    async enqueue(partial) {
        const entry = {
            id: generateId(),
            ts: new Date().toISOString(),
            status: 'pending',
            ...partial,
        };
        // Track in dedup set — use channelType (not source) for consistent keying
        if (entry.channelMsg?.messageId) {
            this.seen.add(`${entry.channelMsg.channelType}:${entry.channelMsg.messageId}`);
        }
        // Track real-time activity per session (non-history-fetch entries)
        if (entry.source !== 'history-fetch') {
            this.realtimeTs.set(entry.sessionKey, Date.now());
        }
        const line = `${JSON.stringify(entry)}\n`;
        const path = inboxPath(this.dir);
        try {
            await appendFile(path, line, 'utf-8');
        }
        catch (e) {
            if (e.code === 'ENOENT') {
                await mkdir(join(this.dir, GOLEM_DIR), { recursive: true });
                await appendFile(path, line, 'utf-8');
            }
            else {
                throw e;
            }
        }
        return entry;
    }
    /**
     * Read all entries from JSONL, recover any `processing` entries back to
     * `pending` (crash recovery), and return all pending entries.
     */
    async getPending() {
        const entries = await this.readAll();
        let needRewrite = false;
        for (const entry of entries) {
            // Crash recovery: processing → pending
            if (entry.status === 'processing') {
                entry.status = 'pending';
                needRewrite = true;
            }
            // Populate dedup set — use channelType for consistent keying
            if (entry.channelMsg?.messageId) {
                this.seen.add(`${entry.channelMsg.channelType}:${entry.channelMsg.messageId}`);
            }
            // Populate real-time activity from recent non-history-fetch entries
            if (entry.source !== 'history-fetch') {
                const entryTs = new Date(entry.ts).getTime();
                const prev = this.realtimeTs.get(entry.sessionKey) ?? 0;
                if (entryTs > prev)
                    this.realtimeTs.set(entry.sessionKey, entryTs);
            }
        }
        if (needRewrite) {
            await this.writeAll(entries);
        }
        return entries.filter((e) => e.status === 'pending');
    }
    /** Update the status of an entry by ID. */
    async updateStatus(id, status, extra) {
        const entries = await this.readAll();
        const entry = entries.find((e) => e.id === id);
        if (!entry)
            return;
        entry.status = status;
        if (status === 'done' || status === 'failed') {
            entry.processedAt = new Date().toISOString();
        }
        if (extra?.error) {
            entry.error = extra.error;
        }
        await this.writeAll(entries);
    }
    /** Remove completed entries older than `maxAgeDays`. */
    async compact(maxAgeDays) {
        const entries = await this.readAll();
        const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
        const before = entries.length;
        const kept = entries.filter((e) => {
            if (e.status === 'pending' || e.status === 'processing')
                return true;
            const completedAt = e.processedAt ? new Date(e.processedAt).getTime() : 0;
            return completedAt > cutoff;
        });
        if (kept.length < before) {
            await this.writeAll(kept);
        }
        return before - kept.length;
    }
    // -- Internal helpers ---------------------------------------------------
    async readAll() {
        let raw;
        try {
            raw = await readFile(inboxPath(this.dir), 'utf-8');
        }
        catch {
            return [];
        }
        const entries = [];
        for (const line of raw.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed)
                continue;
            try {
                entries.push(JSON.parse(trimmed));
            }
            catch {
                // skip malformed lines
            }
        }
        return entries;
    }
    async writeAll(entries) {
        const golemDir = join(this.dir, GOLEM_DIR);
        await mkdir(golemDir, { recursive: true });
        const target = inboxPath(this.dir);
        const tmp = `${target}.tmp`;
        const content = entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length > 0 ? '\n' : '');
        await writeFile(tmp, content, 'utf-8');
        await rename(tmp, target);
    }
}
//# sourceMappingURL=inbox.js.map