import { execFileSync } from 'node:child_process';

const ANSI_RE = /\x1b\[[^a-zA-Z]*[a-zA-Z]/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

export function isOnPath(cmd: string): boolean {
  try {
    execFileSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
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
    if (isOnPath(binary)) {
      results.push({ name, binary });
    }
  }
  return results;
}
