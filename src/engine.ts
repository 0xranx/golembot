import type { ProviderConfig } from './workspace.js';

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
  /** When true, the workspace has a .cursor/cli.json with granular permissions; do not pass --trust. */
  hasPermissionsConfig?: boolean;
  /** Provider config from golem.yaml, for custom LLM API routing */
  provider?: ProviderConfig;
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

export { ClaudeCodeEngine, injectClaudeSkills, parseClaudeStreamLine } from './engines/claude-code.js';
export { CodexEngine, injectCodexSkills, parseCodexStreamLine } from './engines/codex.js';
export { CursorEngine, injectSkills, parseStreamLine } from './engines/cursor.js';
export {
  ensureOpenCodeConfig,
  injectOpenCodeSkills,
  OpenCodeEngine,
  parseOpenCodeStreamLine,
  resolveOpenCodeEnv,
} from './engines/opencode.js';
export { claudeProviderEnv, codexProviderEnv, cursorProviderEnv, openCodeProviderEnv } from './engines/provider-env.js';
export { type DiscoveredEngine, discoverEngines, isOnPath, stripAnsi } from './engines/shared.js';

// ── Engine factory ───────────────────────────────────────

import { ClaudeCodeEngine } from './engines/claude-code.js';
import { CodexEngine } from './engines/codex.js';
import { CursorEngine } from './engines/cursor.js';
import { OpenCodeEngine } from './engines/opencode.js';

export function createEngine(type: string): AgentEngine {
  if (type === 'cursor') return new CursorEngine();
  if (type === 'claude-code') return new ClaudeCodeEngine();
  if (type === 'opencode') return new OpenCodeEngine();
  if (type === 'codex') return new CodexEngine();
  throw new Error(`Unsupported engine: ${type}. Supported: 'cursor', 'claude-code', 'opencode', 'codex'.`);
}
