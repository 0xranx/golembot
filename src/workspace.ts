import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import yaml from 'js-yaml';
import type { ScheduledTaskDef, TaskTarget } from './scheduler.js';

export type { HistoryFetchConfig } from './history-fetcher.js';
export type { InboxConfig } from './inbox.js';
export type { ScheduledTaskDef, TaskTarget } from './scheduler.js';

export const DEFAULT_TIMEOUT_SECONDS = 600;

export interface FeishuChannelConfig {
  appId: string;
  appSecret: string;
  /** Open platform domain. Use `lark` for Lark global tenants. Default: `feishu`. */
  domain?: string;
  /** WebSocket pong timeout in seconds. Default: 30. Set 0 to disable the SDK watchdog. */
  pingTimeout?: number;
}

export interface DingtalkChannelConfig {
  clientId: string;
  clientSecret: string;
  /**
   * Robot code for the media download API (POST /v1.0/robot/messageFiles/download).
   * Defaults to the robotCode field in the message callback, falling back to clientId
   * (they are identical for enterprise internal robots).
   */
  robotCode?: string;
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
  /** Optional allowlist of Telegram sender IDs. When set, messages from other users are ignored. */
  allowedUserIds?: string[];
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
  /** Agent invocation timeout in seconds. Default: 600 (10 minutes). */
  timeout?: number;
  /**
   * Max auto-continue relay rounds per user message (gateway/IM only).
   * When > 0, a turn-end contract is injected so the agent signals unfinished
   * work with a trailing [CONTINUE] line, and the gateway mechanically
   * re-invokes it. 0 disables. Default: 5.
   */
  autoContinue?: number;
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
export function resolveEnvPlaceholders<T>(obj: T): T {
  if (typeof obj === 'string') {
    return obj.replace(/\$\{([^}]+)\}/g, (_m, key: string) => {
      return process.env[key] ?? `\${${key}}`;
    }) as unknown as T;
  }
  if (Array.isArray(obj)) {
    return obj.map(resolveEnvPlaceholders) as unknown as T;
  }
  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = resolveEnvPlaceholders(v);
    }
    return result as T;
  }
  return obj;
}

export async function loadConfig(dir: string): Promise<GolemConfig> {
  const configPath = join(dir, 'golem.yaml');
  const raw = await readFile(configPath, 'utf-8');
  const doc = yaml.load(raw) as Record<string, unknown>;
  if (!doc || typeof doc.name !== 'string' || typeof doc.engine !== 'string') {
    throw new Error(`Invalid golem.yaml: must have 'name' and 'engine' fields`);
  }

  const config: GolemConfig = {
    name: doc.name,
    engine: doc.engine,
    model: typeof doc.model === 'string' ? doc.model : undefined,
  };

  if (typeof doc.skipPermissions === 'boolean') {
    config.skipPermissions = doc.skipPermissions;
  }
  if (doc.codex && typeof doc.codex === 'object') {
    const codexDoc = resolveEnvPlaceholders(doc.codex as Record<string, unknown>);
    const codex: CodexConfig = {};
    if (codexDoc.mode === 'safe' || codexDoc.mode === 'unrestricted') {
      codex.mode = codexDoc.mode;
    }
    if (
      codexDoc.sandbox === 'read-only' ||
      codexDoc.sandbox === 'workspace-write' ||
      codexDoc.sandbox === 'danger-full-access'
    ) {
      codex.sandbox = codexDoc.sandbox;
    }
    if (codexDoc.approval === 'untrusted' || codexDoc.approval === 'on-request' || codexDoc.approval === 'never') {
      codex.approval = codexDoc.approval;
    }
    if (typeof codexDoc.search === 'boolean') {
      codex.search = codexDoc.search;
    }
    if (Array.isArray(codexDoc.addDirs)) {
      codex.addDirs = codexDoc.addDirs.filter((dir): dir is string => typeof dir === 'string');
    }
    if (Object.keys(codex).length > 0) config.codex = codex;
  }
  if (doc.channels && typeof doc.channels === 'object') {
    config.channels = resolveEnvPlaceholders(doc.channels as ChannelsConfig);
  }
  if (doc.gateway && typeof doc.gateway === 'object') {
    config.gateway = resolveEnvPlaceholders(doc.gateway as GatewayConfig);
  }
  if (typeof doc.timeout === 'number') config.timeout = doc.timeout;
  if (typeof doc.autoContinue === 'number') config.autoContinue = doc.autoContinue;
  if (typeof doc.maxConcurrent === 'number') config.maxConcurrent = doc.maxConcurrent;
  if (typeof doc.maxQueuePerSession === 'number') config.maxQueuePerSession = doc.maxQueuePerSession;
  if (typeof doc.sessionTtlDays === 'number') config.sessionTtlDays = doc.sessionTtlDays;
  if (typeof doc.systemPrompt === 'string') config.systemPrompt = doc.systemPrompt;
  if (doc.groupChat && typeof doc.groupChat === 'object') {
    config.groupChat = doc.groupChat as GroupChatConfig;
  }
  if (doc.streaming && typeof doc.streaming === 'object') {
    config.streaming = doc.streaming as StreamingConfig;
  }
  if (doc.permissions && typeof doc.permissions === 'object') {
    config.permissions = doc.permissions as PermissionsConfig;
  }
  if (doc.provider && typeof doc.provider === 'object') {
    const provider = resolveEnvPlaceholders(doc.provider as ProviderConfig);
    // Guard against nested fallback chains (fallback.fallback.fallback...).
    // Only one level of fallback is supported; strip any deeper nesting here
    // so runtime code never has to defend against it.
    if (provider.fallback) {
      const { fallback: _nested, ...cleanFallback } = provider.fallback;
      provider.fallback = cleanFallback as ProviderConfig;
    }
    config.provider = provider;
  }
  if (typeof doc.oauthToken === 'string') {
    config.oauthToken = resolveEnvPlaceholders(doc.oauthToken);
  }
  if (doc.historyFetch && typeof doc.historyFetch === 'object') {
    const hf = doc.historyFetch as Record<string, unknown>;
    config.historyFetch = {
      enabled: typeof hf.enabled === 'boolean' ? hf.enabled : undefined,
      pollIntervalMinutes: typeof hf.pollIntervalMinutes === 'number' ? hf.pollIntervalMinutes : undefined,
      initialLookbackMinutes: typeof hf.initialLookbackMinutes === 'number' ? hf.initialLookbackMinutes : undefined,
    };
  }
  if (doc.persona && typeof doc.persona === 'object') {
    const p = doc.persona as Record<string, unknown>;
    config.persona = {
      displayName: typeof p.displayName === 'string' ? p.displayName : undefined,
      role: typeof p.role === 'string' ? p.role : undefined,
      tone: typeof p.tone === 'string' ? p.tone : undefined,
      boundaries: Array.isArray(p.boundaries) ? (p.boundaries as string[]) : undefined,
    };
  }
  if (doc.escalation && typeof doc.escalation === 'object') {
    const esc = doc.escalation as Record<string, unknown>;
    config.escalation = {
      target:
        esc.target && typeof esc.target === 'object' ? resolveEnvPlaceholders(esc.target as TaskTarget) : undefined,
      enabled: typeof esc.enabled === 'boolean' ? esc.enabled : undefined,
    };
  }
  if (doc.mcp && typeof doc.mcp === 'object') {
    config.mcp = resolveEnvPlaceholders(doc.mcp as Record<string, McpServerConfig>);
  }
  if (doc.inbox && typeof doc.inbox === 'object') {
    const inbox = doc.inbox as Record<string, unknown>;
    config.inbox = {
      enabled: typeof inbox.enabled === 'boolean' ? inbox.enabled : undefined,
      retentionDays: typeof inbox.retentionDays === 'number' ? inbox.retentionDays : undefined,
    };
  }
  if (Array.isArray(doc.tasks)) {
    config.tasks = (doc.tasks as Record<string, unknown>[]).map((t, i) => ({
      id: typeof t.id === 'string' ? t.id : '',
      name: typeof t.name === 'string' ? t.name : `task-${i}`,
      schedule: typeof t.schedule === 'string' ? t.schedule : '',
      prompt: typeof t.prompt === 'string' ? t.prompt : '',
      target: t.target && typeof t.target === 'object' ? resolveEnvPlaceholders(t.target as TaskTarget) : undefined,
      enabled: typeof t.enabled === 'boolean' ? t.enabled : true,
      timeout: typeof t.timeout === 'number' ? t.timeout : undefined,
    }));
  }

  return config;
}

/**
 * Patch specific fields in golem.yaml without losing unknown fields or expanding
 * `${ENV_VAR}` placeholders. This is the safe way to update config at runtime.
 */
export async function patchConfig(dir: string, patch: Partial<Pick<GolemConfig, 'engine' | 'model'>>): Promise<void> {
  const configPath = join(dir, 'golem.yaml');
  let raw = await readFile(configPath, 'utf-8');

  for (const [key, value] of Object.entries(patch)) {
    // Match top-level YAML key (not indented) — e.g. "engine: opencode"
    const re = new RegExp(`^${key}:.*$`, 'm');
    if (value !== undefined) {
      if (re.test(raw)) {
        raw = raw.replace(re, `${key}: ${value}`);
      } else {
        // Key doesn't exist yet — insert after the first line (name: ...)
        const idx = raw.indexOf('\n');
        raw =
          idx >= 0 ? `${raw.slice(0, idx + 1)}${key}: ${value}\n${raw.slice(idx + 1)}` : `${raw}\n${key}: ${value}\n`;
      }
    } else {
      // undefined = remove the key entirely
      raw = raw.replace(new RegExp(`^${key}:.*\n?`, 'm'), '');
    }
  }

  await writeFile(configPath, raw, 'utf-8');
}

export async function writeConfig(dir: string, config: GolemConfig): Promise<void> {
  const configPath = join(dir, 'golem.yaml');
  const content: Record<string, unknown> = {
    name: config.name,
    engine: config.engine,
  };
  if (config.model) content.model = config.model;
  if (typeof config.skipPermissions === 'boolean') content.skipPermissions = config.skipPermissions;
  if (config.codex && Object.keys(config.codex).length > 0) content.codex = config.codex;
  if (config.channels) content.channels = config.channels;
  if (config.gateway) content.gateway = config.gateway;
  if (typeof config.timeout === 'number') content.timeout = config.timeout;
  if (typeof config.autoContinue === 'number') content.autoContinue = config.autoContinue;
  if (typeof config.maxConcurrent === 'number') content.maxConcurrent = config.maxConcurrent;
  if (typeof config.maxQueuePerSession === 'number') content.maxQueuePerSession = config.maxQueuePerSession;
  if (typeof config.sessionTtlDays === 'number') content.sessionTtlDays = config.sessionTtlDays;
  if (config.systemPrompt) content.systemPrompt = config.systemPrompt;
  if (config.groupChat) content.groupChat = config.groupChat;
  if (config.streaming) content.streaming = config.streaming;
  if (config.permissions) content.permissions = config.permissions;
  if (config.tasks) content.tasks = config.tasks;
  if (config.provider) content.provider = config.provider;
  if (config.inbox) content.inbox = config.inbox;
  if (config.historyFetch) content.historyFetch = config.historyFetch;
  if (config.persona) content.persona = config.persona;
  if (config.mcp) content.mcp = config.mcp;
  if (config.escalation) content.escalation = config.escalation;
  await writeFile(configPath, yaml.dump(content, { lineWidth: -1 }), 'utf-8');
}

// Fields that require a gateway restart when changed
const RESTART_REQUIRED_KEYS = new Set(['engine', 'model', 'codex', 'channels', 'gateway', 'mcp']);

function needsRestart(patch: Record<string, unknown>): boolean {
  for (const key of Object.keys(patch)) {
    if (RESTART_REQUIRED_KEYS.has(key)) return true;
    // provider.baseUrl, provider.apiKey, provider.fallback require restart
    if (key === 'provider' && typeof patch[key] === 'object' && patch[key]) {
      const provPatch = patch[key] as Record<string, unknown>;
      if ('baseUrl' in provPatch || 'apiKey' in provPatch || 'fallback' in provPatch) return true;
    }
  }
  return false;
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const [key, val] of Object.entries(source)) {
    if (
      val !== undefined &&
      val !== null &&
      typeof val === 'object' &&
      !Array.isArray(val) &&
      typeof result[key] === 'object' &&
      result[key] &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(result[key] as Record<string, unknown>, val as Record<string, unknown>);
    } else {
      result[key] = val;
    }
  }
  return result;
}

/**
 * Deep-merge a partial config patch into the existing golem.yaml and write it back.
 * Returns the new config and whether a restart is needed for the changes to take effect.
 */
export async function patchConfigFull(
  dir: string,
  patch: Record<string, unknown>,
): Promise<{ config: GolemConfig; needsRestart: boolean }> {
  const existing = await loadConfig(dir);
  const merged = deepMerge(existing as unknown as Record<string, unknown>, patch) as unknown as GolemConfig;

  // Validate required fields
  if (!merged.name) throw new Error('Config validation failed: "name" is required');
  if (!merged.engine) throw new Error('Config validation failed: "engine" is required');

  await writeConfig(dir, merged);
  return { config: merged, needsRestart: needsRestart(patch) };
}

function extractFrontMatter(content: string): Record<string, string> {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return {};
  try {
    return (yaml.load(match[1]) as Record<string, string>) || {};
  } catch {
    return {};
  }
}

export async function scanSkills(dir: string): Promise<SkillInfo[]> {
  const skillsDir = join(dir, 'skills');
  let entries: string[];
  try {
    entries = await readdir(skillsDir);
  } catch {
    return [];
  }

  const skills: SkillInfo[] = [];
  for (const entry of entries) {
    const skillDir = join(skillsDir, entry);
    const s = await stat(skillDir).catch(() => null);
    if (!s?.isDirectory()) continue;

    const skillMd = join(skillDir, 'SKILL.md');
    try {
      const content = await readFile(skillMd, 'utf-8');
      const fm = extractFrontMatter(content);
      skills.push({
        name: basename(skillDir),
        path: skillDir,
        description: fm.description || fm.name || basename(skillDir),
        type: fm.type || undefined,
      });
    } catch {
      // no SKILL.md — skip this directory
    }
  }
  return skills;
}

export async function generateAgentsMd(
  dir: string,
  skills: SkillInfo[],
  systemPrompt?: string,
  persona?: PersonaConfig,
): Promise<void> {
  let skillList: string;
  if (skills.length === 0) {
    skillList = '- (no skills installed)';
  } else if (skills.some((s) => s.type)) {
    // Group by type when at least one skill has a type
    const grouped = new Map<string, SkillInfo[]>();
    for (const s of skills) {
      const key = s.type || 'other';
      const list = grouped.get(key) || [];
      list.push(s);
      grouped.set(key, list);
    }
    skillList = [...grouped.entries()]
      .map(([type, items]) => `### ${type}\n${items.map((s) => `- ${s.name}: ${s.description}`).join('\n')}`)
      .join('\n\n');
  } else {
    skillList = skills.map((s) => `- ${s.name}: ${s.description}`).join('\n');
  }

  let personaSection = '';
  if (persona && (persona.displayName || persona.role)) {
    const lines: string[] = [];
    if (persona.displayName) lines.push(`- Display Name: ${persona.displayName}`);
    if (persona.role) lines.push(`- Role: ${persona.role}`);
    if (persona.tone) lines.push(`- Tone: ${persona.tone}`);
    if (persona.boundaries?.length) {
      lines.push('- Boundaries:');
      for (const b of persona.boundaries) lines.push(`  - ${b}`);
    }
    personaSection = `## Persona\n${lines.join('\n')}\n\n`;
  }

  const systemPromptSection = systemPrompt ? `## System Instructions\n${systemPrompt}\n\n` : '';

  const content = `# Assistant Context

${personaSection}${systemPromptSection}## Installed Skills
${skillList}

## Directory Structure
- skills/ — Skills directory (each subdirectory is a skill, containing SKILL.md and optional scripts)
- AGENTS.md — This file, auto-generated by Golem

## Conventions
- Write persistent information to notes.md
- Save generated reports/files in the appropriate directory
`;

  await writeFile(join(dir, 'AGENTS.md'), content, 'utf-8');
}

export async function ensureReady(dir: string): Promise<{
  config: GolemConfig;
  skills: SkillInfo[];
}> {
  const config = await loadConfig(dir);
  const skills = await scanSkills(dir);
  await generateAgentsMd(dir, skills, config.systemPrompt, config.persona);
  return { config, skills };
}

/**
 * Re-scan skills and regenerate AGENTS.md if the skills directory has changed.
 *
 * Compares the skills directory mtime against a cached timestamp.
 * Returns true if AGENTS.md was regenerated, false if no change detected.
 */
const _skillsMtimeCache = new Map<string, number>();

export async function refreshSkillInjection(dir: string): Promise<boolean> {
  const skillsDir = join(dir, 'skills');
  let mtime: number;
  try {
    const s = await stat(skillsDir);
    mtime = s.mtimeMs;
  } catch {
    return false; // no skills directory
  }

  const cached = _skillsMtimeCache.get(dir);
  if (cached !== undefined && cached >= mtime) {
    return false; // no change
  }

  // Check individual skill subdirectories for deeper change detection
  let maxMtime = mtime;
  try {
    const entries = await readdir(skillsDir);
    for (const entry of entries) {
      try {
        const s = await stat(join(skillsDir, entry));
        if (s.mtimeMs > maxMtime) maxMtime = s.mtimeMs;
      } catch {
        /* skip */
      }
    }
  } catch {
    /* use directory mtime */
  }

  if (cached !== undefined && cached >= maxMtime) {
    return false;
  }

  const config = await loadConfig(dir);
  const skills = await scanSkills(dir);
  await generateAgentsMd(dir, skills, config.systemPrompt, config.persona);
  _skillsMtimeCache.set(dir, maxMtime);
  return true;
}

export async function initWorkspace(dir: string, config: GolemConfig, builtinSkillsDir: string): Promise<void> {
  const configPath = join(dir, 'golem.yaml');
  try {
    await stat(configPath);
    throw new Error(`golem.yaml already exists in ${dir}`);
  } catch (e: unknown) {
    if (e instanceof Error && e.message.startsWith('golem.yaml already')) throw e;
  }

  await writeConfig(dir, config);

  const builtinSkills = ['general', 'im-adapter', 'multi-bot', 'message-push'];
  for (const skillName of builtinSkills) {
    const skillDest = join(dir, 'skills', skillName);
    await mkdir(skillDest, { recursive: true });
    const srcPath = join(builtinSkillsDir, skillName, 'SKILL.md');
    try {
      const skillContent = await readFile(srcPath, 'utf-8');
      await writeFile(join(skillDest, 'SKILL.md'), skillContent, 'utf-8');
    } catch {
      if (skillName === 'general') {
        await writeFile(
          join(skillDest, 'SKILL.md'),
          '---\nname: general\ndescription: General personal assistant\n---\n\n# General Assistant\n\nYou are a general-purpose personal AI assistant.\n',
          'utf-8',
        );
      }
    }
  }

  const golemDir = join(dir, '.golem');
  await mkdir(golemDir, { recursive: true });

  const skills = await scanSkills(dir);
  await generateAgentsMd(dir, skills);

  const gitignoreLines = ['.golem/'];
  if (config.engine === 'opencode') gitignoreLines.push('.opencode/');
  if (config.engine === 'codex') gitignoreLines.push('.codex/');
  // Project-scoped Grok config/skills are regenerated; keep local-only noise out of git.
  if (config.engine === 'grok') gitignoreLines.push('.grok/');
  const gitignorePath = join(dir, '.gitignore');
  try {
    await stat(gitignorePath);
  } catch {
    await writeFile(gitignorePath, `${gitignoreLines.join('\n')}\n`, 'utf-8');
  }

  if (config.permissions) {
    await generateCursorCliJson(dir, config.permissions);
  }
}

/**
 * Generate `.cursor/cli.json` from the permissions config in golem.yaml.
 * This file controls what the Cursor Agent CLI is allowed to do when invoked
 * without `--trust` (i.e. with granular permission enforcement).
 */
export async function generateCursorCliJson(dir: string, permissions: PermissionsConfig): Promise<void> {
  const cursorDir = join(dir, '.cursor');
  await mkdir(cursorDir, { recursive: true });

  const cliConfig: Record<string, unknown> = {};
  const perms: Record<string, unknown> = {};

  if (permissions.allowedPaths?.length) {
    perms.allowedDirectories = permissions.allowedPaths;
  }
  if (permissions.deniedPaths?.length) {
    perms.deniedDirectories = permissions.deniedPaths;
  }
  if (permissions.allowedCommands?.length) {
    perms.allowedCommands = permissions.allowedCommands;
  }
  if (permissions.deniedCommands?.length) {
    perms.deniedCommands = permissions.deniedCommands;
  }

  if (Object.keys(perms).length > 0) {
    cliConfig.permissions = perms;
  }

  await writeFile(join(cursorDir, 'cli.json'), `${JSON.stringify(cliConfig, null, 2)}\n`, 'utf-8');
}
