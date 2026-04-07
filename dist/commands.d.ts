/**
 * Slash commands — unified command handling for CLI, HTTP API, and IM Gateway.
 *
 * Commands are parsed and executed here; the caller is responsible for rendering
 * the CommandResult in the appropriate format (terminal, SSE, IM reply, etc.).
 */
import type { Scheduler } from './scheduler.js';
import type { TaskStore } from './task-store.js';
import { type GolemConfig, type SkillInfo } from './workspace.js';
export interface CommandResult {
    /** Human-readable text output (may contain markdown). */
    text: string;
    /** Structured data for JSON consumers (HTTP API --json). */
    data?: Record<string, unknown>;
}
/** Runtime context provided by the caller (gateway / server / CLI). */
export interface CommandContext {
    /** Assistant working directory. */
    dir: string;
    /** Read current runtime config + skills. */
    getStatus: () => Promise<{
        config: GolemConfig;
        skills: SkillInfo[];
        engine: string;
        model: string | undefined;
    }>;
    /** Switch engine at runtime (takes effect on next chat). When clearModel is true, also resets the model. */
    setEngine: (engine: string, clearModel?: boolean) => void;
    /** Switch model at runtime (takes effect on next chat). */
    setModel: (model: string) => void;
    /** Reset the session for the given key. */
    resetSession: (sessionKey?: string) => Promise<void>;
    /** Cancel the currently running invocation for the given key. */
    cancelSession: (sessionKey?: string) => Promise<boolean>;
    /** List available models for the current engine. */
    listModels: () => Promise<string[]>;
    /** Current session key (for reset). */
    sessionKey?: string;
    /** Task store for /cron commands (only available in gateway mode). */
    taskStore?: TaskStore;
    /** Scheduler for /cron commands (only available in gateway mode). */
    scheduler?: Scheduler;
    /** Run a scheduled task immediately. */
    runTask?: (taskId: string) => Promise<string>;
}
interface ParsedCommand {
    name: string;
    args: string[];
}
/**
 * Parse a user message into a command. Returns null if the message is not a
 * slash command (i.e. should be forwarded to the agent).
 */
export declare function parseCommand(text: string): ParsedCommand | null;
/**
 * Execute a parsed slash command. Returns a CommandResult with text output
 * and optional structured data.
 *
 * Returns null if the command is not recognized (caller should forward to agent).
 */
export declare function executeCommand(cmd: ParsedCommand, ctx: CommandContext): Promise<CommandResult | null>;
export {};
//# sourceMappingURL=commands.d.ts.map