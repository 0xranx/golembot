import { type ChannelAdapter } from './channel.js';
import { type InboxStore } from './inbox.js';
import type { SeenMessageStore } from './seen-messages.js';
export interface HistoryFetchConfig {
    enabled?: boolean;
    /** Minutes between periodic polls. Default: 15. */
    pollIntervalMinutes?: number;
    /** Minutes to look back on first startup (no watermark). Default: 60. */
    initialLookbackMinutes?: number;
}
export declare class WatermarkStore {
    private dir;
    private marks;
    constructor(dir: string);
    load(): Promise<void>;
    get(key: string): Date | undefined;
    set(key: string, ts: Date): void;
    save(): Promise<void>;
}
export interface TriageMessage {
    ts: string;
    senderName: string;
    text: string;
}
/**
 * Build a triage prompt for the agent to review missed messages.
 * The agent decides which messages to reply to, skip, or batch-reply.
 */
export declare function buildTriagePrompt(messages: TriageMessage[], chatId: string): string;
export interface HistoryFetcherOpts {
    dir: string;
    adapters: Map<string, ChannelAdapter>;
    inbox: InboxStore;
    /** Persistent dedup store shared with real-time path. */
    seenMessages?: SeenMessageStore;
    config: HistoryFetchConfig;
    verbose: boolean;
}
/**
 * Fetch missed messages from all adapters that support `fetchHistory` + `listChats`.
 * Groups messages by chat and enqueues triage prompts into the inbox.
 */
export declare function fetchMissedMessages(opts: HistoryFetcherOpts, watermarks: WatermarkStore): Promise<number>;
/**
 * Start periodic polling for missed messages.
 * Returns a stop function.
 */
export declare function startHistoryFetcher(opts: HistoryFetcherOpts): {
    watermarks: WatermarkStore;
    /** Run an immediate fetch (used on startup). */
    fetchNow: () => Promise<number>;
    /** Start periodic polling. Returns stop function. */
    startPolling: () => {
        stop: () => void;
    };
};
//# sourceMappingURL=history-fetcher.d.ts.map