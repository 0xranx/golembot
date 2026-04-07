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
export declare class SeenMessageStore {
    private dir;
    private ttlMs;
    /** Map of `${channelType}:${messageId}` → timestamp (ms) */
    private entries;
    private dirty;
    private saveTimer;
    constructor(dir: string, ttlMs?: number);
    /** Load from disk. Call once on startup. */
    load(): Promise<void>;
    /** Check if a message has been seen (by messageId or content fingerprint). */
    has(channelType: string, messageId: string): boolean;
    /**
     * Normalize text for content fingerprinting.
     * Strips @_user_N mention placeholders so the same message matches
     * regardless of whether the WebSocket path stripped them or not.
     */
    private static normalizeText;
    /** Check by content fingerprint (senderId + normalized text). */
    hasContent(channelType: string, senderId: string, text: string): boolean;
    /** Mark a message as seen. Schedules a debounced save. */
    mark(channelType: string, messageId: string): void;
    /** Mark by content fingerprint (senderId + normalized text). */
    markContent(channelType: string, senderId: string, text: string): void;
    /** Persist to disk immediately. */
    save(): Promise<void>;
    /** Stop the save timer (call on shutdown). */
    stop(): void;
    private scheduleSave;
}
//# sourceMappingURL=seen-messages.d.ts.map