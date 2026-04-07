import type { AgentEngine, InvokeOpts, ListModelsOpts, StreamEvent } from '../engine.js';
export declare function parseClaudeStreamLine(line: string): StreamEvent[];
export declare function injectClaudeSkills(workspace: string, skillPaths: string[], _skillDescriptions?: Array<{
    name: string;
    description: string;
}>): Promise<void>;
export declare class ClaudeCodeEngine implements AgentEngine {
    invoke(prompt: string, opts: InvokeOpts): AsyncIterable<StreamEvent>;
    listModels(opts: ListModelsOpts): Promise<string[]>;
}
//# sourceMappingURL=claude-code.d.ts.map