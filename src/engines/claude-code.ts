import { symlink, readdir, mkdir, lstat, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import type { AgentEngine, InvokeOpts, StreamEvent, ListModelsOpts } from '../engine.js';
import { isOnPath } from './shared.js';

// ── stream-json event parsing ───────────────────────────

export function parseClaudeStreamLine(line: string): StreamEvent[] {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith('{')) return [];

  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return [];
  }

  const type = obj.type as string;
  const sessionId = obj.session_id as string | undefined;

  if (type === 'assistant') {
    const msg = obj.message as Record<string, unknown> | undefined;
    if (!msg) return [];
    const content = msg.content as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(content)) return [];

    const events: StreamEvent[] = [];
    for (const block of content) {
      if (block.type === 'text') {
        const text = (block.text as string) || '';
        if (text) events.push({ type: 'text', content: text });
      } else if (block.type === 'tool_use') {
        const name = (block.name as string) || 'unknown';
        const input = block.input ?? {};
        events.push({ type: 'tool_call', name, args: JSON.stringify(input) });
      }
    }
    return events;
  }

  if (type === 'user') {
    const msg = obj.message as Record<string, unknown> | undefined;
    if (!msg) return [];
    const content = msg.content as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(content)) return [];

    const events: StreamEvent[] = [];
    for (const block of content) {
      if (block.type === 'tool_result') {
        let resultContent: string;
        if (typeof block.content === 'string') {
          resultContent = block.content;
        } else if (Array.isArray(block.content)) {
          resultContent = (block.content as Array<Record<string, unknown>>)
            .filter(b => b.type === 'text')
            .map(b => (b.text as string) || '')
            .join('\n');
        } else {
          resultContent = '';
        }
        events.push({ type: 'tool_result', content: resultContent });
      }
    }
    return events;
  }

  if (type === 'result') {
    const isError = obj.is_error as boolean;
    if (isError) {
      const message = (obj.result as string) || (obj.error as string) || 'Agent error';
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

export async function injectClaudeSkills(
  workspace: string,
  skillPaths: string[],
  skillDescriptions?: Array<{ name: string; description: string }>,
): Promise<void> {
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
  } catch {
    // directory might not exist yet
  }

  for (const sp of skillPaths) {
    const name = basename(sp);
    const dest = join(claudeSkillsDir, name);
    try {
      await symlink(resolve(sp), dest);
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
  }

  // Symlink CLAUDE.md → AGENTS.md to avoid maintaining duplicate content
  const claudeMdPath = join(workspace, 'CLAUDE.md');
  try {
    const existing = await lstat(claudeMdPath).catch(() => null);
    if (existing) await unlink(claudeMdPath);
  } catch { /* doesn't exist yet */ }
  try {
    await symlink('AGENTS.md', claudeMdPath);
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
  }
}

// ── Engine ───────────────────────────────────────────────

let _warnedSkipPermissions = false;

function findClaudeBin(): string {
  const localBin = join(homedir(), '.local', 'bin', 'claude');
  if (!existsSync(localBin) && !isOnPath('claude')) {
    throw new Error(
      `Claude Code CLI ("claude") not found at ${localBin}\n` +
      `Install it with: npm install -g @anthropic-ai/claude-code\n` +
      `See: https://code.claude.com/docs/en/overview`
    );
  }
  return existsSync(localBin) ? localBin : 'claude';
}

export class ClaudeCodeEngine implements AgentEngine {
  async *invoke(prompt: string, opts: InvokeOpts): AsyncIterable<StreamEvent> {
    await injectClaudeSkills(opts.workspace, opts.skillPaths);

    const claudeBin = findClaudeBin();
    const args = [
      '-p', prompt,
      '--output-format', 'stream-json',
      '--verbose',
    ];
    if (opts.skipPermissions !== false) {
      args.push('--dangerously-skip-permissions');
      if (!_warnedSkipPermissions) {
        _warnedSkipPermissions = true;
        process.stderr.write(
          '\x1b[33mWarning: running Claude Code with --dangerously-skip-permissions. ' +
          'Set skipPermissions: false in golem.yaml to require manual approval.\x1b[0m\n',
        );
      }
    }
    if (opts.sessionId) args.push('--resume', opts.sessionId);
    if (opts.model) args.push('--model', opts.model);

    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      PATH: `${join(homedir(), '.local', 'bin')}:${process.env.PATH || ''}`,
    };
    if (opts.apiKey) env.ANTHROPIC_API_KEY = opts.apiKey;
    // Allow spawning Claude Code from within a Claude Code session
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;

    const child = spawn(claudeBin, args, {
      cwd: opts.workspace,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const queue: Array<StreamEvent | null> = [];
    let resolver: (() => void) | null = null;
    let buffer = '';

    function enqueue(evt: StreamEvent | null) {
      queue.push(evt);
      if (resolver) { resolver(); resolver = null; }
    }

    function processBuffer() {
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        for (const evt of parseClaudeStreamLine(line)) enqueue(evt);
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
        enqueue({ type: 'error', message: `Claude Code process exited with code ${code}` });
      }
      enqueue(null);
    });

    child.on('error', (err: Error) => {
      enqueue({ type: 'error', message: `Failed to start Claude Code: ${err.message}` });
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

  async listModels(opts: ListModelsOpts): Promise<string[]> {
    const apiKey = opts.apiKey || process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      try {
        const resp = await fetch('https://api.anthropic.com/v1/models?limit=100', {
          headers: { 'anthropic-version': '2023-06-01', 'x-api-key': apiKey },
          signal: AbortSignal.timeout(10_000),
        });
        const data = (await resp.json()) as { data?: Array<{ id: string }> };
        if (data.data?.length) return data.data.map(m => m.id).sort();
      } catch { /* fallback below */ }
    }
    return ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'];
  }
}
