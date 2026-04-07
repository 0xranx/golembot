import { lstat, mkdir, readdir, symlink, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { debugEventLog, isDebugEventsEnabled, summarizeJsonEventLine } from '../debug-events.js';
import { claudeProviderEnv } from './provider-env.js';
import { prependPathEntries, resolveCliBinary, spawnCommand } from './shared.js';
// ── stream-json event parsing ───────────────────────────
export function parseClaudeStreamLine(line) {
    const trimmed = line.trim();
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
    const sessionId = obj.session_id;
    if (type === 'assistant') {
        const msg = obj.message;
        if (!msg)
            return [];
        const content = msg.content;
        if (!Array.isArray(content))
            return [];
        const events = [];
        for (const block of content) {
            if (block.type === 'text') {
                const text = block.text || '';
                if (text)
                    events.push({ type: 'text', content: text });
            }
            else if (block.type === 'tool_use') {
                const name = block.name || 'unknown';
                const input = block.input ?? {};
                events.push({ type: 'tool_call', name, args: JSON.stringify(input) });
            }
        }
        return events;
    }
    if (type === 'user') {
        const msg = obj.message;
        if (!msg)
            return [];
        const content = msg.content;
        if (!Array.isArray(content))
            return [];
        const events = [];
        for (const block of content) {
            if (block.type === 'tool_result') {
                let resultContent;
                if (typeof block.content === 'string') {
                    resultContent = block.content;
                }
                else if (Array.isArray(block.content)) {
                    resultContent = block.content
                        .filter((b) => b.type === 'text')
                        .map((b) => b.text || '')
                        .join('\n');
                }
                else {
                    resultContent = '';
                }
                events.push({ type: 'tool_result', content: resultContent });
            }
        }
        return events;
    }
    if (type === 'result') {
        const isError = obj.is_error;
        if (isError) {
            const errors = Array.isArray(obj.errors)
                ? obj.errors.map((e) => (typeof e === 'string' ? e : '')).filter((e) => e.trim().length > 0)
                : [];
            const message = obj.result ||
                obj.error ||
                (errors.length > 0 ? errors.join(' | ') : '') ||
                'Agent error';
            return [{ type: 'error', message }];
        }
        const durationMs = typeof obj.duration_ms === 'number' ? obj.duration_ms : undefined;
        const costUsd = typeof obj.total_cost_usd === 'number' ? obj.total_cost_usd : undefined;
        const numTurns = typeof obj.num_turns === 'number' ? obj.num_turns : undefined;
        const fullText = typeof obj.result === 'string' && obj.result ? obj.result : undefined;
        return [{ type: 'done', sessionId, durationMs, costUsd, numTurns, fullText }];
    }
    return [];
}
// ── Skill injection ──────────────────────────────────────
export async function injectClaudeSkills(workspace, skillPaths, _skillDescriptions) {
    const claudeSkillsDir = join(workspace, '.claude', 'skills');
    await mkdir(claudeSkillsDir, { recursive: true });
    try {
        const existing = await readdir(claudeSkillsDir);
        for (const entry of existing) {
            const full = join(claudeSkillsDir, entry);
            const s = await lstat(full).catch(() => null);
            if (s?.isSymbolicLink()) {
                await unlink(full);
            }
        }
    }
    catch {
        // directory might not exist yet
    }
    for (const sp of skillPaths) {
        const name = basename(sp);
        const dest = join(claudeSkillsDir, name);
        try {
            await symlink(resolve(sp), dest);
        }
        catch (e) {
            if (e.code !== 'EEXIST')
                throw e;
        }
    }
    // Symlink CLAUDE.md → AGENTS.md to avoid maintaining duplicate content
    const claudeMdPath = join(workspace, 'CLAUDE.md');
    try {
        const existing = await lstat(claudeMdPath).catch(() => null);
        if (existing)
            await unlink(claudeMdPath);
    }
    catch {
        /* doesn't exist yet */
    }
    try {
        await symlink('AGENTS.md', claudeMdPath);
    }
    catch (e) {
        if (e.code !== 'EEXIST')
            throw e;
    }
}
// ── Engine ───────────────────────────────────────────────
let _warnedSkipPermissions = false;
function findClaudeBin() {
    const localBin = join(homedir(), '.local', 'bin', 'claude');
    const resolved = resolveCliBinary('claude', localBin);
    if (!resolved) {
        throw new Error(`Claude Code CLI ("claude") not found in PATH or at ${localBin}\n` +
            `Install it with: npm install -g @anthropic-ai/claude-code\n` +
            `See: https://code.claude.com/docs/en/overview`);
    }
    return resolved;
}
export class ClaudeCodeEngine {
    async *invoke(prompt, opts) {
        const debugEventsEnabled = isDebugEventsEnabled();
        await injectClaudeSkills(opts.workspace, opts.skillPaths);
        if (opts.mcpConfig && Object.keys(opts.mcpConfig).length > 0) {
            const claudeDir = join(opts.workspace, '.claude');
            await mkdir(claudeDir, { recursive: true });
            const mcpServers = {};
            for (const [name, cfg] of Object.entries(opts.mcpConfig)) {
                mcpServers[name] = { command: cfg.command, args: cfg.args, env: cfg.env };
            }
            await writeFile(join(claudeDir, 'mcp.json'), `${JSON.stringify({ mcpServers }, null, 2)}\n`, 'utf-8');
        }
        const claudeBin = findClaudeBin();
        const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose'];
        if (opts.skipPermissions !== false) {
            args.push('--dangerously-skip-permissions');
            if (!_warnedSkipPermissions) {
                _warnedSkipPermissions = true;
                process.stderr.write('\x1b[33mWarning: running Claude Code with --dangerously-skip-permissions. ' +
                    'Set skipPermissions: false in golem.yaml to require manual approval.\x1b[0m\n');
            }
        }
        if (opts.sessionId)
            args.push('--resume', opts.sessionId);
        // In provider mode, exclude user-level Claude settings (e.g.
        // ~/.claude/settings.json apiKeyHelper / env overrides) so injected
        // provider env vars are authoritative.
        if (opts.provider)
            args.push('--setting-sources', 'project,local');
        // When a custom provider is configured, the model is set via ANTHROPIC_MODEL
        // env var instead of --model flag (which triggers client-side validation
        // against Anthropic's model list and rejects third-party model names).
        if (opts.model && !opts.provider)
            args.push('--model', opts.model);
        const env = {
            ...process.env,
            PATH: prependPathEntries(process.env.PATH, [join(homedir(), '.local', 'bin')]),
        };
        if (opts.provider)
            Object.assign(env, claudeProviderEnv(opts.provider));
        // When provider is set but provider.model is not, the resolved model (from
        // modelOverride or config.model) must still be communicated via env var,
        // since --model flag is suppressed in provider mode.
        if (opts.provider && opts.model && !env.ANTHROPIC_MODEL) {
            env.ANTHROPIC_MODEL = opts.model;
        }
        if (opts.oauthToken) {
            env.CLAUDE_CODE_OAUTH_TOKEN = opts.oauthToken;
            // OAuth token and API key are mutually exclusive; OAuth takes precedence
            delete env.ANTHROPIC_API_KEY;
        }
        else if (opts.apiKey)
            env.ANTHROPIC_API_KEY = opts.apiKey;
        // Allow spawning Claude Code from within a Claude Code session
        delete env.CLAUDECODE;
        delete env.CLAUDE_CODE_ENTRYPOINT;
        const child = spawnCommand(claudeBin, args, {
            cwd: opts.workspace,
            env,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const stderrTail = [];
        const queue = [];
        let resolver = null;
        let buffer = '';
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
                    debugEventLog(debugEventsEnabled, `[event-debug] claude ${summary}`);
                for (const evt of parseClaudeStreamLine(line))
                    enqueue(evt);
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
            const raw = chunk.toString();
            for (const line of raw.split(/\r?\n/)) {
                const trimmed = line.trim();
                if (!trimmed)
                    continue;
                stderrTail.push(trimmed);
                if (stderrTail.length > 20)
                    stderrTail.shift();
            }
        });
        child.on('close', (exitCode) => {
            if (buffer.trim()) {
                buffer += '\n';
                processBuffer();
            }
            const code = exitCode ?? 1;
            if (code !== 0 && !queue.some((e) => e && (e.type === 'done' || e.type === 'error'))) {
                const tail = stderrTail.length > 0 ? `; stderr: ${stderrTail.join(' | ')}` : '';
                enqueue({ type: 'error', message: `Claude Code process exited with code ${code}${tail}` });
            }
            enqueue(null);
        });
        child.on('error', (err) => {
            enqueue({ type: 'error', message: `Failed to start Claude Code: ${err.message}` });
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
    async listModels(opts) {
        const apiKey = opts.apiKey || process.env.ANTHROPIC_API_KEY;
        if (apiKey) {
            try {
                const resp = await fetch('https://api.anthropic.com/v1/models?limit=100', {
                    headers: { 'anthropic-version': '2023-06-01', 'x-api-key': apiKey },
                    signal: AbortSignal.timeout(10_000),
                });
                const data = (await resp.json());
                if (data.data?.length)
                    return data.data.map((m) => m.id).sort();
            }
            catch {
                /* fallback below */
            }
        }
        return ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'];
    }
}
//# sourceMappingURL=claude-code.js.map