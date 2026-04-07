export interface CronFields {
    minutes: Set<number>;
    hours: Set<number>;
    daysOfMonth: Set<number>;
    months: Set<number>;
    daysOfWeek: Set<number>;
}
export interface ScheduledTaskDef {
    id: string;
    name: string;
    schedule: string;
    prompt: string;
    target?: TaskTarget;
    enabled: boolean;
    timeout?: number;
}
export interface TaskTarget {
    channel: string;
    /** Target chat ID. If omitted, sends to all known chats on the channel. */
    chatId?: string;
}
export type TaskHandler = (task: ScheduledTaskDef) => Promise<void>;
export declare function parseCron(expr: string): CronFields;
export declare function getNextCronTime(fields: CronFields, after?: Date): Date;
export declare function getNextCronDelay(expr: string, after?: Date): number;
export declare function normalizeSchedule(schedule: string): string;
export declare class Scheduler {
    private tasks;
    addTask(task: ScheduledTaskDef, handler: TaskHandler): void;
    removeTask(taskId: string): void;
    enableTask(taskId: string): void;
    disableTask(taskId: string): void;
    getNextRun(taskId: string): Date | null;
    stop(): void;
    private scheduleNext;
}
//# sourceMappingURL=scheduler.d.ts.map