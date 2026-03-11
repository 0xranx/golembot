import { spawn } from 'node:child_process';
import { lstat, mkdir, readdir, readFile, symlink, unlink, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import type { AgentEngine, InvokeOpts, ListModelsOpts, StreamEvent } from '../engine.js';
import { openCodeProviderEnv } from './provider-env.js';
import { isOnPath } from './shared.js';

// ── Provider env resolution ──────────────────────────────

// Map provider prefix in model string (e.g. "openrouter/anthropic/...") to env var name
const OPENCODE_PROVIDER_ENV: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  google: 'GOOGLE_GENERATIVE_AI_API_KEY',
  'amazon-bedrock': 'AWS_ACCESS_KEY_ID',
  mistral: 'MISTRAL_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  groq: 'GROQ_API_KEY',
};

export function resolveOpenCodeEnv(model?: string, apiKey?: string): Record<string, string> {
  if (!apiKey) return {};
  const provider = model?.split('/')[0] || 'openrouter';
  const envVar = OPENCODE_PROVIDER_ENV[provider] || `${provider.toUpperCase().replace(/-/g, '_')}_API_KEY`;
  return { [envVar]: apiKey };
}

// ── NDJSON event parsing ─────────────────────────────────

/**
 * Parse a single NDJSON line from `opencode run --format json`.
 *
 * Actual streaming format (verified with v1.1.28):
 *   Each line is a JSON object with top-level `type` and a `part` object:
 *   - { type: "step_start",  sessionID, part: { type: "step-start" } }
 *   - { type: "text",        sessionID, part: { type: "text", text: "..." } }
 *   - { type: "tool_use",    sessionID, part: { type: "tool", tool: "read", state: { status, input, output } } }
 *   - { type: "step_finish", sessionID, part: { type: "step-finish", cost, tokens, reason } }
 *   - { type: "error",       error: { name, data: { message } } }
 */
export function parseOpenCodeStreamLine(line: string): StreamEvent[] {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith('{')) return [];

  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return [];
  }

  const type = obj.type as string | undefined;
  const sessionID = obj.sessionID as string | undefined;
  const part = obj.part as Record<string, unknown> | undefined;

  if (type === 'error') {
    const error = obj.error as Record<string, unknown> | undefined;
    const data = error?.data as Record<string, unknown> | undefined;
    const message = (data?.message as string) || (error?.name as string) || 'OpenCode error';
    return [{ type: 'error', message }];
  }

  if (type === 'text' && part) {
    const text = (part.text as string) || '';
    if (text) return [{ type: 'text', content: text }];
    return [];
  }

  if (type === 'tool_use' && part) {
    const toolName = (part.tool as string) || 'unknown';
    const state = part.state as Record<string, unknown> | undefined;
    const events: StreamEvent[] = [];

    if (state) {
      const input = state.input as Record<string, unknown> | undefined;
      events.push({ type: 'tool_call', name: toolName, args: JSON.stringify(input ?? {}) });

      const status = state.status as string | undefined;
      if (status === 'completed') {
        const output = state.output;
        const outputStr = typeof output === 'string' ? output : JSON.stringify(output ?? '');
        events.push({ type: 'tool_result', content: outputStr });
      }
    } else {
      events.push({ type: 'tool_call', name: toolName, args: '{}' });
    }

    return events;
  }

  if (type === 'step_finish' && part) {
    const cost = typeof part.cost === 'number' ? part.cost : undefined;
    return [{ type: 'done', sessionId: sessionID, costUsd: cost, numTurns: undefined }];
  }

  return [];
}

// ── Skill injection ──────────────────────────────────────

export async function injectOpenCodeSkills(workspace: string, skillPaths: string[]): Promise<void> {
  const ocSkillsDir = join(workspace, '.opencode', 'skills');
  await mkdir(ocSkillsDir, { recursive: true });

  try {
    const existing = await readdir(ocSkillsDir);
    for (const entry of existing) {
      const full = join(ocSkillsDir, entry);
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
    const dest = join(ocSkillsDir, name);
    try {
      await symlink(resolve(sp), dest);
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
  }
}

export async function ensureOpenCodeConfig(workspace: string, model?: string): Promise<void> {
  const configPath = join(workspace, 'opencode.json');
  let existing: Record<string, unknown> = {};
  try {
    const raw = await readFile(configPath, 'utf-8');
    existing = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // no existing config
  }

  if (!existing.permission) {
    existing.permission = { '*': 'allow' };
  }

  if (model && !existing.model) {
    existing.model = model;
  }

  // Register provider block so OpenCode can authenticate and locate the model.
  // OpenCode requires both options.apiKey (auth) and models[modelId] (discovery).
  // Without the models entry, OpenCode throws ProviderModelNotFoundError even when
  // the env var is set and the apiKey is present.
  if (model) {
    const parts = model.split('/');
    const providerPrefix = parts[0];
    const modelId = parts.slice(1).join('/');
    const envVar = providerPrefix ? OPENCODE_PROVIDER_ENV[providerPrefix] : undefined;
    if (envVar && modelId) {
      const providerMap = (existing.provider ?? {}) as Record<string, unknown>;
      const entry = (providerMap[providerPrefix] ?? {}) as Record<string, unknown>;

      // Preserve existing apiKey; only set if absent
      const options = (entry.options ?? {}) as Record<string, unknown>;
      if (!options.apiKey) options.apiKey = `{env:${envVar}}`;
      entry.options = options;

      // Register the model; preserve existing model-level config if present
      const models = (entry.models ?? {}) as Record<string, unknown>;
      if (!models[modelId]) models[modelId] = {};
      entry.models = models;

      providerMap[providerPrefix] = entry;
      existing.provider = providerMap;
    }
  }

  await writeFile(configPath, `${JSON.stringify(existing, null, 2)}\n`, 'utf-8');
}

// ── Engine ───────────────────────────────────────────────

function findOpenCodeBin(): string {
  if (!isOnPath('opencode')) {
    throw new Error(
      `OpenCode CLI ("opencode") not found in PATH\n` +
        `Install it with: npm install -g opencode-ai\n` +
        `See: https://opencode.ai/docs`,
    );
  }
  return 'opencode';
}

export class OpenCodeEngine implements AgentEngine {
  async *invoke(prompt: string, opts: InvokeOpts): AsyncIterable<StreamEvent> {
    await injectOpenCodeSkills(opts.workspace, opts.skillPaths);
    await ensureOpenCodeConfig(opts.workspace, opts.model);

    const bin = findOpenCodeBin();
    const args = ['run', prompt, '--format', 'json'];
    if (opts.sessionId) args.push('--session', opts.sessionId);
    if (opts.model) args.push('--model', opts.model);

    const env: Record<string, string> = { ...(process.env as Record<string, string>) };
    if (opts.provider) Object.assign(env, openCodeProviderEnv(opts.provider, opts.model));
    Object.assign(env, resolveOpenCodeEnv(opts.model, opts.apiKey));

    const child = spawn(bin, args, {
      cwd: opts.workspace,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const queue: Array<StreamEvent | null> = [];
    let resolver: (() => void) | null = null;
    let buffer = '';
    const stderrChunks: string[] = [];
    let lastSessionId: string | undefined;
    let totalCost = 0;
    let gotError = false;

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
        for (const evt of parseOpenCodeStreamLine(line)) {
          if (evt.type === 'done') {
            if (evt.sessionId) lastSessionId = evt.sessionId;
            if (evt.costUsd) totalCost += evt.costUsd;
          } else if (evt.type === 'error') {
            gotError = true;
            enqueue(evt);
          } else {
            enqueue(evt);
          }
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
      if (text) {
        stderrChunks.push(text);
        for (const evt of parseOpenCodeStreamLine(text)) {
          if (evt.type === 'error') gotError = true;
          enqueue(evt);
        }
      }
    });

    child.on('close', (exitCode: number | null) => {
      if (buffer.trim()) {
        buffer += '\n';
        processBuffer();
      }
      const code = exitCode ?? 1;
      if (code !== 0 && !gotError && !lastSessionId) {
        const stderrText = stderrChunks.join('\n').slice(0, 500);
        const detail = stderrText ? `: ${stderrText}` : '';
        enqueue({ type: 'error', message: `OpenCode process exited with code ${code}${detail}` });
      } else if (!gotError) {
        enqueue({ type: 'done', sessionId: lastSessionId, costUsd: totalCost > 0 ? totalCost : undefined });
      }
      enqueue(null);
    });

    child.on('error', (err: Error) => {
      enqueue({ type: 'error', message: `Failed to start OpenCode: ${err.message}` });
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
    const provider = opts.model?.split('/')[0];
    // OpenRouter: public API, no auth needed
    if (provider === 'openrouter') {
      try {
        const resp = await fetch('https://openrouter.ai/api/v1/models', {
          signal: AbortSignal.timeout(10_000),
        });
        const data = (await resp.json()) as { data?: Array<{ id: string }> };
        if (data.data?.length) return data.data.map((m) => m.id).sort();
      } catch {
        /* fallback to CLI */
      }
    }
    // Fallback: opencode CLI
    return new Promise<string[]>((resolve) => {
      const child = spawn('opencode', ['models'], { timeout: 15_000, stdio: ['ignore', 'pipe', 'pipe'] });
      const chunks: Buffer[] = [];
      child.stdout.on('data', (c: Buffer) => chunks.push(c));
      child.on('close', () => {
        const models = Buffer.concat(chunks).toString('utf-8').trim().split('\n').filter(Boolean);
        resolve(models);
      });
      child.on('error', () => resolve([]));
    });
  }
}
