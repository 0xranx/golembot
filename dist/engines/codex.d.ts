import type { AgentEngine, InvokeOpts, ListModelsOpts, StreamEvent } from '../engine.js';
export declare function resolveCodexMode(opts: Pick<InvokeOpts, 'codex'>): 'safe' | 'unrestricted';
export declare function buildCodexExecArgs(prompt: string, opts: Pick<InvokeOpts, 'codex' | 'imagePaths' | 'model' | 'provider' | 'sessionId' | 'workspace'>): string[];
/**
 * Parse a single NDJSON line from `codex exec --json`.
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
export declare function parseCodexStreamLine(line: string, state: {
    threadId?: string;
}): StreamEvent[];
/**
 * Inject GolemBot skills into `.agents/skills/` so Codex can discover them
 * via its native skill mechanism (progressive disclosure).
 * AGENTS.md is still generated separately by workspace.ts for persistent instructions.
 */
export declare function injectCodexSkills(workspace: string, skillPaths: string[]): Promise<void>;
export declare class CodexEngine implements AgentEngine {
    invoke(prompt: string, opts: InvokeOpts): AsyncIterable<StreamEvent>;
    listModels(opts: ListModelsOpts): Promise<string[]>;
}
//# sourceMappingURL=codex.d.ts.map