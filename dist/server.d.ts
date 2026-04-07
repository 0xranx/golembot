import type { Server as HttpServer } from 'node:http';
import { type DashboardContext } from './dashboard.js';
import type { Assistant } from './index.js';
import type { Scheduler } from './scheduler.js';
import type { TaskStore } from './task-store.js';
export interface CronContext {
    taskStore: TaskStore;
    scheduler: Scheduler;
    runTask: (id: string) => Promise<string>;
}
export interface ServerOpts {
    port?: number;
    token?: string;
    hostname?: string;
    onShutdown?: () => Promise<void> | void;
}
/** http.Server extended with a forceClose() method for clean shutdown. */
export interface GolemServer extends HttpServer {
    /** Close all active SSE connections and stop the server. */
    forceClose(): void;
}
export declare function createGolemServer(assistant: Assistant, opts?: ServerOpts, dashboard?: DashboardContext, dir?: string, getCronCtx?: () => CronContext | undefined, getAdapters?: () => Map<string, import('./channel.js').ChannelAdapter>): GolemServer;
export declare function startServer(assistant: Assistant, opts?: ServerOpts, dir?: string): Promise<void>;
//# sourceMappingURL=server.d.ts.map