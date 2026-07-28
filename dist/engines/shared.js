import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter } from 'node:path';
import crossSpawn from 'cross-spawn';
const ANSI_RE = /\x1b\[[^a-zA-Z]*[a-zA-Z]/g;
export function stripAnsi(s) {
    return s.replace(ANSI_RE, '');
}
export function resolveOnPath(cmd) {
    try {
        const output = execFileSync(process.platform === 'win32' ? 'where' : 'which', [cmd], {
            stdio: ['ignore', 'pipe', 'ignore'],
            encoding: 'utf-8',
        });
        return output
            .split(/\r?\n/)
            .map((line) => line.trim())
            .find((line) => line.length > 0);
    }
    catch {
        return undefined;
    }
}
export function isOnPath(cmd) {
    return !!resolveOnPath(cmd);
}
export function resolveCliBinary(command, localPath, platform = process.platform) {
    const resolved = resolveOnPath(command);
    const hasLocal = !!localPath && existsSync(localPath);
    if (platform === 'win32')
        return resolved ?? (hasLocal ? localPath : undefined);
    return hasLocal ? localPath : resolved;
}
export function prependPathEntries(currentPath, entries, pathDelimiter = delimiter) {
    return [...entries.filter((entry) => entry.length > 0), currentPath]
        .filter((value) => !!value)
        .join(pathDelimiter);
}
export function spawnCommand(command, args, options) {
    const resolved = resolveOnPath(command) || command;
    if (process.platform === 'win32') {
        const shimBase = /\.cmd$/i.test(resolved)
            ? resolved.replace(/\.cmd$/i, '')
            : /\.ps1$/i.test(resolved)
                ? resolved.replace(/\.ps1$/i, '')
                : /\.[^\\/]+$/i.test(resolved)
                    ? undefined
                    : resolved;
        const ps1Path = shimBase ? `${shimBase}.ps1` : undefined;
        const cmdPath = shimBase ? `${shimBase}.cmd` : undefined;
        const powershell = resolveOnPath('powershell.exe') || resolveOnPath('pwsh.exe');
        if (ps1Path && existsSync(ps1Path) && powershell) {
            return crossSpawn(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1Path, ...args], options);
        }
        if (cmdPath && existsSync(cmdPath)) {
            return crossSpawn(cmdPath, args, options);
        }
    }
    return crossSpawn(resolved, args, options);
}
const ENGINE_BINARIES = {
    'claude-code': 'claude',
    cursor: 'agent',
    opencode: 'opencode',
    codex: 'codex',
    grok: 'grok',
};
/** Discover which CLI engines are installed on the system. */
export async function discoverEngines() {
    const results = [];
    for (const [name, binary] of Object.entries(ENGINE_BINARIES)) {
        const resolved = resolveOnPath(binary);
        if (resolved) {
            results.push({ name, binary, path: resolved });
        }
    }
    return results;
}
//# sourceMappingURL=shared.js.map