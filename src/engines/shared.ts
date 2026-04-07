import { execFileSync, type SpawnOptions } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter } from 'node:path';
import crossSpawn from 'cross-spawn';

const ANSI_RE = /\x1b\[[^a-zA-Z]*[a-zA-Z]/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

export function resolveOnPath(cmd: string): string | undefined {
  try {
    const output = execFileSync(process.platform === 'win32' ? 'where' : 'which', [cmd], {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf-8',
    });
    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0);
  } catch {
    return undefined;
  }
}

export function isOnPath(cmd: string): boolean {
  return !!resolveOnPath(cmd);
}

export function resolveCliBinary(command: string, localPath?: string, platform: NodeJS.Platform = process.platform) {
  const resolved = resolveOnPath(command);
  const hasLocal = !!localPath && existsSync(localPath);
  if (platform === 'win32') return resolved ?? (hasLocal ? localPath : undefined);
  return hasLocal ? localPath : resolved;
}

export function prependPathEntries(
  currentPath: string | undefined,
  entries: string[],
  pathDelimiter: string = delimiter,
): string {
  return [...entries.filter((entry) => entry.length > 0), currentPath]
    .filter((value): value is string => !!value)
    .join(pathDelimiter);
}

export function spawnCommand(command: string, args: string[], options: SpawnOptions) {
  const resolved = resolveOnPath(command) || command;
  return crossSpawn(resolved, args, options);
}

// ── Engine discovery ─────────────────────────────────────

export interface DiscoveredEngine {
  name: string;
  binary: string;
  path?: string;
}

const ENGINE_BINARIES: Record<string, string> = {
  'claude-code': 'claude',
  cursor: 'agent',
  opencode: 'opencode',
  codex: 'codex',
};

/** Discover which CLI engines are installed on the system. */
export async function discoverEngines(): Promise<DiscoveredEngine[]> {
  const results: DiscoveredEngine[] = [];
  for (const [name, binary] of Object.entries(ENGINE_BINARIES)) {
    const resolved = resolveOnPath(binary);
    if (resolved) {
      results.push({ name, binary, path: resolved });
    }
  }
  return results;
}
