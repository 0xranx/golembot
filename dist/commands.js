/**
 * Slash commands — unified command handling for CLI, HTTP API, and IM Gateway.
 *
 * Commands are parsed and executed here; the caller is responsible for rendering
 * the CommandResult in the appropriate format (terminal, SSE, IM reply, etc.).
 */
// ── Known engines (for validation) ──────────────────────
const KNOWN_ENGINES = ['cursor', 'claude-code', 'opencode', 'codex', 'grok'];
// ── Parse ────────────────────────────────────────────────
/**
 * Parse a user message into a command. Returns null if the message is not a
 * slash command (i.e. should be forwarded to the agent).
 */
export function parseCommand(text) {
    const trimmed = text.trim();
    if (!trimmed.startsWith('/'))
        return null;
    const parts = trimmed.split(/\s+/);
    const name = parts[0].toLowerCase();
    const args = parts.slice(1);
    return { name, args };
}
// ── Execute ──────────────────────────────────────────────
const COMMANDS = {
    '/help': 'Show available commands',
    '/status': 'Show current engine, model, and skills',
    '/engine': 'Show or switch engine — /engine [name]',
    '/model': 'Show, switch, or list models — /model [list|name]',
    '/skill': 'List installed skills',
    '/reset': 'Clear the current session and history',
    '/stop': 'Stop the current running task',
    '/cron': 'Manage scheduled tasks — /cron [list|run|enable|disable|del|history] [id]',
};
/**
 * Execute a parsed slash command. Returns a CommandResult with text output
 * and optional structured data.
 *
 * Returns null if the command is not recognized (caller should forward to agent).
 */
export async function executeCommand(cmd, ctx) {
    switch (cmd.name) {
        case '/help':
            return cmdHelp();
        case '/status':
            return cmdStatus(ctx);
        case '/engine':
            return cmdEngine(cmd.args, ctx);
        case '/model':
            return cmdModel(cmd.args, ctx);
        case '/skill':
            return cmdSkill(ctx);
        case '/reset':
            return cmdReset(ctx);
        case '/stop':
            return cmdStop(ctx);
        case '/cron':
            return cmdCron(cmd.args, ctx);
        default:
            return null;
    }
}
// ── Command implementations ──────────────────────────────
function cmdHelp() {
    const lines = Object.entries(COMMANDS).map(([cmd, desc]) => `  ${cmd.padEnd(12)} ${desc}`);
    return {
        text: `Available commands:\n${lines.join('\n')}`,
        data: { commands: COMMANDS },
    };
}
async function cmdStatus(ctx) {
    const { config, skills, engine, model } = await ctx.getStatus();
    const channelNames = config.channels
        ? Object.keys(config.channels).filter((k) => !!config.channels[k])
        : [];
    const lines = [
        `Name:      ${config.name}`,
        `Engine:    ${engine}`,
        model ? `Model:     ${model}` : null,
        `Skills:    ${skills.length > 0 ? skills.map((s) => s.name).join(', ') : '(none)'}`,
        channelNames.length > 0 ? `Channels:  ${channelNames.join(', ')}` : null,
    ].filter(Boolean);
    return {
        text: lines.join('\n'),
        data: {
            name: config.name,
            engine,
            model: model ?? null,
            skills: skills.map((s) => ({ name: s.name, description: s.description })),
            channels: channelNames,
        },
    };
}
async function cmdEngine(args, ctx) {
    if (args.length === 0) {
        const { engine } = await ctx.getStatus();
        return {
            text: `Current engine: ${engine}\nAvailable: ${KNOWN_ENGINES.join(', ')}\nSwitch: /engine <name>`,
            data: { current: engine, available: KNOWN_ENGINES },
        };
    }
    const target = args[0].toLowerCase();
    if (!KNOWN_ENGINES.includes(target)) {
        return {
            text: `Unknown engine: ${target}\nAvailable: ${KNOWN_ENGINES.join(', ')}`,
            data: { error: 'unknown_engine', available: KNOWN_ENGINES },
        };
    }
    const { model: prevModel } = await ctx.getStatus();
    // Clear model when switching engines — model name formats are engine-specific
    // (e.g. opencode uses "openrouter/anthropic/claude-sonnet-4-5", claude-code uses "claude-sonnet-4-6")
    ctx.setEngine(target, !!prevModel);
    return {
        text: `Engine switched to: ${target} (takes effect on next message)${prevModel ? '\nModel reset to engine default (formats differ between engines)' : ''}`,
        data: { engine: target, modelReset: !!prevModel },
    };
}
async function cmdModel(args, ctx) {
    if (args.length === 0) {
        const { model, engine } = await ctx.getStatus();
        return {
            text: model
                ? `Current model: ${model} (engine: ${engine})\nSwitch: /model <name>\nList available: /model list`
                : `No model override (using ${engine} default)\nSwitch: /model <name>\nList available: /model list`,
            data: { current: model ?? null, engine },
        };
    }
    if (args[0].toLowerCase() === 'list') {
        return cmdModelList(ctx);
    }
    const target = args.join(' ');
    ctx.setModel(target);
    return {
        text: `Model switched to: ${target} (takes effect on next message)`,
        data: { model: target },
    };
}
async function cmdModelList(ctx) {
    const { engine } = await ctx.getStatus();
    const models = await ctx.listModels();
    if (models.length === 0) {
        return {
            text: `No models found for engine: ${engine}`,
            data: { engine, models: [] },
        };
    }
    const lines = models.map((m) => `  ${m}`);
    return {
        text: `Available models for ${engine} (${models.length}):\n${lines.join('\n')}`,
        data: { engine, models },
    };
}
async function cmdSkill(ctx) {
    const { skills } = await ctx.getStatus();
    if (skills.length === 0) {
        return { text: 'No skills installed.', data: { skills: [] } };
    }
    const lines = skills.map((s) => `  ${s.name.padEnd(20)} ${s.description}`);
    return {
        text: `Installed skills (${skills.length}):\n${lines.join('\n')}`,
        data: { skills: skills.map((s) => ({ name: s.name, description: s.description })) },
    };
}
async function cmdReset(ctx) {
    await ctx.resetSession(ctx.sessionKey);
    return {
        text: 'Session and history reset.',
        data: { ok: true, reset: true },
    };
}
async function cmdStop(ctx) {
    const stopped = await ctx.cancelSession(ctx.sessionKey);
    if (!stopped) {
        return {
            text: 'No running task to stop.',
            data: { ok: true, stopped: false },
        };
    }
    return {
        text: 'Stopped the current task.',
        data: { ok: true, stopped: true },
    };
}
// ── /cron ────────────────────────────────────────────────
async function cmdCron(args, ctx) {
    if (!ctx.taskStore) {
        return { text: 'Scheduled tasks are only available in gateway mode.' };
    }
    const sub = (args[0] ?? 'list').toLowerCase();
    const rawId = args.slice(1).join(' ') || undefined;
    // Resolve name → id if rawId doesn't match any task id directly
    let id = rawId;
    if (rawId) {
        const tasks = await ctx.taskStore.listTasks();
        const byId = tasks.find((t) => t.id === rawId);
        if (!byId) {
            const byName = tasks.find((t) => t.name === rawId);
            if (byName)
                id = byName.id;
        }
    }
    switch (sub) {
        case 'list':
            return cronList(ctx);
        case 'run':
            return cronRun(id, ctx);
        case 'enable':
            return cronSetEnabled(id, true, ctx);
        case 'disable':
            return cronSetEnabled(id, false, ctx);
        case 'del':
        case 'delete':
        case 'rm':
            return cronDel(id, ctx);
        case 'history':
            return cronHistory(id, ctx);
        default:
            return {
                text: `Unknown subcommand: ${sub}\nUsage: /cron [list|run|enable|disable|del|history] [id]`,
            };
    }
}
async function cronList(ctx) {
    const tasks = await ctx.taskStore.listTasks();
    if (tasks.length === 0) {
        return { text: 'No scheduled tasks.', data: { tasks: [] } };
    }
    const lines = tasks.map((t) => {
        const status = t.enabled ? 'ON ' : 'OFF';
        const last = t.lastRun ? `${t.lastStatus ?? '?'} @ ${t.lastRun.replace('T', ' ').slice(0, 19)}` : 'never';
        return `  ${t.id}  ${status}  ${t.schedule.padEnd(18)}  ${t.name.padEnd(20)}  last: ${last}`;
    });
    return {
        text: `Scheduled tasks (${tasks.length}):\n${lines.join('\n')}`,
        data: {
            tasks: tasks.map((t) => ({
                id: t.id,
                name: t.name,
                schedule: t.schedule,
                enabled: t.enabled,
                lastRun: t.lastRun ?? null,
                lastStatus: t.lastStatus ?? null,
            })),
        },
    };
}
async function cronRun(id, ctx) {
    if (!id)
        return { text: 'Usage: /cron run <id>' };
    if (!ctx.runTask) {
        return { text: 'Not available (gateway mode only).' };
    }
    const reply = await ctx.runTask(id);
    return { text: reply, data: { taskId: id, reply } };
}
async function cronSetEnabled(id, enabled, ctx) {
    if (!id)
        return { text: `Usage: /cron ${enabled ? 'enable' : 'disable'} <id>` };
    const ok = await ctx.taskStore.updateTask(id, { enabled });
    if (!ok)
        return { text: `Task not found: ${id}` };
    if (ctx.scheduler) {
        if (enabled)
            ctx.scheduler.enableTask(id);
        else
            ctx.scheduler.disableTask(id);
    }
    return {
        text: `Task ${id} ${enabled ? 'enabled' : 'disabled'}.`,
        data: { taskId: id, enabled },
    };
}
async function cronDel(id, ctx) {
    if (!id)
        return { text: 'Usage: /cron del <id>' };
    const ok = await ctx.taskStore.removeTask(id);
    if (!ok)
        return { text: `Task not found: ${id}` };
    if (ctx.scheduler)
        ctx.scheduler.removeTask(id);
    return {
        text: `Task ${id} deleted.`,
        data: { taskId: id, deleted: true },
    };
}
async function cronHistory(id, ctx) {
    if (!id)
        return { text: 'Usage: /cron history <id>' };
    const entries = await ctx.taskStore.getHistory(id, 10);
    if (entries.length === 0) {
        return { text: `No history for task ${id}.`, data: { taskId: id, history: [] } };
    }
    const lines = entries.map((e) => {
        const time = e.startedAt.replace('T', ' ').slice(0, 19);
        const dur = e.durationMs < 1000 ? `${e.durationMs}ms` : `${(e.durationMs / 1000).toFixed(1)}s`;
        const preview = e.reply.length > 80 ? `${e.reply.slice(0, 80)}…` : e.reply;
        return `  ${time}  ${e.status.padEnd(7)}  ${dur.padEnd(8)}  ${preview}`;
    });
    return {
        text: `History for task ${id} (last ${entries.length}):\n${lines.join('\n')}`,
        data: {
            taskId: id,
            history: entries.map((e) => ({
                startedAt: e.startedAt,
                status: e.status,
                durationMs: e.durationMs,
                reply: e.reply,
            })),
        },
    };
}
//# sourceMappingURL=commands.js.map