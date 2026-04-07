import { type SpawnOptions } from 'node:child_process';
export declare function stripAnsi(s: string): string;
export declare function resolveOnPath(cmd: string): string | undefined;
export declare function isOnPath(cmd: string): boolean;
export declare function resolveCliBinary(command: string, localPath?: string, platform?: NodeJS.Platform): string | undefined;
export declare function prependPathEntries(currentPath: string | undefined, entries: string[], pathDelimiter?: string): string;
export declare function spawnCommand(command: string, args: string[], options: SpawnOptions): import("child_process").ChildProcess;
export interface DiscoveredEngine {
    name: string;
    binary: string;
    path?: string;
}
/** Discover which CLI engines are installed on the system. */
export declare function discoverEngines(): Promise<DiscoveredEngine[]>;
//# sourceMappingURL=shared.d.ts.map