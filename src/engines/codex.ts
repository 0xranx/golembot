import { spawn } from 'node:child_process';
import { lstat, mkdir, readdir, symlink, unlink } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import type { AgentEngine, InvokeOpts, ListModelsOpts, StreamEvent } from '../engine.js';
import { codexProviderEnv } from './provider-env.js';
import { isOnPath, stripAnsi } from './shared.js';

// ── NDJSON event parsing ─────────────────────────────────

/**
 * Parse a single NDJSON line from `codex exec --json --full-auto`.
 *
 * Event format:
 *   - { type: "thread.started", thread_id: "thread_abc123" }
 *   - { type: "item.completed", item: { type: "agent_message", text: "..." } }
 *   - { type: "item.completed", item: { type: "command_execution", command: "ls", output: "..." } }
 *   - { type: "turn.completed", usage: { total_tokens: 42 } }
 *   - { type: "turn.failed", error: { message: "..." } }
 *   - { type: "error", message: "..." }
 *
 * @param state Mutable state object; thread_id is written into state.threadId on thread.started events.
 */
export function parseCodexStreamLine(line: string, state: { threadId?: string }): StreamEvent[] {
  const trimmed = stripAnsi(line).trim();
  if (!trimmed || !trimmed.startsWith('{')) return [];

  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return [];
  }

  const type = obj.type as string | undefined;

  if (type === 'thread.started') {
    state.threadId = (obj.thread_id as string) || undefined;
    return [];
  }

  if (type === 'item.completed') {
    const item = obj.item as Record<string, unknown> | undefined;
    if (!item) return [];
    const itemType = item.type as string | undefined;

    if (itemType === 'agent_message') {
      // Primary format: item.text (direct string)
      const directText = item.text as string | undefined;
      if (directText) return [{ type: 'text', content: directText }];

      // Fallback: item.content[] content blocks (OpenAI API-style format)
      const content = item.content as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(content)) {
        const text = content
          .filter((b) => b.type === 'output_text')
          .map((b) => (b.text as string) || '')
          .join('');
        if (text) return [{ type: 'text', content: text }];
      }
      return [];
    }

    if (itemType === 'command_execution') {
      const command = (item.command as string) || 'shell';
      const output = item.output as string | undefined;
      const events: StreamEvent[] = [{ type: 'tool_call', name: command, args: '' }];
      if (output) events.push({ type: 'tool_result', content: output });
      return events;
    }

    return [];
  }

  if (type === 'turn.completed') {
    return [{ type: 'done', sessionId: state.threadId }];
  }

  if (type === 'turn.failed') {
    const error = obj.error as Record<string, unknown> | undefined;
    const message = (error?.message as string) || 'Codex turn failed';
    return [{ type: 'error', message }];
  }

  if (type === 'error') {
    const message = (obj.message as string) || 'Codex error';
    // Suppress internal WebSocket reconnection notices (e.g. "Reconnecting... 2/5 ...").
    // These are non-actionable retry mechanics emitted by the Codex CLI's transport layer
    // before it falls back to HTTPS. Fatal failures arrive via 'turn.failed' or a non-zero
    // process exit code, both of which are handled separately.
    if (/^Reconnecting\.\.\. \d+\/\d+/.test(message)) return [];
    return [{ type: 'error', message }];
  }

  return [];
}

// ── Skill injection ──────────────────────────────────────

/**
 * Inject GolemBot skills into `.agents/skills/` so Codex can discover them
 * via its native skill mechanism (progressive disclosure).
 * AGENTS.md is still generated separately by workspace.ts for persistent instructions.
 */
export async function injectCodexSkills(workspace: string, skillPaths: string[]): Promise<void> {
  const agentsSkillsDir = join(workspace, '.agents', 'skills');
  await mkdir(agentsSkillsDir, { recursive: true });

  // Clean up existing symlinks (re-inject on every invocation to stay in sync)
  try {
    const existing = await readdir(agentsSkillsDir);
    for (const entry of existing) {
      const full = join(agentsSkillsDir, entry);
      const s = await lstat(full).catch(() => null);
      if (s?.isSymbolicLink()) {
        await unlink(full);
      }
    }
  } catch {
    /* directory might not exist yet */
  }

  for (const sp of skillPaths) {
    const name = basename(sp);
    const dest = join(agentsSkillsDir, name);
    try {
      await symlink(resolve(sp), dest);
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
  }
}

// ── Engine ───────────────────────────────────────────────

function findCodexBin(): string {
  if (!isOnPath('codex')) {
    throw new Error(
      `Codex CLI ("codex") not found in PATH\n` +
        `Install it with: npm install -g @openai/codex\n` +
        `See: https://developers.openai.com/codex`,
    );
  }
  return 'codex';
}

export class CodexEngine implements AgentEngine {
  async *invoke(prompt: string, opts: InvokeOpts): AsyncIterable<StreamEvent> {
    await injectCodexSkills(opts.workspace, opts.skillPaths);

    const bin = findCodexBin();
    const codexProfile = opts.provider?.codexProfile;
    const codexProviderId = opts.provider?.codexProviderId;
    const codexEnvKey = opts.provider?.codexEnvKey;

    // Build args respecting the `exec` / `exec resume` subcommand structure:
    //   new session : codex exec        [flags] [--model X] <prompt>
    //   resume      : codex exec resume [flags] [--model X] <session_id> <prompt>
    // Flags must follow the subcommand they belong to; `resume` has its own flag set.
    const sharedFlags = ['--json', '--full-auto', '--skip-git-repo-check'];
    if (codexProfile) sharedFlags.push('--profile', codexProfile);
    if (codexProviderId) sharedFlags.push('-c', `model_provider="${codexProviderId}"`);
    if (codexProviderId && opts.provider?.codexWireApi === 'responses') {
      sharedFlags.push('-c', `model_providers.${codexProviderId}.wire_api="responses"`);
    }
    const modelFlag = opts.model ? ['--model', opts.model] : [];
    const args = opts.sessionId
      ? ['exec', 'resume', ...sharedFlags, ...modelFlag, opts.sessionId, prompt]
      : ['exec', ...sharedFlags, ...modelFlag, prompt];

    const env: Record<string, string> = { ...(process.env as Record<string, string>) };
    // If a Codex profile is provided, let Codex load provider/base_url/model
    // from ~/.codex/config.toml to avoid conflicting with env-based overrides.
    if (opts.provider && !codexProfile) Object.assign(env, codexProviderEnv(opts.provider));
    if (opts.provider?.apiKey && codexEnvKey) {
      env[codexEnvKey] = opts.provider.apiKey;
    }
    if (opts.apiKey) {
      // CODEX_API_KEY is the primary env var per official CI docs;
      // also set OPENAI_API_KEY for backward compatibility with older CLI versions.
      env.CODEX_API_KEY = opts.apiKey;
      env.OPENAI_API_KEY = opts.apiKey;
    }

    const child = spawn(bin, args, {
      cwd: opts.workspace,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const queue: Array<StreamEvent | null> = [];
    let resolver: (() => void) | null = null;
    let buffer = '';
    const state: { threadId?: string } = {};
    let gotDone = false;
    let gotError = false;
    const stderrChunks: string[] = [];

    function enqueue(evt: StreamEvent | null) {
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
        if (!line.trim()) continue;
        for (const evt of parseCodexStreamLine(line, state)) {
          if (evt.type === 'done') {
            gotDone = true;
            enqueue(evt);
          } else if (evt.type === 'error') {
            gotError = true;
            enqueue(evt);
          } else enqueue(evt);
        }
      }
    }

    if (opts.signal) {
      const abortHandler = () => {
        try {
          child.kill();
        } catch {
          /* already dead */
        }
        enqueue({ type: 'error', message: 'Agent invocation timed out' });
        enqueue(null);
      };
      opts.signal.addEventListener('abort', abortHandler, { once: true });
      child.once('close', () => opts.signal!.removeEventListener('abort', abortHandler));
    }

    child.stdout!.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      processBuffer();
    });

    child.stderr!.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) stderrChunks.push(text);
    });

    child.on('close', (exitCode: number | null) => {
      if (buffer.trim()) {
        buffer += '\n';
        processBuffer();
      }
      const code = exitCode ?? 1;
      if (code !== 0 && !gotDone && !gotError) {
        const stderrText = stderrChunks.join('\n').slice(0, 500);
        const detail = stderrText ? `: ${stderrText}` : '';
        enqueue({ type: 'error', message: `Codex process exited with code ${code}${detail}` });
      } else if (!gotDone && !gotError) {
        enqueue({ type: 'done', sessionId: state.threadId });
      }
      enqueue(null);
    });

    child.on('error', (err: Error) => {
      enqueue({ type: 'error', message: `Failed to start Codex: ${err.message}` });
      enqueue(null);
    });

    while (true) {
      if (queue.length === 0)
        await new Promise<void>((r) => {
          resolver = r;
        });
      while (queue.length > 0) {
        const evt = queue.shift()!;
        if (evt === null) return;
        yield evt;
        if (evt.type === 'done' || evt.type === 'error') {
          try {
            child.kill();
          } catch {
            /* already dead */
          }
          return;
        }
      }
    }
  }

  async listModels(opts: ListModelsOpts): Promise<string[]> {
    const apiKey = opts.apiKey || process.env.CODEX_API_KEY || process.env.OPENAI_API_KEY;
    if (apiKey) {
      try {
        const resp = await fetch('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(10_000),
        });
        const data = (await resp.json()) as { data?: Array<{ id: string }> };
        if (data.data?.length) return data.data.map((m) => m.id).sort();
      } catch {
        /* fallback below */
      }
    }
    return ['gpt-5.4', 'gpt-5.3-codex', 'gpt-5.2-codex', 'gpt-5.1-codex-max', 'codex-mini-latest'];
  }
}
