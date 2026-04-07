import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import yaml from 'js-yaml';
/**
 * Recursively resolve `${ENV_VAR}` placeholders in string values.
 * Non-string values and missing env vars are left unchanged.
 */
export function resolveEnvPlaceholders(obj) {
    if (typeof obj === 'string') {
        return obj.replace(/\$\{([^}]+)\}/g, (_m, key) => {
            return process.env[key] ?? `\${${key}}`;
        });
    }
    if (Array.isArray(obj)) {
        return obj.map(resolveEnvPlaceholders);
    }
    if (obj && typeof obj === 'object') {
        const result = {};
        for (const [k, v] of Object.entries(obj)) {
            result[k] = resolveEnvPlaceholders(v);
        }
        return result;
    }
    return obj;
}
export async function loadConfig(dir) {
    const configPath = join(dir, 'golem.yaml');
    const raw = await readFile(configPath, 'utf-8');
    const doc = yaml.load(raw);
    if (!doc || typeof doc.name !== 'string' || typeof doc.engine !== 'string') {
        throw new Error(`Invalid golem.yaml: must have 'name' and 'engine' fields`);
    }
    const config = {
        name: doc.name,
        engine: doc.engine,
        model: typeof doc.model === 'string' ? doc.model : undefined,
    };
    if (typeof doc.skipPermissions === 'boolean') {
        config.skipPermissions = doc.skipPermissions;
    }
    if (doc.codex && typeof doc.codex === 'object') {
        const codexDoc = resolveEnvPlaceholders(doc.codex);
        const codex = {};
        if (codexDoc.mode === 'safe' || codexDoc.mode === 'unrestricted') {
            codex.mode = codexDoc.mode;
        }
        if (codexDoc.sandbox === 'read-only' ||
            codexDoc.sandbox === 'workspace-write' ||
            codexDoc.sandbox === 'danger-full-access') {
            codex.sandbox = codexDoc.sandbox;
        }
        if (codexDoc.approval === 'untrusted' || codexDoc.approval === 'on-request' || codexDoc.approval === 'never') {
            codex.approval = codexDoc.approval;
        }
        if (typeof codexDoc.search === 'boolean') {
            codex.search = codexDoc.search;
        }
        if (Array.isArray(codexDoc.addDirs)) {
            codex.addDirs = codexDoc.addDirs.filter((dir) => typeof dir === 'string');
        }
        if (Object.keys(codex).length > 0)
            config.codex = codex;
    }
    if (doc.channels && typeof doc.channels === 'object') {
        config.channels = resolveEnvPlaceholders(doc.channels);
    }
    if (doc.gateway && typeof doc.gateway === 'object') {
        config.gateway = resolveEnvPlaceholders(doc.gateway);
    }
    if (typeof doc.timeout === 'number')
        config.timeout = doc.timeout;
    if (typeof doc.maxConcurrent === 'number')
        config.maxConcurrent = doc.maxConcurrent;
    if (typeof doc.maxQueuePerSession === 'number')
        config.maxQueuePerSession = doc.maxQueuePerSession;
    if (typeof doc.sessionTtlDays === 'number')
        config.sessionTtlDays = doc.sessionTtlDays;
    if (typeof doc.systemPrompt === 'string')
        config.systemPrompt = doc.systemPrompt;
    if (doc.groupChat && typeof doc.groupChat === 'object') {
        config.groupChat = doc.groupChat;
    }
    if (doc.streaming && typeof doc.streaming === 'object') {
        config.streaming = doc.streaming;
    }
    if (doc.permissions && typeof doc.permissions === 'object') {
        config.permissions = doc.permissions;
    }
    if (doc.provider && typeof doc.provider === 'object') {
        const provider = resolveEnvPlaceholders(doc.provider);
        // Guard against nested fallback chains (fallback.fallback.fallback...).
        // Only one level of fallback is supported; strip any deeper nesting here
        // so runtime code never has to defend against it.
        if (provider.fallback) {
            const { fallback: _nested, ...cleanFallback } = provider.fallback;
            provider.fallback = cleanFallback;
        }
        config.provider = provider;
    }
    if (typeof doc.oauthToken === 'string') {
        config.oauthToken = resolveEnvPlaceholders(doc.oauthToken);
    }
    if (doc.historyFetch && typeof doc.historyFetch === 'object') {
        const hf = doc.historyFetch;
        config.historyFetch = {
            enabled: typeof hf.enabled === 'boolean' ? hf.enabled : undefined,
            pollIntervalMinutes: typeof hf.pollIntervalMinutes === 'number' ? hf.pollIntervalMinutes : undefined,
            initialLookbackMinutes: typeof hf.initialLookbackMinutes === 'number' ? hf.initialLookbackMinutes : undefined,
        };
    }
    if (doc.persona && typeof doc.persona === 'object') {
        const p = doc.persona;
        config.persona = {
            displayName: typeof p.displayName === 'string' ? p.displayName : undefined,
            role: typeof p.role === 'string' ? p.role : undefined,
            tone: typeof p.tone === 'string' ? p.tone : undefined,
            boundaries: Array.isArray(p.boundaries) ? p.boundaries : undefined,
        };
    }
    if (doc.escalation && typeof doc.escalation === 'object') {
        const esc = doc.escalation;
        config.escalation = {
            target: esc.target && typeof esc.target === 'object' ? resolveEnvPlaceholders(esc.target) : undefined,
            enabled: typeof esc.enabled === 'boolean' ? esc.enabled : undefined,
        };
    }
    if (doc.mcp && typeof doc.mcp === 'object') {
        config.mcp = resolveEnvPlaceholders(doc.mcp);
    }
    if (doc.inbox && typeof doc.inbox === 'object') {
        const inbox = doc.inbox;
        config.inbox = {
            enabled: typeof inbox.enabled === 'boolean' ? inbox.enabled : undefined,
            retentionDays: typeof inbox.retentionDays === 'number' ? inbox.retentionDays : undefined,
        };
    }
    if (Array.isArray(doc.tasks)) {
        config.tasks = doc.tasks.map((t, i) => ({
            id: typeof t.id === 'string' ? t.id : '',
            name: typeof t.name === 'string' ? t.name : `task-${i}`,
            schedule: typeof t.schedule === 'string' ? t.schedule : '',
            prompt: typeof t.prompt === 'string' ? t.prompt : '',
            target: t.target && typeof t.target === 'object' ? resolveEnvPlaceholders(t.target) : undefined,
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
export async function patchConfig(dir, patch) {
    const configPath = join(dir, 'golem.yaml');
    let raw = await readFile(configPath, 'utf-8');
    for (const [key, value] of Object.entries(patch)) {
        // Match top-level YAML key (not indented) — e.g. "engine: opencode"
        const re = new RegExp(`^${key}:.*$`, 'm');
        if (value !== undefined) {
            if (re.test(raw)) {
                raw = raw.replace(re, `${key}: ${value}`);
            }
            else {
                // Key doesn't exist yet — insert after the first line (name: ...)
                const idx = raw.indexOf('\n');
                raw =
                    idx >= 0 ? `${raw.slice(0, idx + 1)}${key}: ${value}\n${raw.slice(idx + 1)}` : `${raw}\n${key}: ${value}\n`;
            }
        }
        else {
            // undefined = remove the key entirely
            raw = raw.replace(new RegExp(`^${key}:.*\n?`, 'm'), '');
        }
    }
    await writeFile(configPath, raw, 'utf-8');
}
export async function writeConfig(dir, config) {
    const configPath = join(dir, 'golem.yaml');
    const content = {
        name: config.name,
        engine: config.engine,
    };
    if (config.model)
        content.model = config.model;
    if (typeof config.skipPermissions === 'boolean')
        content.skipPermissions = config.skipPermissions;
    if (config.codex && Object.keys(config.codex).length > 0)
        content.codex = config.codex;
    if (config.channels)
        content.channels = config.channels;
    if (config.gateway)
        content.gateway = config.gateway;
    if (typeof config.timeout === 'number')
        content.timeout = config.timeout;
    if (typeof config.maxConcurrent === 'number')
        content.maxConcurrent = config.maxConcurrent;
    if (typeof config.maxQueuePerSession === 'number')
        content.maxQueuePerSession = config.maxQueuePerSession;
    if (typeof config.sessionTtlDays === 'number')
        content.sessionTtlDays = config.sessionTtlDays;
    if (config.systemPrompt)
        content.systemPrompt = config.systemPrompt;
    if (config.groupChat)
        content.groupChat = config.groupChat;
    if (config.streaming)
        content.streaming = config.streaming;
    if (config.permissions)
        content.permissions = config.permissions;
    if (config.tasks)
        content.tasks = config.tasks;
    if (config.provider)
        content.provider = config.provider;
    if (config.inbox)
        content.inbox = config.inbox;
    if (config.historyFetch)
        content.historyFetch = config.historyFetch;
    if (config.persona)
        content.persona = config.persona;
    if (config.mcp)
        content.mcp = config.mcp;
    if (config.escalation)
        content.escalation = config.escalation;
    await writeFile(configPath, yaml.dump(content, { lineWidth: -1 }), 'utf-8');
}
// Fields that require a gateway restart when changed
const RESTART_REQUIRED_KEYS = new Set(['engine', 'model', 'codex', 'channels', 'gateway', 'mcp']);
function needsRestart(patch) {
    for (const key of Object.keys(patch)) {
        if (RESTART_REQUIRED_KEYS.has(key))
            return true;
        // provider.baseUrl, provider.apiKey, provider.fallback require restart
        if (key === 'provider' && typeof patch[key] === 'object' && patch[key]) {
            const provPatch = patch[key];
            if ('baseUrl' in provPatch || 'apiKey' in provPatch || 'fallback' in provPatch)
                return true;
        }
    }
    return false;
}
function deepMerge(target, source) {
    const result = { ...target };
    for (const [key, val] of Object.entries(source)) {
        if (val !== undefined &&
            val !== null &&
            typeof val === 'object' &&
            !Array.isArray(val) &&
            typeof result[key] === 'object' &&
            result[key] &&
            !Array.isArray(result[key])) {
            result[key] = deepMerge(result[key], val);
        }
        else {
            result[key] = val;
        }
    }
    return result;
}
/**
 * Deep-merge a partial config patch into the existing golem.yaml and write it back.
 * Returns the new config and whether a restart is needed for the changes to take effect.
 */
export async function patchConfigFull(dir, patch) {
    const existing = await loadConfig(dir);
    const merged = deepMerge(existing, patch);
    // Validate required fields
    if (!merged.name)
        throw new Error('Config validation failed: "name" is required');
    if (!merged.engine)
        throw new Error('Config validation failed: "engine" is required');
    await writeConfig(dir, merged);
    return { config: merged, needsRestart: needsRestart(patch) };
}
function extractFrontMatter(content) {
    const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!match)
        return {};
    try {
        return yaml.load(match[1]) || {};
    }
    catch {
        return {};
    }
}
export async function scanSkills(dir) {
    const skillsDir = join(dir, 'skills');
    let entries;
    try {
        entries = await readdir(skillsDir);
    }
    catch {
        return [];
    }
    const skills = [];
    for (const entry of entries) {
        const skillDir = join(skillsDir, entry);
        const s = await stat(skillDir).catch(() => null);
        if (!s?.isDirectory())
            continue;
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
        }
        catch {
            // no SKILL.md — skip this directory
        }
    }
    return skills;
}
export async function generateAgentsMd(dir, skills, systemPrompt, persona) {
    let skillList;
    if (skills.length === 0) {
        skillList = '- (no skills installed)';
    }
    else if (skills.some((s) => s.type)) {
        // Group by type when at least one skill has a type
        const grouped = new Map();
        for (const s of skills) {
            const key = s.type || 'other';
            const list = grouped.get(key) || [];
            list.push(s);
            grouped.set(key, list);
        }
        skillList = [...grouped.entries()]
            .map(([type, items]) => `### ${type}\n${items.map((s) => `- ${s.name}: ${s.description}`).join('\n')}`)
            .join('\n\n');
    }
    else {
        skillList = skills.map((s) => `- ${s.name}: ${s.description}`).join('\n');
    }
    let personaSection = '';
    if (persona && (persona.displayName || persona.role)) {
        const lines = [];
        if (persona.displayName)
            lines.push(`- Display Name: ${persona.displayName}`);
        if (persona.role)
            lines.push(`- Role: ${persona.role}`);
        if (persona.tone)
            lines.push(`- Tone: ${persona.tone}`);
        if (persona.boundaries?.length) {
            lines.push('- Boundaries:');
            for (const b of persona.boundaries)
                lines.push(`  - ${b}`);
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
export async function ensureReady(dir) {
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
const _skillsMtimeCache = new Map();
export async function refreshSkillInjection(dir) {
    const skillsDir = join(dir, 'skills');
    let mtime;
    try {
        const s = await stat(skillsDir);
        mtime = s.mtimeMs;
    }
    catch {
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
                if (s.mtimeMs > maxMtime)
                    maxMtime = s.mtimeMs;
            }
            catch {
                /* skip */
            }
        }
    }
    catch {
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
export async function initWorkspace(dir, config, builtinSkillsDir) {
    const configPath = join(dir, 'golem.yaml');
    try {
        await stat(configPath);
        throw new Error(`golem.yaml already exists in ${dir}`);
    }
    catch (e) {
        if (e instanceof Error && e.message.startsWith('golem.yaml already'))
            throw e;
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
        }
        catch {
            if (skillName === 'general') {
                await writeFile(join(skillDest, 'SKILL.md'), '---\nname: general\ndescription: General personal assistant\n---\n\n# General Assistant\n\nYou are a general-purpose personal AI assistant.\n', 'utf-8');
            }
        }
    }
    const golemDir = join(dir, '.golem');
    await mkdir(golemDir, { recursive: true });
    const skills = await scanSkills(dir);
    await generateAgentsMd(dir, skills);
    const gitignoreLines = ['.golem/'];
    if (config.engine === 'opencode')
        gitignoreLines.push('.opencode/');
    if (config.engine === 'codex')
        gitignoreLines.push('.codex/');
    const gitignorePath = join(dir, '.gitignore');
    try {
        await stat(gitignorePath);
    }
    catch {
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
export async function generateCursorCliJson(dir, permissions) {
    const cursorDir = join(dir, '.cursor');
    await mkdir(cursorDir, { recursive: true });
    const cliConfig = {};
    const perms = {};
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
//# sourceMappingURL=workspace.js.map