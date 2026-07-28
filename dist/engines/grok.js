import { existsSync } from 'node:fs';
import { lstat, mkdir, readlink, readdir, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { debugEventLog, isDebugEventsEnabled, summarizeJsonEventLine } from '../debug-events.js';
import { grokProviderEnv } from './provider-env.js';
import { prependPathEntries, resolveCliBinary, spawnCommand, stripAnsi } from './shared.js';
// ── Args ─────────────────────────────────────────────────
/**
 * Build CLI args for headless Grok Build:
 *   grok -p <prompt> --output-format streaming-json --cwd <workspace> [--always-approve]
 *        [--resume <sessionId>] [-m <model>]
 */
export function buildGrokArgs(prompt, opts) {
    let finalPrompt = prompt;
    if (opts.imagePaths?.length) {
        const list = opts.imagePaths.map((p) => `- ${p}`).join('\n');
        finalPrompt = `[Attached image files — read them with your tools if needed:\n${list}]\n\n${prompt}`;
    }
    const args = ['-p', finalPrompt, '--output-format', 'streaming-json', '--cwd', opts.workspace];
    // Default: auto-approve tools for unattended IM/gateway use (same spirit as other engines).
    if (opts.skipPermissions !== false) {
        args.push('--always-approve');
    }
    if (opts.sessionId)
        args.push('--resume', opts.sessionId);
    if (opts.model)
        args.push('-m', opts.model);
    return args;
}
// ── streaming-json event parsing ─────────────────────────
/**
 * Parse a single NDJSON line from `grok -p ... --output-format streaming-json`.
 *
 * Documented event shapes:
 *   - { type: "text", data: "..." }
 *   - { type: "thought", data: "..." }
 *   - { type: "end", stopReason: "EndTurn", sessionId: "...", requestId: "..." }
 *   - { type: "error", message: "..." }
 *
 * Also tolerates the non-streaming json object:
 *   - { text: "...", sessionId: "...", stopReason: "EndTurn" }
 *
 * @param state Mutable state; sessionId is stored when seen on end events.
 */
export function parseGrokStreamLine(line, state) {
    const trimmed = stripAnsi(line).trim();
    if (!trimmed || !trimmed.startsWith('{'))
        return [];
    let obj;
    try {
        obj = JSON.parse(trimmed);
    }
    catch {
        return [];
    }
    const type = obj.type;
    if (type === 'text') {
        const data = (typeof obj.data === 'string' ? obj.data : '') || (typeof obj.content === 'string' ? obj.content : '');
        if (data)
            return [{ type: 'text', content: data }];
        return [];
    }
    // Internal reasoning — skip so IM replies stay clean
    if (type === 'thought') {
        return [];
    }
    if (type === 'end') {
        const sessionId = (typeof obj.sessionId === 'string' ? obj.sessionId : undefined) || state.sessionId;
        if (typeof obj.sessionId === 'string')
            state.sessionId = obj.sessionId;
        return [{ type: 'done', sessionId }];
    }
    if (type === 'error') {
        const message = (typeof obj.message === 'string' && obj.message) || 'Grok error';
        return [{ type: 'error', message }];
    }
    // Optional tool events (not always present in headless streaming-json)
    if (type === 'tool_call' || type === 'tool_use') {
        const name = (typeof obj.name === 'string' && obj.name) || 'tool';
        const args = typeof obj.args === 'string'
            ? obj.args
            : obj.input !== undefined
                ? JSON.stringify(obj.input)
                : obj.arguments !== undefined
                    ? JSON.stringify(obj.arguments)
                    : '';
        return [{ type: 'tool_call', name, args }];
    }
    if (type === 'tool_result' || type === 'tool_call_result') {
        const content = (typeof obj.content === 'string' && obj.content) ||
            (typeof obj.data === 'string' && obj.data) ||
            (typeof obj.result === 'string' && obj.result) ||
            '';
        if (content)
            return [{ type: 'tool_result', content }];
        return [];
    }
    if (type === 'max_turns_reached') {
        return [{ type: 'warning', message: 'Grok reached max turns limit' }];
    }
    // Non-streaming --output-format json object on a single line
    if (type === undefined && typeof obj.text === 'string' && (obj.sessionId || obj.stopReason)) {
        const sessionId = typeof obj.sessionId === 'string' ? obj.sessionId : undefined;
        if (sessionId)
            state.sessionId = sessionId;
        const events = [];
        if (obj.text)
            events.push({ type: 'text', content: obj.text });
        events.push({ type: 'done', sessionId, fullText: obj.text || undefined });
        return events;
    }
    return [];
}
// ── Skill injection ──────────────────────────────────────
/** True for symlinks, or Windows directory junctions created by a prior inject. */
async function isManagedSkillLink(path) {
    const s = await lstat(path).catch(() => null);
    if (!s)
        return false;
    if (s.isSymbolicLink())
        return true;
    if (process.platform === 'win32' && s.isDirectory()) {
        try {
            await readlink(path);
            return true;
        }
        catch {
            return false;
        }
    }
    return false;
}
/**
 * Link a skill directory into the engine skills root.
 * On Windows, prefer directory junctions (no elevated symlink privilege required).
 */
async function linkSkillDir(src, dest) {
    const target = resolve(src);
    await rm(dest, { recursive: true, force: true }).catch(() => { });
    if (process.platform === 'win32') {
        await symlink(target, dest, 'junction');
        return;
    }
    await symlink(target, dest);
}
/**
 * Inject GolemBot skills into `.grok/skills/` so Grok Build discovers them natively.
 * AGENTS.md is still generated separately by workspace.ts for persistent instructions.
 */
export async function injectGrokSkills(workspace, skillPaths) {
    const grokSkillsDir = join(workspace, '.grok', 'skills');
    await mkdir(grokSkillsDir, { recursive: true });
    const desired = new Set(skillPaths.map((sp) => basename(sp)));
    try {
        const existing = await readdir(grokSkillsDir);
        for (const entry of existing) {
            if (desired.has(entry))
                continue; // replaced below
            const full = join(grokSkillsDir, entry);
            if (await isManagedSkillLink(full)) {
                await rm(full, { recursive: true, force: true }).catch(async () => {
                    await unlink(full).catch(() => { });
                });
            }
        }
    }
    catch {
        /* directory might not exist yet */
    }
    for (const sp of skillPaths) {
        const name = basename(sp);
        const dest = join(grokSkillsDir, name);
        try {
            await linkSkillDir(sp, dest);
        }
        catch (e) {
            if (e.code !== 'EEXIST')
                throw e;
        }
    }
}
// ── MCP config (project-scoped .grok/config.toml) ────────
function tomlString(value) {
    return JSON.stringify(value);
}
/**
 * Write golem.yaml MCP servers into project-scoped `.grok/config.toml`.
 * Grok loads project MCP from this file (stdio transport).
 */
export async function writeGrokMcpConfig(workspace, mcpConfig) {
    const grokDir = join(workspace, '.grok');
    await mkdir(grokDir, { recursive: true });
    const lines = ['# Generated by GolemBot — MCP servers from golem.yaml', ''];
    for (const [name, cfg] of Object.entries(mcpConfig)) {
        // TOML bare keys: keep simple alphanumerics / _ / -; quote otherwise
        const key = /^[A-Za-z0-9_-]+$/.test(name) ? name : tomlString(name);
        lines.push(`[mcp_servers.${key}]`);
        lines.push(`command = ${tomlString(cfg.command)}`);
        if (cfg.args?.length) {
            lines.push(`args = [${cfg.args.map((a) => tomlString(a)).join(', ')}]`);
        }
        if (cfg.env && Object.keys(cfg.env).length > 0) {
            const pairs = Object.entries(cfg.env)
                .map(([k, v]) => `${/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) ? k : tomlString(k)} = ${tomlString(v)}`)
                .join(', ');
            lines.push(`env = { ${pairs} }`);
        }
        lines.push('enabled = true');
        lines.push('');
    }
    await writeFile(join(grokDir, 'config.toml'), `${lines.join('\n')}\n`, 'utf-8');
}
// ── Engine ───────────────────────────────────────────────
export function findGrokBin() {
    const home = homedir();
    const localCandidates = [
        join(home, '.grok', 'bin', process.platform === 'win32' ? 'grok.exe' : 'grok'),
        join(home, '.local', 'bin', 'grok'),
        join(home, '.grok', 'bin', 'grok'),
    ];
    const existingLocal = localCandidates.find((p) => existsSync(p));
    const resolved = resolveCliBinary('grok', existingLocal);
    if (!resolved) {
        throw new Error(`Grok Build CLI ("grok") not found in PATH or at ~/.grok/bin/grok\n` +
            `Install Grok Build, then ensure "grok" is on PATH.\n` +
            `Auth: grok login  or  set XAI_API_KEY`);
    }
    return resolved;
}
export class GrokEngine {
    async *invoke(prompt, opts) {
        const debugEventsEnabled = isDebugEventsEnabled();
        await injectGrokSkills(opts.workspace, opts.skillPaths);
        if (opts.mcpConfig && Object.keys(opts.mcpConfig).length > 0) {
            await writeGrokMcpConfig(opts.workspace, opts.mcpConfig);
        }
        const bin = findGrokBin();
        const args = buildGrokArgs(prompt, opts);
        const env = {
            ...process.env,
            PATH: prependPathEntries(process.env.PATH, [
                join(homedir(), '.grok', 'bin'),
                join(homedir(), '.local', 'bin'),
            ]),
            // Keep stdout clean for streaming-json parsers
            GROK_DISABLE_AUTOUPDATER: process.env.GROK_DISABLE_AUTOUPDATER || '1',
        };
        if (opts.provider)
            Object.assign(env, grokProviderEnv(opts.provider));
        if (opts.apiKey)
            env.XAI_API_KEY = opts.apiKey;
        const child = spawnCommand(bin, args, {
            cwd: opts.workspace,
            env,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const queue = [];
        let resolver = null;
        let buffer = '';
        const state = {};
        let gotDone = false;
        let gotError = false;
        const stderrChunks = [];
        function enqueue(evt) {
            queue.push(evt);
            if (resolver) {
                resolver();
                resolver = null;
            }
        }
        function processBuffer() {
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
                if (!line.trim())
                    continue;
                const summary = summarizeJsonEventLine(line);
                if (summary)
                    debugEventLog(debugEventsEnabled, `[event-debug] grok ${summary}`);
                for (const evt of parseGrokStreamLine(line, state)) {
                    if (evt.type === 'done') {
                        gotDone = true;
                        enqueue(evt);
                    }
                    else if (evt.type === 'error') {
                        gotError = true;
                        enqueue(evt);
                    }
                    else
                        enqueue(evt);
                }
            }
        }
        if (opts.signal) {
            const abortHandler = () => {
                try {
                    child.kill();
                }
                catch {
                    /* already dead */
                }
                const reason = opts.signal?.reason === 'user' ? 'Agent invocation stopped by user' : 'Agent invocation timed out';
                enqueue({ type: 'error', message: reason });
                enqueue(null);
            };
            opts.signal.addEventListener('abort', abortHandler, { once: true });
            child.once('close', () => opts.signal.removeEventListener('abort', abortHandler));
        }
        child.stdout.on('data', (chunk) => {
            buffer += chunk.toString();
            processBuffer();
        });
        child.stderr.on('data', (chunk) => {
            const text = chunk.toString().trim();
            if (text)
                stderrChunks.push(text);
        });
        child.on('close', (exitCode) => {
            if (buffer.trim()) {
                buffer += '\n';
                processBuffer();
            }
            const code = exitCode ?? 1;
            if (code !== 0 && !gotDone && !gotError) {
                const stderrText = stderrChunks.join('\n').slice(0, 500);
                const detail = stderrText ? `: ${stderrText}` : '';
                enqueue({ type: 'error', message: `Grok process exited with code ${code}${detail}` });
            }
            else if (!gotDone && !gotError) {
                enqueue({ type: 'done', sessionId: state.sessionId });
            }
            enqueue(null);
        });
        child.on('error', (err) => {
            enqueue({ type: 'error', message: `Failed to start Grok: ${err.message}` });
            enqueue(null);
        });
        while (true) {
            if (queue.length === 0)
                await new Promise((r) => {
                    resolver = r;
                });
            while (queue.length > 0) {
                const evt = queue.shift();
                if (evt === null)
                    return;
                yield evt;
                if (evt.type === 'done' || evt.type === 'error') {
                    try {
                        child.kill();
                    }
                    catch {
                        /* already dead */
                    }
                    return;
                }
            }
        }
    }
    async listModels(_opts) {
        const fallback = ['grok-4.5', 'grok-composer-2.5-fast'];
        try {
            const bin = findGrokBin();
            const child = spawnCommand(bin, ['models'], {
                timeout: 15_000,
                stdio: ['ignore', 'pipe', 'pipe'],
                env: {
                    ...process.env,
                    PATH: prependPathEntries(process.env.PATH, [
                        join(homedir(), '.grok', 'bin'),
                        join(homedir(), '.local', 'bin'),
                    ]),
                },
            });
            const stdout = await new Promise((resolvePromise, reject) => {
                let out = '';
                let err = '';
                child.stdout?.on('data', (c) => {
                    out += c.toString();
                });
                child.stderr?.on('data', (c) => {
                    err += c.toString();
                });
                child.on('error', reject);
                child.on('close', (code) => {
                    if (code === 0)
                        resolvePromise(out);
                    else
                        reject(new Error(err || `grok models exited ${code}`));
                });
            });
            // Lines look like: "  * grok-4.5 (default)" or "  - grok-composer-2.5-fast"
            const models = stdout
                .split(/\r?\n/)
                .map((line) => {
                const m = line.match(/^\s*[*•-]\s+(\S+)/);
                return m?.[1];
            })
                .filter((id) => !!id && !id.startsWith('('));
            if (models.length > 0)
                return models;
        }
        catch {
            /* fallback below */
        }
        return fallback;
    }
}
//# sourceMappingURL=grok.js.map