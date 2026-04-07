import type { ServerResponse } from 'node:http';
import type { TaskExecution, TaskRecord, TaskStore } from './task-store.js';
import type { GolemConfig, PersonaConfig, SkillInfo } from './workspace.js';
export interface EscalationEntry {
    ts: string;
    reason: string;
    sessionKey?: string;
    context?: string;
    status?: 'open' | 'resolved';
}
export interface ChannelStatus {
    type: string;
    status: 'connected' | 'failed' | 'not_configured';
    error?: string;
}
export interface RecentMessage {
    ts: string;
    source: string;
    sender: string;
    messagePreview: string;
    responsePreview: string;
    durationMs?: number;
    costUsd?: number;
    passed?: boolean;
}
export interface GatewayMetrics {
    totalMessages: number;
    totalCostUsd: number;
    totalDurationMs: number;
    messagesBySource: Record<string, number>;
    recentMessages: RecentMessage[];
    eventSubscribers: Set<ServerResponse>;
}
export interface DashboardContext {
    config: GolemConfig;
    skills: SkillInfo[];
    channelStatuses: ChannelStatus[];
    metrics: GatewayMetrics;
    startTime: number;
    version: string;
    /** Optional: live runtime status (engine/model may differ from config after /engine or /model). */
    getRuntimeStatus?: () => Promise<{
        engine: string;
        model: string | undefined;
    }>;
    /** Optional: task store for scheduled tasks panel. */
    taskStore?: TaskStore;
    /** Working directory for reading .golem/ files. */
    dir?: string;
    /** Optional: fleet peers for multi-bot visibility. */
    getFleetPeers?: () => Promise<FleetPeer[]>;
}
export declare function createMetrics(): GatewayMetrics;
export declare function recordMessage(metrics: GatewayMetrics, msg: RecentMessage): void;
export declare const KNOWN_CHANNELS: string[];
interface DashboardData {
    name: string;
    engine: string;
    model?: string;
    version: string;
    uptime: number;
    channels: ChannelStatus[];
    skills: {
        name: string;
        description: string;
        type?: string;
    }[];
    metrics: {
        totalMessages: number;
        totalCostUsd: number;
        avgDurationMs: number;
        messagesBySource: Record<string, number>;
    };
    recentMessages: RecentMessage[];
    authEnabled: boolean;
    host: string;
    port: number;
    tasks: TaskRecord[];
    taskHistory: Map<string, TaskExecution[]>;
    escalations: EscalationEntry[];
    persona?: PersonaConfig;
    activeSessions?: {
        key: string;
        lastActivity: string;
    }[];
    memoryOverview?: {
        notesPreview?: string;
        groupFiles?: string[];
        recentSummaries?: string[];
    };
    config: GolemConfig;
    fleetPeers?: FleetPeer[];
}
export interface FleetPeer {
    name: string;
    url: string;
    engine: string;
    model?: string;
    role?: string;
    alive: boolean;
}
export declare function buildDashboardData(ctx: DashboardContext): Promise<DashboardData>;
export declare function renderDashboard(data: DashboardData): string;
export {};
//# sourceMappingURL=dashboard.d.ts.map