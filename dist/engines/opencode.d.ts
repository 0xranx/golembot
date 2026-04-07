import type { AgentEngine, InvokeOpts, ListModelsOpts, StreamEvent } from '../engine.js';
export declare function resolveOpenCodeEnv(model?: string, apiKey?: string): Record<string, string>;
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
export declare function parseOpenCodeStreamLine(line: string): StreamEvent[];
export declare function injectOpenCodeSkills(workspace: string, skillPaths: string[]): Promise<void>;
export declare function ensureOpenCodeConfig(workspace: string, model?: string, mcpConfig?: Record<string, import('../workspace.js').McpServerConfig>): Promise<void>;
export declare class OpenCodeEngine implements AgentEngine {
    invoke(prompt: string, opts: InvokeOpts): AsyncIterable<StreamEvent>;
    listModels(opts: ListModelsOpts): Promise<string[]>;
}
//# sourceMappingURL=opencode.d.ts.map