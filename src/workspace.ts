import { readFile, readdir, writeFile, mkdir, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import yaml from 'js-yaml';

export interface FeishuChannelConfig {
  appId: string;
  appSecret: string;
  /** When true, send Markdown replies as interactive cards instead of post rich text. */
  sendMarkdownAsCard?: boolean;
}

export interface DingtalkChannelConfig {
  clientId: string;
  clientSecret: string;
}

export interface WecomChannelConfig {
  corpId: string;
  agentId: string;
  secret: string;
  token: string;
  encodingAESKey: string;
  port?: number;
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

export interface ChannelsConfig {
  feishu?: FeishuChannelConfig;
  dingtalk?: DingtalkChannelConfig;
  wecom?: WecomChannelConfig;
  slack?: SlackChannelConfig;
  telegram?: TelegramChannelConfig;
  discord?: DiscordChannelConfig;
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

export interface GolemConfig {
  name: string;
  engine: string;
  model?: string;
  skipPermissions?: boolean;
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
}

export interface SkillInfo {
  name: string;
  path: string;
  description: string;
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
  if (doc.channels && typeof doc.channels === 'object') {
    config.channels = resolveEnvPlaceholders(doc.channels as ChannelsConfig);
  }
  if (doc.gateway && typeof doc.gateway === 'object') {
    config.gateway = resolveEnvPlaceholders(doc.gateway as GatewayConfig);
  }
  if (typeof doc.timeout === 'number') config.timeout = doc.timeout;
  if (typeof doc.maxConcurrent === 'number') config.maxConcurrent = doc.maxConcurrent;
  if (typeof doc.maxQueuePerSession === 'number') config.maxQueuePerSession = doc.maxQueuePerSession;
  if (typeof doc.sessionTtlDays === 'number') config.sessionTtlDays = doc.sessionTtlDays;
  if (typeof doc.systemPrompt === 'string') config.systemPrompt = doc.systemPrompt;
  if (doc.groupChat && typeof doc.groupChat === 'object') {
    config.groupChat = doc.groupChat as GroupChatConfig;
  }

  return config;
}

export async function writeConfig(dir: string, config: GolemConfig): Promise<void> {
  const configPath = join(dir, 'golem.yaml');
  const content: Record<string, unknown> = {
    name: config.name,
    engine: config.engine,
  };
  if (config.model) content.model = config.model;
  if (typeof config.skipPermissions === 'boolean') content.skipPermissions = config.skipPermissions;
  if (config.channels) content.channels = config.channels;
  if (config.gateway) content.gateway = config.gateway;
  if (config.groupChat) content.groupChat = config.groupChat;
  await writeFile(configPath, yaml.dump(content, { lineWidth: -1 }), 'utf-8');
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
      });
    } catch {
      // no SKILL.md — skip this directory
    }
  }
  return skills;
}

export async function generateAgentsMd(dir: string, skills: SkillInfo[], systemPrompt?: string): Promise<void> {
  const skillList = skills.length > 0
    ? skills.map(s => `- ${s.name}: ${s.description}`).join('\n')
    : '- (no skills installed)';

  const systemPromptSection = systemPrompt
    ? `## System Instructions\n${systemPrompt}\n\n`
    : '';

  const content = `# Assistant Context

${systemPromptSection}## Installed Skills
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
  await generateAgentsMd(dir, skills, config.systemPrompt);
  return { config, skills };
}

export async function initWorkspace(
  dir: string,
  config: GolemConfig,
  builtinSkillsDir: string,
): Promise<void> {
  const configPath = join(dir, 'golem.yaml');
  try {
    await stat(configPath);
    throw new Error(`golem.yaml already exists in ${dir}`);
  } catch (e: unknown) {
    if (e instanceof Error && e.message.startsWith('golem.yaml already')) throw e;
  }

  await writeConfig(dir, config);

  const builtinSkills = ['general', 'im-adapter'];
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
  const gitignorePath = join(dir, '.gitignore');
  try {
    await stat(gitignorePath);
  } catch {
    await writeFile(gitignorePath, gitignoreLines.join('\n') + '\n', 'utf-8');
  }
}
