import { symlink, readdir, mkdir, lstat, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import type { AgentEngine, InvokeOpts, StreamEvent, ListModelsOpts } from '../engine.js';
import { stripAnsi, isOnPath } from './shared.js';

// ── stream-json event parsing ───────────────────────────

function extractAssistantText(obj: Record<string, unknown>): string {
  const msg = obj.message as Record<string, unknown> | undefined;
  if (!msg) return '';
  const content = msg.content as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(content)) return '';
  return content
    .filter(b => b.type === 'text')
    .map(b => (b.text as string) || '')
    .join('\n');
}

export function parseStreamLine(line: string): StreamEvent | null {
  const cleaned = stripAnsi(line).trim();
  if (!cleaned || !cleaned.startsWith('{')) return null;

  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(cleaned);
  } catch {
    return null;
  }

  const type = obj.type as string;
  const sessionId = obj.session_id as string | undefined;

  if (type === 'assistant') {
    const text = extractAssistantText(obj);
    if (text) return { type: 'text', content: text };
    return null;
  }

  if (type === 'tool_call') {
    const subtype = obj.subtype as string | undefined;
    const tc = obj.tool_call as Record<string, unknown> | undefined;

    if (subtype === 'completed') {
      let resultContent = '';
      if (tc) {
        for (const key of Object.keys(tc)) {
          if (key.endsWith('ToolCall') || key === 'function') {
            const inner = tc[key] as Record<string, unknown>;
            const result = inner?.result;
            if (result) resultContent = JSON.stringify(result);
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
        const fn = tc.function as Record<string, unknown>;
        name = (fn.name as string) || 'unknown';
        args = (fn.arguments as string) || '';
      } else {
        for (const key of Object.keys(tc)) {
          if (key.endsWith('ToolCall')) {
            name = key;
            const inner = tc[key] as Record<string, unknown>;
            args = JSON.stringify(inner?.args ?? {});
            break;
          }
        }
      }
    }
    return { type: 'tool_call', name, args };
  }

  if (type === 'result') {
    const isError = obj.is_error as boolean;
    if (isError) {
      return { type: 'error', message: (obj.result as string) || 'Agent error' };
    }
    const durationMs = typeof obj.duration_ms === 'number' ? obj.duration_ms : undefined;
    const fullText = typeof obj.result === 'string' && obj.result ? obj.result : undefined;
    return { type: 'done', sessionId: sessionId, durationMs, fullText };
  }

  return null;
}

// ── Skill injection ──────────────────────────────────────

export async function injectSkills(workspace: string, skillPaths: string[]): Promise<void> {
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
  } catch {
    // directory might not exist yet
  }

  for (const sp of skillPaths) {
    const name = basename(sp);
    const dest = join(cursorSkillsDir, name);
    try {
      await symlink(resolve(sp), dest);
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
  }
}

// ── Engine ───────────────────────────────────────────────

function findAgentBin(): string {
  const localBin = join(homedir(), '.local', 'bin', 'agent');
  if (!existsSync(localBin) && !isOnPath('agent')) {
    throw new Error(
      `Cursor CLI ("agent") not found at ${localBin}\n` +
      `Install it with: curl https://cursor.com/install -fsS | bash\n` +
      `See: https://cursor.com/docs/cli/installation`
    );
  }
  return existsSync(localBin) ? localBin : 'agent';
}

export class CursorEngine implements AgentEngine {
  async *invoke(prompt: string, opts: InvokeOpts): AsyncIterable<StreamEvent> {
    await injectSkills(opts.workspace, opts.skillPaths);

    const agentBin = findAgentBin();
    const args = [
      '-p', prompt,
      '--force',
      '--trust',
      '--sandbox', 'disabled',
      '--output-format', 'stream-json',
      '--stream-partial-output',
      '--approve-mcps',
      '--workspace', opts.workspace,
    ];
    if (opts.sessionId) args.push('--resume', opts.sessionId);
    if (opts.model) args.push('--model', opts.model);
    if (opts.apiKey) args.push('--api-key', opts.apiKey);

    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      PATH: `${join(homedir(), '.local', 'bin')}:${process.env.PATH || ''}`,
    };
    if (opts.apiKey) env.CURSOR_API_KEY = opts.apiKey;

    const child = spawn(agentBin, args, {
      cwd: opts.workspace,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const queue: Array<StreamEvent | null> = [];
    let resolver: (() => void) | null = null;
    let buffer = '';

    // Dedup: with --stream-partial-output, Cursor emits character-level deltas
    // followed by a summary event that repeats all text for each segment.
    let segmentAccum = '';

    function enqueue(evt: StreamEvent | null) {
      queue.push(evt);
      if (resolver) { resolver(); resolver = null; }
    }

    function processBuffer() {
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        const evt = parseStreamLine(line);
        if (!evt) continue;

        if (evt.type === 'text') {
          if (segmentAccum.length > 0 && evt.content === segmentAccum) {
            segmentAccum = '';
            continue;
          }
          segmentAccum += evt.content;
        } else if (evt.type === 'tool_call' || evt.type === 'tool_result') {
          segmentAccum = '';
        }

        enqueue(evt);
      }
    }

    if (opts.signal) {
      const abortHandler = () => {
        try { child.kill(); } catch { /* already dead */ }
        enqueue({ type: 'error', message: 'Agent invocation timed out' });
        enqueue(null);
      };
      opts.signal.addEventListener('abort', abortHandler, { once: true });
      child.once('close', () => opts.signal!.removeEventListener('abort', abortHandler));
    }

    child.stdout!.on('data', (chunk: Buffer) => { buffer += chunk.toString(); processBuffer(); });

    child.on('close', (exitCode: number | null) => {
      if (buffer.trim()) { buffer += '\n'; processBuffer(); }
      const code = exitCode ?? 1;
      if (code !== 0 && !queue.some(e => e && (e.type === 'done' || e.type === 'error'))) {
        enqueue({ type: 'error', message: `Agent process exited with code ${code}` });
      }
      enqueue(null);
    });

    child.on('error', (err: Error) => {
      enqueue({ type: 'error', message: `Failed to start Cursor Agent: ${err.message}` });
      enqueue(null);
    });

    while (true) {
      if (queue.length === 0) await new Promise<void>(r => { resolver = r; });
      while (queue.length > 0) {
        const evt = queue.shift()!;
        if (evt === null) return;
        yield evt;
        if (evt.type === 'done' || evt.type === 'error') {
          try { child.kill(); } catch { /* already dead */ }
          return;
        }
      }
    }
  }

  async listModels(_opts: ListModelsOpts): Promise<string[]> {
    const bin = findAgentBin();
    return new Promise<string[]>((resolve) => {
      const child = spawn(bin, ['--list-models'], { timeout: 15_000, stdio: ['ignore', 'pipe', 'pipe'] });
      const chunks: Buffer[] = [];
      child.stdout.on('data', (c: Buffer) => chunks.push(c));
      child.on('close', () => {
        const raw = stripAnsi(Buffer.concat(chunks).toString('utf-8'));
        const models = raw.split('\n')
          .map(l => l.match(/^(\S+)\s+-\s+/))
          .filter((m): m is RegExpMatchArray => !!m)
          .map(m => m[1]);
        resolve(models);
      });
      child.on('error', () => resolve([]));
    });
  }
}
