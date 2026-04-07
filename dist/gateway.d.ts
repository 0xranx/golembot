import { type ChannelAdapter, type ChannelMessage, type MentionTarget } from './channel.js';
import { type GatewayMetrics } from './dashboard.js';
import { type InboxEntry, InboxStore } from './inbox.js';
import { type Assistant } from './index.js';
import { Scheduler } from './scheduler.js';
import { TaskStore } from './task-store.js';
import { type GolemConfig, type GroupChatConfig, type StreamingConfig } from './workspace.js';
export declare function splitMessage(text: string, maxLen: number): string[];
interface GatewayOpts {
    dir?: string;
    port?: number;
    host?: string;
    token?: string;
    apiKey?: string;
    verbose?: boolean;
}
export interface GroupMessage {
    senderName: string;
    text: string;
    isBot: boolean;
}
/** Recent message history per group conversation (channel or Slack thread). */
export declare const groupHistories: Map<string, GroupMessage[]>;
/** Total bot replies sent per group — used as a safety valve against runaway chains. */
export declare const groupTurnCounters: Map<string, number>;
/** Timestamp of the last human (non-bot) message per group — used to reset turn counters. */
export declare const groupLastActivity: Map<string, number>;
/** Clear all in-memory group state for a session key (called by the resetSession wrapper). */
export declare function clearGroupChatState(sessionKey: string): void;
/**
 * After this many milliseconds of silence in a group, reset the turn counter.
 * This ensures maxTurns is a per-conversation limit, not a permanent lifetime ban.
 */
export declare const GROUP_TURN_RESET_MS: number;
/**
 * Purge all in-memory group state for groups that have been idle longer than
 * `GROUP_TURN_RESET_MS`. Called periodically to prevent unbounded memory growth
 * when a gateway process serves many dynamic groups over its lifetime.
 */
export declare function purgeIdleGroups(): void;
export declare function resolveGroupChatConfig(config: GolemConfig): Required<GroupChatConfig>;
export declare function resolveStreamingConfig(config: GolemConfig): Required<StreamingConfig>;
/** Peer bot info for multi-bot awareness in group prompts. */
export interface PeerBot {
    name: string;
    role?: string;
}
export declare function buildGroupPrompt(history: GroupMessage[], senderName: string, userText: string, injectPass: boolean, groupKey: string, _dir: string, 
/** When set, the message explicitly @mentions someone else — this bot should almost always [PASS]. */
othersAddressed?: string[], 
/** Other GolemBot instances discovered via fleet, for multi-bot coordination. */
peers?: PeerBot[]): string;
export declare function requireFields(type: string, config: Record<string, unknown>, fields: string[]): void;
/**
 * Extract @mentions from AI reply text by matching against known group members.
 * Returns the original text (unchanged) plus a list of resolved mention targets.
 */
export declare function parseMentions(text: string, memberCache: Map<string, string>): {
    text: string;
    mentions: MentionTarget[];
};
/**
 * Process a single incoming IM message through the gateway pipeline.
 * Exported for unit-testing; `startGateway` calls this for every adapter message.
 */
export declare function handleMessage(msg: ChannelMessage, config: GolemConfig, assistant: Pick<Assistant, 'chat' | 'setEngine' | 'setModel' | 'getStatus' | 'resetSession' | 'cancel' | 'listModels'>, adapter: Pick<ChannelAdapter, 'reply' | 'maxMessageLength' | 'typing' | 'getGroupMembers' | 'sendStatus' | 'updateStatus' | 'clearStatus'>, channelType: string, verbose: boolean, dir: string, metrics?: GatewayMetrics, cronCtx?: {
    taskStore: TaskStore;
    scheduler: Scheduler;
    runTask: (id: string) => Promise<string>;
}, 
/** Fleet peers for multi-bot awareness. */
peers?: PeerBot[]): Promise<void>;
/**
 * Convert a ChannelMessage to inbox entry fields for enqueueing.
 */
export declare function channelMsgToInbox(msg: ChannelMessage, sessionKey: string, fullText: string): Omit<InboxEntry, 'id' | 'ts' | 'status'>;
/**
 * Start a sequential inbox consumer that processes pending messages one by one.
 * Returns a stop function.
 */
export declare function startInboxConsumer(inbox: InboxStore, processEntry: (entry: InboxEntry) => Promise<void>, verbose: boolean): {
    stop: () => void;
};
export declare function startGateway(opts: GatewayOpts): Promise<void>;
export {};
//# sourceMappingURL=gateway.d.ts.map