import type { CodexConfig, McpServerConfig, ProviderConfig } from './workspace.js';

// ── Core types ───────────────────────────────────────────

export type CompletionEvent =
  | {
      type: 'completion';
      status: 'completed';
      finalText: string;
      sessionId?: string;
      durationMs?: number;
      costUsd?: number;
      numTurns?: number;
    }
  | {
      type: 'completion';
      status: 'silent';
      reason: 'pass' | 'skip';
      sessionId?: string;
      durationMs?: number;
      costUsd?: number;
      numTurns?: number;
    }
  | {
      type: 'completion';
      status: 'failed';
      message: string;
      partialText?: string;
      sessionId?: string;
      durationMs?: number;
      costUsd?: number;
      numTurns?: number;
    }
  | {
      type: 'completion';
      status: 'aborted';
      reason: 'user' | 'timeout';
      partialText?: string;
      sessionId?: string;
      durationMs?: number;
      costUsd?: number;
      numTurns?: number;
    };

export type StreamEvent =
  | { type: 'text'; content: string }
  | { type: 'tool_call'; name: string; args: string }
  | { type: 'tool_result'; content: string }
  | { type: 'warning'; message: string }
  | { type: 'error'; message: string }
  | { type: 'done'; sessionId?: string; durationMs?: number; costUsd?: number; numTurns?: number; fullText?: string }
  | CompletionEvent;

export interface InvokeOpts {
  workspace: string;
  skillPaths: string[];
  sessionId?: string;
  model?: string;
  apiKey?: string;
  skipPermissions?: boolean;
  codex?: CodexConfig;
  signal?: AbortSignal;
  /** Absolute paths to image files attached to the user message. Engines may use these for native multimodal support. */
  imagePaths?: string[];
  /** When true, the workspace has a .cursor/cli.json with granular permissions; do not pass --trust. */
  hasPermissionsConfig?: boolean;
  /** Provider config from golem.yaml, for custom LLM API routing */
  provider?: ProviderConfig;
  /** Claude Max OAuth token (from `claude setup-token`). Claude Code engine only. */
  oauthToken?: string;
  /** MCP server configurations from golem.yaml, written to engine-native config format. */
  mcpConfig?: Record<string, McpServerConfig>;
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
export {
  buildCodexExecArgs,
  CodexEngine,
  injectCodexSkills,
  parseCodexStreamLine,
  resolveCodexMode,
} from './engines/codex.js';
export { CursorEngine, injectSkills, parseStreamLine } from './engines/cursor.js';
export {
  buildGrokArgs,
  findGrokBin,
  GrokEngine,
  injectGrokSkills,
  parseGrokStreamLine,
  writeGrokMcpConfig,
} from './engines/grok.js';
export {
  ensureOpenCodeConfig,
  injectOpenCodeSkills,
  OpenCodeEngine,
  parseOpenCodeStreamLine,
  resolveOpenCodeEnv,
} from './engines/opencode.js';
export {
  claudeProviderEnv,
  codexProviderEnv,
  cursorProviderEnv,
  grokProviderEnv,
  openCodeProviderEnv,
} from './engines/provider-env.js';
export { type DiscoveredEngine, discoverEngines, isOnPath, stripAnsi } from './engines/shared.js';

// ── Engine factory ───────────────────────────────────────

import { ClaudeCodeEngine } from './engines/claude-code.js';
import { CodexEngine } from './engines/codex.js';
import { CursorEngine } from './engines/cursor.js';
import { GrokEngine } from './engines/grok.js';
import { OpenCodeEngine } from './engines/opencode.js';

export function createEngine(type: string): AgentEngine {
  if (type === 'cursor') return new CursorEngine();
  if (type === 'claude-code') return new ClaudeCodeEngine();
  if (type === 'opencode') return new OpenCodeEngine();
  if (type === 'codex') return new CodexEngine();
  if (type === 'grok') return new GrokEngine();
  throw new Error(`Unsupported engine: ${type}. Supported: 'cursor', 'claude-code', 'opencode', 'codex', 'grok'.`);
}
