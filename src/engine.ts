import { symlink, readdir, mkdir, lstat, unlink, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawn, execFileSync } from 'node:child_process';

export type StreamEvent =
  | { type: 'text'; content: string }
  | { type: 'tool_call'; name: string; args: string }
  | { type: 'tool_result'; content: string }
  | { type: 'warning'; message: string }
  | { type: 'error'; message: string }
  | { type: 'done'; sessionId?: string; durationMs?: number; costUsd?: number; numTurns?: number };

export interface InvokeOpts {
  workspace: string;
  skillPaths: string[];
  sessionId?: string;
  model?: string;
  apiKey?: string;
  skipPermissions?: boolean;
}

export interface AgentEngine {
  invoke(prompt: string, opts: InvokeOpts): AsyncIterable<StreamEvent>;
}

// ── ANSI stripping ──────────────────────────────────────

const ANSI_RE = /\x1b\[[^a-zA-Z]*[a-zA-Z]/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

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
      // Extract result from completed tool call
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

    // subtype === 'started' or no subtype (legacy)
    let name = 'unknown';
    let args = '';
    if (tc) {
      // Handle tool_call.function structure: { "name": "...", "arguments": "..." }
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
    return { type: 'done', sessionId: sessionId, durationMs };
  }

  if (type === 'system') {
    // system init carries session_id but does NOT mean conversation is done
    return null;
  }

  return null;
}

// ── CursorEngine ────────────────────────────────────────

export async function injectSkills(workspace: string, skillPaths: string[]): Promise<void> {
  const cursorSkillsDir = join(workspace, '.cursor', 'skills');
  await mkdir(cursorSkillsDir, { recursive: true });

  // Remove old symlinks that we created
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

export function isOnPath(cmd: string): boolean {
  try {
    execFileSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

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

    child.stdout!.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      processBuffer();
    });

    child.on('close', (exitCode: number | null) => {
      if (buffer.trim()) {
        buffer += '\n';
        processBuffer();
      }

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
      if (queue.length === 0) {
        await new Promise<void>(r => { resolver = r; });
      }
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
}

// ── Claude Code stream-json event parsing ───────────────

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
    return [{ type: 'done', sessionId, durationMs, costUsd, numTurns }];
  }

  if (type === 'system') {
    return [];
  }

  return [];
}

// ── ClaudeCodeEngine ────────────────────────────────────

let _warnedSkipPermissions = false;

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
        const events = parseClaudeStreamLine(line);
        for (const evt of events) {
          enqueue(evt);
        }
      }
    }

    child.stdout!.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      processBuffer();
    });

    child.on('close', (exitCode: number | null) => {
      if (buffer.trim()) {
        buffer += '\n';
        processBuffer();
      }

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
      if (queue.length === 0) {
        await new Promise<void>(r => { resolver = r; });
      }
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
}

// ── OpenCode stream-json event parsing ──────────────────

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

  // Top-level error event
  if (type === 'error') {
    const error = obj.error as Record<string, unknown> | undefined;
    const data = error?.data as Record<string, unknown> | undefined;
    const message = (data?.message as string) || (error?.name as string) || 'OpenCode error';
    return [{ type: 'error', message }];
  }

  // Text event
  if (type === 'text' && part) {
    const text = (part.text as string) || '';
    if (text) return [{ type: 'text', content: text }];
    return [];
  }

  // Tool use event — part.state contains input/output
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

  // Step finish — contains cost and token metadata
  if (type === 'step_finish' && part) {
    const cost = typeof part.cost === 'number' ? part.cost : undefined;
    return [{
      type: 'done',
      sessionId: sessionID,
      costUsd: cost,
      numTurns: undefined,
    }];
  }

  // step_start, reasoning, and other events — ignore
  return [];
}

// ── OpenCodeEngine ─────────────────────────────────────

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

  // Ensure headless-safe permissions
  if (!existing.permission) {
    existing.permission = { '*': 'allow' };
  }

  if (model && !existing.model) {
    existing.model = model;
  }

  await writeFile(configPath, JSON.stringify(existing, null, 2) + '\n', 'utf-8');
}

function findOpenCodeBin(): string {
  if (!isOnPath('opencode')) {
    throw new Error(
      `OpenCode CLI ("opencode") not found in PATH\n` +
      `Install it with: npm install -g opencode-ai\n` +
      `See: https://opencode.ai/docs`
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

    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
    };
    Object.assign(env, resolveOpenCodeEnv(opts.model, opts.apiKey));

    const child = spawn(bin, args, {
      cwd: opts.workspace,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const queue: Array<StreamEvent | null> = [];
    let resolver: (() => void) | null = null;
    let buffer = '';
    let stderrChunks: string[] = [];
    // OpenCode emits step_finish per step; accumulate cost and session from done events,
    // yield text/tool events as they arrive, and produce a single final done on process close.
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
        const events = parseOpenCodeStreamLine(line);
        for (const evt of events) {
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

    child.stdout!.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      processBuffer();
    });

    child.stderr!.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) {
        stderrChunks.push(text);
        const events = parseOpenCodeStreamLine(text);
        for (const evt of events) {
          if (evt.type === 'error') {
            gotError = true;
          }
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
        enqueue({
          type: 'done',
          sessionId: lastSessionId,
          costUsd: totalCost > 0 ? totalCost : undefined,
          numTurns: undefined,
        });
      }
      enqueue(null);
    });

    child.on('error', (err: Error) => {
      enqueue({ type: 'error', message: `Failed to start OpenCode: ${err.message}` });
      enqueue(null);
    });

    while (true) {
      if (queue.length === 0) {
        await new Promise<void>(r => { resolver = r; });
      }
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
}

// ── Engine factory ──────────────────────────────────────

export function createEngine(type: string): AgentEngine {
  if (type === 'cursor') return new CursorEngine();
  if (type === 'claude-code') return new ClaudeCodeEngine();
  if (type === 'opencode') return new OpenCodeEngine();
  throw new Error(`Unsupported engine: ${type}. Supported: 'cursor', 'claude-code', 'opencode'.`);
}
