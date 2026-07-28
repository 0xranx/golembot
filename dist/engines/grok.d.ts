import type { AgentEngine, InvokeOpts, ListModelsOpts, StreamEvent } from '../engine.js';
import type { McpServerConfig } from '../workspace.js';
/**
 * Build CLI args for headless Grok Build:
 *   grok -p <prompt> --output-format streaming-json --cwd <workspace> [--always-approve]
 *        [--resume <sessionId>] [-m <model>]
 */
export declare function buildGrokArgs(prompt: string, opts: Pick<InvokeOpts, 'imagePaths' | 'model' | 'sessionId' | 'skipPermissions' | 'workspace'>): string[];
/**
 * Parse a single NDJSON line from `grok -p ... --output-format streaming-json`.
 *
 * Documented event shapes:
 *   - { type: "text", data: "..." }
 *   - { type: "thought", data: "..." }
 *   - { type: "end", stopReason: "EndTurn", sessionId: "...", requestId: "..." }
 *   - { type: "error", message: "..." }
 *
 * Also tolerates the non-streaming json object:
 *   - { text: "...", sessionId: "...", stopReason: "EndTurn" }
 *
 * @param state Mutable state; sessionId is stored when seen on end events.
 */
export declare function parseGrokStreamLine(line: string, state: {
    sessionId?: string;
}): StreamEvent[];
/**
 * Inject GolemBot skills into `.grok/skills/` so Grok Build discovers them natively.
 * AGENTS.md is still generated separately by workspace.ts for persistent instructions.
 */
export declare function injectGrokSkills(workspace: string, skillPaths: string[]): Promise<void>;
/**
 * Write golem.yaml MCP servers into project-scoped `.grok/config.toml`.
 * Grok loads project MCP from this file (stdio transport).
 */
export declare function writeGrokMcpConfig(workspace: string, mcpConfig: Record<string, McpServerConfig>): Promise<void>;
export declare function findGrokBin(): string;
export declare class GrokEngine implements AgentEngine {
    invoke(prompt: string, opts: InvokeOpts): AsyncIterable<StreamEvent>;
    listModels(_opts: ListModelsOpts): Promise<string[]>;
}
//# sourceMappingURL=grok.d.ts.map