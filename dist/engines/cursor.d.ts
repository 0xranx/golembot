import type { AgentEngine, InvokeOpts, ListModelsOpts, StreamEvent } from '../engine.js';
export declare function parseStreamLine(line: string): StreamEvent | null;
export declare function injectSkills(workspace: string, skillPaths: string[]): Promise<void>;
export declare class CursorEngine implements AgentEngine {
    invoke(prompt: string, opts: InvokeOpts): AsyncIterable<StreamEvent>;
    listModels(_opts: ListModelsOpts): Promise<string[]>;
}
//# sourceMappingURL=cursor.d.ts.map