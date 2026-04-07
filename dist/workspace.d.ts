import type { ScheduledTaskDef } from './scheduler.js';
export type { HistoryFetchConfig } from './history-fetcher.js';
export type { InboxConfig } from './inbox.js';
export type { ScheduledTaskDef, TaskTarget } from './scheduler.js';
export interface FeishuChannelConfig {
    appId: string;
    appSecret: string;
}
export interface DingtalkChannelConfig {
    clientId: string;
    clientSecret: string;
}
export interface WecomChannelConfig {
    botId: string;
    secret: string;
    websocketUrl?: string;
}
export interface SlackChannelConfig {
    botToken: string;
    appToken: string;
}
export interface TelegramChannelConfig {
    botToken: string;
}
export interface DiscordChannelConfig {
    botToken: string;
    /**
     * Set to the same value as golem.yaml `name` to enable @mention detection
     * in Discord servers (guild channels). Without this, the gateway can't tell
     * if the bot was @mentioned and will fall back to policy defaults.
     */
    botName?: string;
}
export interface WeixinChannelConfig {
    /** Bearer token from iLink Bot QR login. Supports ${ENV_VAR} placeholders. */
    token: string;
    /** Optional: iLink API base URL override. */
    baseUrl?: string;
}
export interface ChannelsConfig {
    feishu?: FeishuChannelConfig;
    dingtalk?: DingtalkChannelConfig;
    wecom?: WecomChannelConfig;
    slack?: SlackChannelConfig;
    telegram?: TelegramChannelConfig;
    discord?: DiscordChannelConfig;
    weixin?: WeixinChannelConfig;
    /** Custom channel adapters: any key with `_adapter: <path>` in config. */
    [key: string]: unknown;
}
export interface GatewayConfig {
    port?: number;
    host?: string;
    token?: string;
}
export interface GroupChatConfig {
    /**
     * How the bot decides whether to respond in a group:
     * - `mention-only` (default): only respond when @mentioned; agent not called otherwise (zero cost)
     * - `smart`: agent is called for every message; outputs `[PASS]` to stay silent; can update group memory even when not responding
     * - `always`: respond to every message unconditionally
     */
    groupPolicy?: 'mention-only' | 'smart' | 'always';
    /** Number of recent group messages to inject as context. Default: 20. */
    historyLimit?: number;
    /** Max total replies this bot will send per group before stopping (safety valve). Default: 10. */
    maxTurns?: number;
}
export interface StreamingConfig {
    /**
     * How the gateway delivers AI replies to IM channels:
     * - `buffered` (default): accumulate all text, send as a single message after completion
     * - `streaming`: send text incrementally at logical boundaries (paragraph breaks, tool calls)
     */
    mode?: 'buffered' | 'streaming';
    /** When true, send a brief hint message when the agent invokes a tool (e.g. "🔧 read_file..."). Default: false. */
    showToolCalls?: boolean;
}
export interface PermissionsConfig {
    /** Paths the agent is allowed to read/write (relative to workspace). */
    allowedPaths?: string[];
    /** Paths the agent must not access (relative to workspace). */
    deniedPaths?: string[];
    /** Shell commands the agent is allowed to run (exact or glob patterns). */
    allowedCommands?: string[];
    /** Shell commands the agent must not run. */
    deniedCommands?: string[];
}
export interface PersonaConfig {
    displayName?: string;
    role?: string;
    tone?: string;
    boundaries?: string[];
}
export interface McpServerConfig {
    command: string;
    args?: string[];
    env?: Record<string, string>;
}
export interface EscalationConfig {
    target?: import('./scheduler.js').TaskTarget;
    enabled?: boolean;
}
export type CodexMode = 'safe' | 'unrestricted';
export type CodexSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';
export type CodexApprovalMode = 'untrusted' | 'on-request' | 'never';
export interface CodexConfig {
    mode?: CodexMode;
    sandbox?: CodexSandboxMode;
    approval?: CodexApprovalMode;
    search?: boolean;
    addDirs?: string[];
}
export interface ProviderConfig {
    /** API base URL (e.g. "https://api.minimax.chat/v1") */
    baseUrl?: string;
    /** API key (supports ${ENV_VAR} placeholders) */
    apiKey?: string;
    /** Default model override */
    model?: string;
    /** Per-engine model overrides (key = engine name) */
    models?: Record<string, string>;
    /** Codex profile name from ~/.codex/config.toml (e.g. "m21") */
    codexProfile?: string;
    /** Codex custom provider id for -c model_provider="..." (e.g. "minimax") */
    codexProviderId?: string;
    /** Codex wire API mode for custom providers. Current Codex releases require "responses". */
    codexWireApi?: 'responses';
    /** Codex custom provider key env var name (e.g. "MINIMAX_API_KEY") */
    codexEnvKey?: string;
    /**
     * Secondary provider to use when the primary fails consecutively.
     * GolemBot switches to this config after `failoverThreshold` consecutive
     * errors and stays on it until the assistant instance is restarted.
     * Nested `fallback` on this config is ignored.
     */
    fallback?: ProviderConfig;
    /**
     * Number of consecutive errors from the primary provider before activating
     * the fallback. Default: 3.
     */
    failoverThreshold?: number;
    /**
     * How long in milliseconds to wait before retrying the primary provider
     * after switching to the fallback. Once the cooldown expires, the next
     * request will attempt the primary again. If the primary succeeds the
     * circuit resets; if it fails again, the fallback is reactivated.
     * Set to 0 to disable automatic recovery (stay on fallback until restart).
     * Default: 60000 (1 minute).
     */
    fallbackRecoveryMs?: number;
}
export interface GolemConfig {
    name: string;
    engine: string;
    model?: string;
    skipPermissions?: boolean;
    codex?: CodexConfig;
    channels?: ChannelsConfig;
    gateway?: GatewayConfig;
    /** Agent invocation timeout in seconds. Default: 300 (5 minutes). */
    timeout?: number;
    /** Maximum concurrent Agent invocations across all sessions. Default: 10. */
    maxConcurrent?: number;
    /** Maximum queued requests per session key. Default: 3. */
    maxQueuePerSession?: number;
    /** Days before inactive sessions are pruned. Default: 30. */
    sessionTtlDays?: number;
    /** System-level instructions prepended to every user message before engine invocation. */
    systemPrompt?: string;
    /** Group chat behaviour. Applies to all group messages across all channels. */
    groupChat?: GroupChatConfig;
    /** Control how AI replies are delivered to IM channels. */
    streaming?: StreamingConfig;
    /** Agent permissions (allowed/denied paths and commands). */
    permissions?: PermissionsConfig;
    tasks?: ScheduledTaskDef[];
    /** Custom LLM provider — decouples engine from API backend. */
    provider?: ProviderConfig;
    /** Claude Max subscription OAuth token (from `claude setup-token`). Claude Code engine only. */
    oauthToken?: string;
    /** Persistent message inbox for IM channels. */
    inbox?: import('./inbox.js').InboxConfig;
    /** Historical message fetching for offline awareness. */
    historyFetch?: import('./history-fetcher.js').HistoryFetchConfig;
    /** Structured agent identity — rendered into AGENTS.md as a persona section. */
    persona?: PersonaConfig;
    /** MCP server configurations — passed through to the underlying engine. */
    mcp?: Record<string, McpServerConfig>;
    /** Human escalation configuration — when the agent cannot handle a request. */
    escalation?: EscalationConfig;
}
export interface SkillInfo {
    name: string;
    path: string;
    description: string;
    type?: string;
}
/**
 * Recursively resolve `${ENV_VAR}` placeholders in string values.
 * Non-string values and missing env vars are left unchanged.
 */
export declare function resolveEnvPlaceholders<T>(obj: T): T;
export declare function loadConfig(dir: string): Promise<GolemConfig>;
/**
 * Patch specific fields in golem.yaml without losing unknown fields or expanding
 * `${ENV_VAR}` placeholders. This is the safe way to update config at runtime.
 */
export declare function patchConfig(dir: string, patch: Partial<Pick<GolemConfig, 'engine' | 'model'>>): Promise<void>;
export declare function writeConfig(dir: string, config: GolemConfig): Promise<void>;
/**
 * Deep-merge a partial config patch into the existing golem.yaml and write it back.
 * Returns the new config and whether a restart is needed for the changes to take effect.
 */
export declare function patchConfigFull(dir: string, patch: Record<string, unknown>): Promise<{
    config: GolemConfig;
    needsRestart: boolean;
}>;
export declare function scanSkills(dir: string): Promise<SkillInfo[]>;
export declare function generateAgentsMd(dir: string, skills: SkillInfo[], systemPrompt?: string, persona?: PersonaConfig): Promise<void>;
export declare function ensureReady(dir: string): Promise<{
    config: GolemConfig;
    skills: SkillInfo[];
}>;
export declare function refreshSkillInjection(dir: string): Promise<boolean>;
export declare function initWorkspace(dir: string, config: GolemConfig, builtinSkillsDir: string): Promise<void>;
/**
 * Generate `.cursor/cli.json` from the permissions config in golem.yaml.
 * This file controls what the Cursor Agent CLI is allowed to do when invoked
 * without `--trust` (i.e. with granular permission enforcement).
 */
export declare function generateCursorCliJson(dir: string, permissions: PermissionsConfig): Promise<void>;
//# sourceMappingURL=workspace.d.ts.map