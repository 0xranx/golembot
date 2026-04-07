export interface InboxChannelMsg {
    channelType: string;
    senderId: string;
    senderName?: string;
    chatId: string;
    chatType: 'dm' | 'group';
    messageId?: string;
    threadId?: string;
    /** Whether the bot was @mentioned in this message. */
    mentioned?: boolean;
}
export interface InboxEntry {
    id: string;
    ts: string;
    status: 'pending' | 'processing' | 'done' | 'failed';
    sessionKey: string;
    message: string;
    images?: {
        path: string;
        mimeType: string;
    }[];
    source: string;
    channelMsg?: InboxChannelMsg;
    processedAt?: string;
    error?: string;
}
export interface InboxConfig {
    enabled?: boolean;
    /** Days to retain completed entries before compaction. Default: 7. */
    retentionDays?: number;
}
export declare class InboxStore {
    private dir;
    /** In-memory dedup set: `${source}:${messageId}` */
    private seen;
    /** Tracks latest real-time (non-history-fetch) enqueue per session. */
    private realtimeTs;
    constructor(dir: string);
    /**
     * Returns true if the session had a real-time (non-history-fetch) message
     * enqueued within the last `withinMs` milliseconds.
     */
    hasRecentActivity(sessionKey: string, withinMs: number): boolean;
    /** Returns the timestamp (ms) of the latest real-time enqueue for a session, or 0. */
    getLastRealtimeTs(sessionKey: string): number;
    /** Update session activity to current time (called after Agent finishes responding). */
    touchRealtimeTs(sessionKey: string): void;
    /** Check if a message has already been enqueued (by channelType + messageId). */
    has(channelType: string, messageId: string): boolean;
    /** Mark a messageId as seen without enqueuing an entry. Used by history-fetch to register individual message IDs. */
    markSeen(channelType: string, messageId: string): void;
    /** Append a new entry to the JSONL file. */
    enqueue(partial: Omit<InboxEntry, 'id' | 'ts' | 'status'>): Promise<InboxEntry>;
    /**
     * Read all entries from JSONL, recover any `processing` entries back to
     * `pending` (crash recovery), and return all pending entries.
     */
    getPending(): Promise<InboxEntry[]>;
    /** Update the status of an entry by ID. */
    updateStatus(id: string, status: InboxEntry['status'], extra?: {
        error?: string;
    }): Promise<void>;
    /** Remove completed entries older than `maxAgeDays`. */
    compact(maxAgeDays: number): Promise<number>;
    private readAll;
    private writeAll;
}
//# sourceMappingURL=inbox.d.ts.map