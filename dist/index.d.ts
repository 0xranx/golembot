import type { FileAttachment, ImageAttachment } from './channel.js';
import { type DiscoveredEngine, type StreamEvent } from './engine.js';
import { type GolemConfig, type ProviderConfig, type SkillInfo } from './workspace.js';
export type { ChannelAdapter, ChannelMessage, ImageAttachment, ReadReceipt } from './channel.js';
export { buildSessionKey, stripMention } from './channel.js';
export { type CommandContext, type CommandResult, executeCommand, parseCommand } from './commands.js';
export type { ChannelStatus, DashboardContext, GatewayMetrics, RecentMessage } from './dashboard.js';
export type { DiscoveredEngine, StreamEvent } from './engine.js';
export { claudeProviderEnv, codexProviderEnv, cursorProviderEnv, openCodeProviderEnv } from './engine.js';
export type { FleetEntry, FleetInstance, FleetServerOpts } from './fleet.js';
export { findInstance, findStoppedInstance, isProcessAlive, listInstances, listStoppedInstances, registerInstance, renderFleetDashboard, startFleetServer, startInstance, stopInstance, unregisterInstance, } from './fleet.js';
export { startGateway } from './gateway.js';
export type { HistoryFetchConfig } from './history-fetcher.js';
export { buildTriagePrompt, startHistoryFetcher, WatermarkStore } from './history-fetcher.js';
export type { InboxConfig, InboxEntry } from './inbox.js';
export { InboxStore } from './inbox.js';
export type { ProactiveCoordinatorOpts } from './proactive.js';
export { createProactiveCoordinator, ProactiveCoordinator } from './proactive.js';
export { createProviderFromPreset, type ProviderPreset, providerPresets } from './provider-presets.js';
export type { CronFields, ScheduledTaskDef, TaskTarget } from './scheduler.js';
export { getNextCronDelay, getNextCronTime, normalizeSchedule, parseCron, Scheduler } from './scheduler.js';
export { createGolemServer, type GolemServer, type ServerOpts, startServer } from './server.js';
export type { TaskExecution, TaskRecord } from './task-store.js';
export { TaskStore } from './task-store.js';
export type { ChannelsConfig, CodexConfig, DingtalkChannelConfig, DiscordChannelConfig, EscalationConfig, FeishuChannelConfig, GatewayConfig, GolemConfig, McpServerConfig, ProviderConfig, SkillInfo, SlackChannelConfig, StreamingConfig, TelegramChannelConfig, WecomChannelConfig, } from './workspace.js';
export { patchConfig } from './workspace.js';
export interface ChatOpts {
    sessionKey?: string;
    /** Images attached to the user message. Saved to disk and referenced in the prompt. */
    images?: ImageAttachment[];
    /** Files (non-image) attached to the user message. Saved to disk and referenced in the prompt. */
    files?: FileAttachment[];
}
export interface Assistant {
    chat(message: string, opts?: ChatOpts): AsyncIterable<StreamEvent>;
    init(opts: {
        engine: string;
        name: string;
        role?: string;
    }): Promise<void>;
    cancel(sessionKey?: string): Promise<boolean>;
    resetSession(sessionKey?: string): Promise<void>;
    /** Switch engine at runtime (takes effect on next chat call). When clearModel is true, also resets the model override. */
    setEngine(engine: string, clearModel?: boolean): void;
    /** Switch model at runtime (takes effect on next chat call). */
    setModel(model: string): void;
    /** Return current runtime status (engine, model, config, skills). */
    getStatus(): Promise<{
        config: GolemConfig;
        skills: SkillInfo[];
        engine: string;
        model: string | undefined;
    }>;
    /** List available models for the current engine. */
    listModels(): Promise<string[]>;
    /** Discover CLI engines installed on the system. */
    discoverEngines(): Promise<DiscoveredEngine[]>;
    /** Set provider config at runtime (updates in-memory state and writes to golem.yaml). */
    setProvider(provider: ProviderConfig): void;
}
export interface CreateAssistantOpts {
    dir: string;
    engine?: string;
    model?: string;
    apiKey?: string;
    /** Max concurrent Agent invocations (overrides golem.yaml). Default: 10. */
    maxConcurrent?: number;
    /** Max queued requests per session key (overrides golem.yaml). Default: 3. */
    maxQueuePerSession?: number;
    /** Agent invocation timeout in ms (overrides golem.yaml timeout field). Default: 300000. */
    timeoutMs?: number;
}
export declare function createAssistant(opts: CreateAssistantOpts): Assistant;
//# sourceMappingURL=index.d.ts.map