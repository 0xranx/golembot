import { lstat, mkdir, readdir, symlink, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { debugEventLog, isDebugEventsEnabled, summarizeJsonEventLine } from '../debug-events.js';
import { cursorProviderEnv } from './provider-env.js';
import { prependPathEntries, resolveCliBinary, spawnCommand, stripAnsi } from './shared.js';
// ── stream-json event parsing ───────────────────────────
function extractAssistantText(obj) {
    const msg = obj.message;
    if (!msg)
        return '';
    const content = msg.content;
    if (!Array.isArray(content))
        return '';
    return content
        .filter((b) => b.type === 'text')
        .map((b) => b.text || '')
        .join('\n');
}
export function parseStreamLine(line) {
    const cleaned = stripAnsi(line).trim();
    if (!cleaned || !cleaned.startsWith('{'))
        return null;
    let obj;
    try {
        obj = JSON.parse(cleaned);
    }
    catch {
        return null;
    }
    const type = obj.type;
    const sessionId = obj.session_id;
    if (type === 'assistant') {
        const text = extractAssistantText(obj);
        if (text)
            return { type: 'text', content: text };
        return null;
    }
    if (type === 'tool_call') {
        const subtype = obj.subtype;
        const tc = obj.tool_call;
        if (subtype === 'completed') {
            let resultContent = '';
            if (tc) {
                for (const key of Object.keys(tc)) {
                    if (key.endsWith('ToolCall') || key === 'function') {
                        const inner = tc[key];
                        const result = inner?.result;
                        if (result)
                            resultContent = JSON.stringify(result);
                        break;
                    }
                }
            }
            return { type: 'tool_result', content: resultContent };
        }
        let name = 'unknown';
        let args = '';
        if (tc) {
            if ('function' in tc) {
                const fn = tc.function;
                name = fn.name || 'unknown';
                args = fn.arguments || '';
            }
            else {
                for (const key of Object.keys(tc)) {
                    if (key.endsWith('ToolCall')) {
                        name = key;
                        const inner = tc[key];
                        args = JSON.stringify(inner?.args ?? {});
                        break;
                    }
                }
            }
        }
        return { type: 'tool_call', name, args };
    }
    if (type === 'result') {
        const isError = obj.is_error;
        if (isError) {
            return { type: 'error', message: obj.result || 'Agent error' };
        }
        const durationMs = typeof obj.duration_ms === 'number' ? obj.duration_ms : undefined;
        const fullText = typeof obj.result === 'string' && obj.result ? obj.result : undefined;
        return { type: 'done', sessionId: sessionId, durationMs, fullText };
    }
    return null;
}
// ── Skill injection ──────────────────────────────────────
export async function injectSkills(workspace, skillPaths) {
    const cursorSkillsDir = join(workspace, '.cursor', 'skills');
    await mkdir(cursorSkillsDir, { recursive: true });
    try {
        const existing = await readdir(cursorSkillsDir);
        for (const entry of existing) {
            const full = join(cursorSkillsDir, entry);
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
        const dest = join(cursorSkillsDir, name);
        try {
            await symlink(resolve(sp), dest);
        }
        catch (e) {
            if (e.code !== 'EEXIST')
                throw e;
        }
    }
}
// ── Engine ───────────────────────────────────────────────
function findAgentBin() {
    const localBin = join(homedir(), '.local', 'bin', 'agent');
    const resolved = resolveCliBinary('agent', localBin);
    if (!resolved) {
        throw new Error(`Cursor CLI ("agent") not found in PATH or at ${localBin}\n` +
            `Install it with: curl https://cursor.com/install -fsS | bash\n` +
            `See: https://cursor.com/docs/cli/installation`);
    }
    return resolved;
}
export class CursorEngine {
    async *invoke(prompt, opts) {
        const debugEventsEnabled = isDebugEventsEnabled();
        await injectSkills(opts.workspace, opts.skillPaths);
        if (opts.mcpConfig && Object.keys(opts.mcpConfig).length > 0) {
            const cursorDir = join(opts.workspace, '.cursor');
            await mkdir(cursorDir, { recursive: true });
            const mcpServers = {};
            for (const [name, cfg] of Object.entries(opts.mcpConfig)) {
                mcpServers[name] = { command: cfg.command, args: cfg.args, env: cfg.env };
            }
            await writeFile(join(cursorDir, 'mcp.json'), `${JSON.stringify({ mcpServers }, null, 2)}\n`, 'utf-8');
        }
        const agentBin = findAgentBin();
        const args = [
            '-p',
            prompt,
            '--force',
            '--sandbox',
            'disabled',
            '--output-format',
            'stream-json',
            '--stream-partial-output',
            '--approve-mcps',
            '--workspace',
            opts.workspace,
        ];
        // When granular permissions are configured via .cursor/cli.json, skip --trust
        // so that the CLI enforces the permission rules. Otherwise, auto-approve all.
        if (!opts.hasPermissionsConfig) {
            args.push('--trust');
        }
        if (opts.sessionId)
            args.push('--resume', opts.sessionId);
        if (opts.model)
            args.push('--model', opts.model);
        if (opts.apiKey)
            args.push('--api-key', opts.apiKey);
        const env = {
            ...process.env,
            PATH: prependPathEntries(process.env.PATH, [join(homedir(), '.local', 'bin')]),
        };
        if (opts.provider)
            Object.assign(env, cursorProviderEnv(opts.provider));
        if (opts.apiKey)
            env.CURSOR_API_KEY = opts.apiKey;
        const child = spawnCommand(agentBin, args, {
            cwd: opts.workspace,
            env,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const queue = [];
        let resolver = null;
        let buffer = '';
        let rawLineCount = 0;
        let parsedEventCount = 0;
        let sawTerminalEvent = false;
        // Dedup: with --stream-partial-output, Cursor emits character-level deltas
        // followed by a summary event that repeats all text for each segment.
        let segmentAccum = '';
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
                rawLineCount++;
                const summary = summarizeJsonEventLine(line);
                if (summary)
                    debugEventLog(debugEventsEnabled, `[event-debug] cursor ${summary}`);
                const evt = parseStreamLine(line);
                if (!evt)
                    continue;
                parsedEventCount++;
                if (evt.type === 'text') {
                    if (segmentAccum.length > 0 && evt.content === segmentAccum) {
                        segmentAccum = '';
                        continue;
                    }
                    segmentAccum += evt.content;
                }
                else if (evt.type === 'tool_call' || evt.type === 'tool_result') {
                    segmentAccum = '';
                }
                if (evt.type === 'done' || evt.type === 'error')
                    sawTerminalEvent = true;
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
        child.on('close', (exitCode) => {
            if (buffer.trim()) {
                buffer += '\n';
                processBuffer();
            }
            const code = exitCode ?? 1;
            debugEventLog(debugEventsEnabled, `[event-debug] cursor close code=${code} rawLines=${rawLineCount} parsedEvents=${parsedEventCount} terminal=${sawTerminalEvent}`);
            if (code === 0 && rawLineCount === 0 && parsedEventCount === 0) {
                enqueue({ type: 'error', message: 'Cursor Agent exited without emitting stream events' });
            }
            else if (code !== 0 && !queue.some((e) => e && (e.type === 'done' || e.type === 'error'))) {
                enqueue({ type: 'error', message: `Agent process exited with code ${code}` });
            }
            enqueue(null);
        });
        child.on('error', (err) => {
            enqueue({ type: 'error', message: `Failed to start Cursor Agent: ${err.message}` });
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
        const bin = findAgentBin();
        return new Promise((resolve) => {
            const child = spawnCommand(bin, ['--list-models'], { timeout: 15_000, stdio: ['ignore', 'pipe', 'pipe'] });
            const chunks = [];
            child.stdout.on('data', (c) => chunks.push(c));
            child.on('close', () => {
                const raw = stripAnsi(Buffer.concat(chunks).toString('utf-8'));
                const models = raw
                    .split('\n')
                    .map((l) => l.match(/^(\S+)\s+-\s+/))
                    .filter((m) => !!m)
                    .map((m) => m[1]);
                resolve(models);
            });
            child.on('error', () => resolve([]));
        });
    }
}
//# sourceMappingURL=cursor.js.map