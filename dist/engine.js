// ── Re-exports from engine implementations ───────────────
export { ClaudeCodeEngine, injectClaudeSkills, parseClaudeStreamLine } from './engines/claude-code.js';
export { buildCodexExecArgs, CodexEngine, injectCodexSkills, parseCodexStreamLine, resolveCodexMode, } from './engines/codex.js';
export { CursorEngine, injectSkills, parseStreamLine } from './engines/cursor.js';
export { ensureOpenCodeConfig, injectOpenCodeSkills, OpenCodeEngine, parseOpenCodeStreamLine, resolveOpenCodeEnv, } from './engines/opencode.js';
export { claudeProviderEnv, codexProviderEnv, cursorProviderEnv, openCodeProviderEnv } from './engines/provider-env.js';
export { discoverEngines, isOnPath, stripAnsi } from './engines/shared.js';
// ── Engine factory ───────────────────────────────────────
import { ClaudeCodeEngine } from './engines/claude-code.js';
import { CodexEngine } from './engines/codex.js';
import { CursorEngine } from './engines/cursor.js';
import { OpenCodeEngine } from './engines/opencode.js';
export function createEngine(type) {
    if (type === 'cursor')
        return new CursorEngine();
    if (type === 'claude-code')
        return new ClaudeCodeEngine();
    if (type === 'opencode')
        return new OpenCodeEngine();
    if (type === 'codex')
        return new CodexEngine();
    throw new Error(`Unsupported engine: ${type}. Supported: 'cursor', 'claude-code', 'opencode', 'codex'.`);
}
//# sourceMappingURL=engine.js.map