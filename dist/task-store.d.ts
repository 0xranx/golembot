import type { ScheduledTaskDef } from './scheduler.js';
export type { ScheduledTaskDef, TaskTarget } from './scheduler.js';
export interface TaskRecord extends ScheduledTaskDef {
    createdAt: string;
    createdBy?: string;
    lastRun?: string;
    lastStatus?: 'success' | 'error';
    lastError?: string;
}
export interface TaskExecution {
    taskId: string;
    taskName: string;
    startedAt: string;
    completedAt: string;
    status: 'success' | 'error';
    reply: string;
    durationMs: number;
    costUsd?: number;
    error?: string;
}
export declare class TaskStore {
    private dir;
    constructor(dir: string);
    load(): Promise<TaskRecord[]>;
    save(tasks: TaskRecord[]): Promise<void>;
    addTask(task: TaskRecord): Promise<void>;
    removeTask(id: string): Promise<boolean>;
    getTask(id: string): Promise<TaskRecord | undefined>;
    updateTask(id: string, patch: Partial<TaskRecord>): Promise<boolean>;
    listTasks(): Promise<TaskRecord[]>;
    mergeConfigTasks(configTasks: ScheduledTaskDef[]): Promise<TaskRecord[]>;
    recordExecution(exec: TaskExecution): Promise<void>;
    getHistory(taskId: string, limit?: number): Promise<TaskExecution[]>;
}
//# sourceMappingURL=task-store.d.ts.map