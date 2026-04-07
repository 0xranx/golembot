import type { ChannelAdapter } from './channel.js';
import type { StreamEvent } from './engine.js';
import type { Scheduler } from './scheduler.js';
import type { TaskRecord, TaskStore } from './task-store.js';
interface ChatAssistant {
    chat(message: string, opts: {
        sessionKey: string;
    }): AsyncIterable<StreamEvent>;
}
export interface ProactiveCoordinatorOpts {
    assistant: ChatAssistant;
    taskStore: TaskStore;
    adapters: Map<string, ChannelAdapter>;
    scheduler: Scheduler;
    verbose?: boolean;
}
export declare class ProactiveCoordinator {
    private assistant;
    private taskStore;
    private adapters;
    private scheduler;
    private verbose;
    constructor(opts: ProactiveCoordinatorOpts);
    /** Register all enabled tasks with the scheduler and start ticking. */
    start(tasks: TaskRecord[]): void;
    /** Stop all scheduled timers. */
    stop(): void;
    /** Manually trigger a task by id. Returns the reply text or throws. */
    runTask(taskId: string): Promise<string>;
    private executeTask;
}
export declare function createProactiveCoordinator(opts: ProactiveCoordinatorOpts): ProactiveCoordinator;
export {};
//# sourceMappingURL=proactive.d.ts.map