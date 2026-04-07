export interface FleetEntry {
    name: string;
    url: string;
    pid: number;
    engine: string;
    model?: string;
    version: string;
    startedAt: string;
    channels: {
        type: string;
        status: string;
    }[];
    authEnabled: boolean;
    dir: string;
    /** Bot's persona role (e.g. "product analyst", "user researcher") for multi-bot peer awareness. */
    role?: string;
}
export interface FleetInstance extends FleetEntry {
    alive: boolean;
    metrics?: {
        totalMessages: number;
        totalCostUsd: number;
        avgDurationMs: number;
        uptime: number;
    };
}
export declare function registerInstance(entry: FleetEntry, fleetDir?: string): Promise<void>;
export declare function unregisterInstance(name: string, port: number, fleetDir?: string): Promise<void>;
export declare function isProcessAlive(pid: number): boolean;
export declare function listInstances(fleetDir?: string): Promise<FleetInstance[]>;
export declare function fetchInstanceMetrics(instance: FleetInstance): Promise<FleetInstance>;
export declare function stopInstance(instance: FleetInstance, fleetDir?: string): Promise<void>;
export declare function startInstance(entry: FleetEntry & {
    stopped?: boolean;
}, fleetDir?: string): Promise<{
    pid: number;
}>;
/** List stopped bots (those stopped via fleet but not restarted) */
export declare function listStoppedInstances(fleetDir?: string): Promise<(FleetEntry & {
    stopped: true;
})[]>;
export declare function findInstance(nameOrPort: string, fleetDir?: string): Promise<FleetInstance | undefined>;
export declare function findStoppedInstance(nameOrPort: string, fleetDir?: string): Promise<(FleetEntry & {
    stopped: true;
}) | undefined>;
export declare function renderFleetDashboard(instances: FleetInstance[], version: string, stoppedInstances?: (FleetEntry & {
    stopped: true;
})[]): string;
export interface FleetServerOpts {
    port?: number;
    hostname?: string;
}
export declare function startFleetServer(opts?: FleetServerOpts, fleetDir?: string): Promise<void>;
//# sourceMappingURL=fleet.d.ts.map