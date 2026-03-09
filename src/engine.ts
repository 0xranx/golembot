// ── Core types ───────────────────────────────────────────

export type StreamEvent =
  | { type: 'text'; content: string }
  | { type: 'tool_call'; name: string; args: string }
  | { type: 'tool_result'; content: string }
  | { type: 'warning'; message: string }
  | { type: 'error'; message: string }
  | { type: 'done'; sessionId?: string; durationMs?: number; costUsd?: number; numTurns?: number; fullText?: string };

export interface InvokeOpts {
  workspace: string;
  skillPaths: string[];
  sessionId?: string;
  model?: string;
  apiKey?: string;
  skipPermissions?: boolean;
  signal?: AbortSignal;
  /** Absolute paths to image files attached to the user message. Engines may use these for native multimodal support. */
  imagePaths?: string[];
}

export interface ListModelsOpts {
  apiKey?: string;
  model?: string;
}

export interface AgentEngine {
  invoke(prompt: string, opts: InvokeOpts): AsyncIterable<StreamEvent>;
  listModels?(opts: ListModelsOpts): Promise<string[]>;
}

// ── Re-exports from engine implementations ───────────────

export { stripAnsi, isOnPath } from './engines/shared.js';
export { parseStreamLine, injectSkills, CursorEngine } from './engines/cursor.js';
export { parseClaudeStreamLine, injectClaudeSkills, ClaudeCodeEngine } from './engines/claude-code.js';
export { parseOpenCodeStreamLine, injectOpenCodeSkills, ensureOpenCodeConfig, resolveOpenCodeEnv, OpenCodeEngine } from './engines/opencode.js';
export { parseCodexStreamLine, injectCodexSkills, CodexEngine } from './engines/codex.js';

// ── Engine factory ───────────────────────────────────────

import { CursorEngine } from './engines/cursor.js';
import { ClaudeCodeEngine } from './engines/claude-code.js';
import { OpenCodeEngine } from './engines/opencode.js';
import { CodexEngine } from './engines/codex.js';

export function createEngine(type: string): AgentEngine {
  if (type === 'cursor') return new CursorEngine();
  if (type === 'claude-code') return new ClaudeCodeEngine();
  if (type === 'opencode') return new OpenCodeEngine();
  if (type === 'codex') return new CodexEngine();
  throw new Error(`Unsupported engine: ${type}. Supported: 'cursor', 'claude-code', 'opencode', 'codex'.`);
}
