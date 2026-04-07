import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const GOLEM_DIR = '.golem';
const SEEN_FILE = 'seen-messages.json';
/**
 * Persistent dedup store for message IDs.
 *
 * Both the real-time WebSocket path and the history-fetch polling path
 * write to this store. Before processing any message, both paths check
 * this store to avoid duplicate handling.
 *
 * Entries auto-expire after `ttlMs` (default: 24 hours) to prevent
 * unbounded growth.
 */
export class SeenMessageStore {
    dir;
    ttlMs;
    /** Map of `${channelType}:${messageId}` → timestamp (ms) */
    entries = new Map();
    dirty = false;
    saveTimer;
    constructor(dir, ttlMs = 24 * 60 * 60 * 1000) {
        this.dir = dir;
        this.ttlMs = ttlMs;
    }
    /** Load from disk. Call once on startup. */
    async load() {
        try {
            const raw = await readFile(join(this.dir, GOLEM_DIR, SEEN_FILE), 'utf-8');
            const parsed = JSON.parse(raw);
            const now = Date.now();
            // Only load non-expired entries
            for (const [key, ts] of Object.entries(parsed)) {
                if (now - ts < this.ttlMs) {
                    this.entries.set(key, ts);
                }
            }
        }
        catch {
            // File doesn't exist or is malformed — start fresh
        }
    }
    /** Check if a message has been seen (by messageId or content fingerprint). */
    has(channelType, messageId) {
        const key = `${channelType}:${messageId}`;
        const ts = this.entries.get(key);
        if (!ts)
            return false;
        // Expired entries are treated as unseen
        if (Date.now() - ts >= this.ttlMs) {
            this.entries.delete(key);
            return false;
        }
        return true;
    }
    /**
     * Normalize text for content fingerprinting.
     * Strips @_user_N mention placeholders so the same message matches
     * regardless of whether the WebSocket path stripped them or not.
     */
    static normalizeText(text) {
        return text
            .replace(/@_user_\d+/g, '')
            .trim()
            .slice(0, 100);
    }
    /** Check by content fingerprint (senderId + normalized text). */
    hasContent(channelType, senderId, text) {
        const key = `${channelType}:c:${senderId}:${SeenMessageStore.normalizeText(text)}`;
        const ts = this.entries.get(key);
        if (!ts)
            return false;
        if (Date.now() - ts >= this.ttlMs) {
            this.entries.delete(key);
            return false;
        }
        return true;
    }
    /** Mark a message as seen. Schedules a debounced save. */
    mark(channelType, messageId) {
        this.entries.set(`${channelType}:${messageId}`, Date.now());
        this.dirty = true;
        this.scheduleSave();
    }
    /** Mark by content fingerprint (senderId + normalized text). */
    markContent(channelType, senderId, text) {
        const key = `${channelType}:c:${senderId}:${SeenMessageStore.normalizeText(text)}`;
        this.entries.set(key, Date.now());
        this.dirty = true;
        this.scheduleSave();
    }
    /** Persist to disk immediately. */
    async save() {
        if (!this.dirty)
            return;
        this.dirty = false;
        // Prune expired entries before saving
        const now = Date.now();
        for (const [key, ts] of this.entries) {
            if (now - ts >= this.ttlMs)
                this.entries.delete(key);
        }
        const obj = {};
        for (const [key, ts] of this.entries) {
            obj[key] = ts;
        }
        await mkdir(join(this.dir, GOLEM_DIR), { recursive: true });
        const target = join(this.dir, GOLEM_DIR, SEEN_FILE);
        const tmp = `${target}.tmp`;
        await writeFile(tmp, `${JSON.stringify(obj)}\n`, 'utf-8');
        await rename(tmp, target);
    }
    /** Stop the save timer (call on shutdown). */
    stop() {
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = undefined;
        }
    }
    scheduleSave() {
        if (this.saveTimer)
            return;
        // Debounce: save at most every 5 seconds
        this.saveTimer = setTimeout(async () => {
            this.saveTimer = undefined;
            await this.save().catch(() => { });
        }, 5000);
        if (this.saveTimer.unref)
            this.saveTimer.unref();
    }
}
//# sourceMappingURL=seen-messages.js.map