// ---------------------------------------------------------------------------
// Coordinator
// ---------------------------------------------------------------------------
export class ProactiveCoordinator {
    assistant;
    taskStore;
    adapters;
    scheduler;
    verbose;
    constructor(opts) {
        this.assistant = opts.assistant;
        this.taskStore = opts.taskStore;
        this.adapters = opts.adapters;
        this.scheduler = opts.scheduler;
        this.verbose = opts.verbose ?? false;
    }
    /** Register all enabled tasks with the scheduler and start ticking. */
    start(tasks) {
        for (const task of tasks) {
            this.scheduler.addTask(task, async (def) => {
                await this.executeTask(def);
            });
        }
    }
    /** Stop all scheduled timers. */
    stop() {
        this.scheduler.stop();
    }
    /** Manually trigger a task by id. Returns the reply text or throws. */
    async runTask(taskId) {
        const task = await this.taskStore.getTask(taskId);
        if (!task)
            throw new Error(`Task not found: ${taskId}`);
        return this.executeTask(task);
    }
    // ── Internal ────────────────────────────────────────────
    async executeTask(task) {
        const startedAt = new Date().toISOString();
        const t0 = Date.now();
        let reply = '';
        let costUsd;
        let durationMs;
        let error;
        try {
            const stream = this.assistant.chat(task.prompt, {
                sessionKey: `task:${task.id}`,
            });
            for await (const event of stream) {
                if (event.type === 'text') {
                    reply += event.content;
                }
                else if (event.type === 'done') {
                    costUsd = event.costUsd;
                    durationMs = event.durationMs;
                }
            }
            // Deliver to channel if target is configured
            if (task.target) {
                const adapter = this.adapters.get(task.target.channel);
                if (adapter?.send) {
                    if (task.target.chatId) {
                        await adapter.send(task.target.chatId, reply.trim());
                    }
                    else if (adapter.listChats) {
                        // No chatId specified — broadcast to all known chats
                        const chats = await adapter.listChats();
                        for (const chat of chats) {
                            await adapter.send(chat.chatId, reply.trim());
                        }
                    }
                }
            }
        }
        catch (err) {
            error = err instanceof Error ? err.message : String(err);
        }
        const completedAt = new Date().toISOString();
        const wallMs = durationMs ?? Date.now() - t0;
        const status = error ? 'error' : 'success';
        // Record execution history
        const exec = {
            taskId: task.id,
            taskName: task.name,
            startedAt,
            completedAt,
            status,
            reply: error ? '' : reply.trim(),
            durationMs: wallMs,
            costUsd,
            error,
        };
        await this.taskStore.recordExecution(exec);
        // Update task runtime state
        await this.taskStore.updateTask(task.id, {
            lastRun: completedAt,
            lastStatus: status,
            lastError: error,
        });
        if (this.verbose) {
            const cost = costUsd != null ? ` $${costUsd.toFixed(4)}` : '';
            const summary = error
                ? `[task:${task.id}] ${task.name} FAILED (${wallMs}ms): ${error}`
                : `[task:${task.id}] ${task.name} OK (${wallMs}ms${cost}) ${reply.length} chars`;
            console.log(summary);
        }
        if (error)
            throw new Error(error);
        return reply.trim();
    }
}
// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------
export function createProactiveCoordinator(opts) {
    return new ProactiveCoordinator(opts);
}
//# sourceMappingURL=proactive.js.map