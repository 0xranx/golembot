import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  registerInstance,
  unregisterInstance,
  isProcessAlive,
  listInstances,
  listStoppedInstances,
  stopInstance,
  findInstance,
  findStoppedInstance,
  renderFleetDashboard,
  type FleetEntry,
  type FleetInstance,
} from '../fleet.js';

function makeEntry(overrides?: Partial<FleetEntry>): FleetEntry {
  return {
    name: 'test-bot',
    url: 'http://127.0.0.1:3000',
    pid: process.pid, // current process is always alive
    engine: 'claude-code',
    model: 'claude-opus-4-6',
    version: '1.0.0',
    startedAt: new Date().toISOString(),
    channels: [{ type: 'telegram', status: 'connected' }],
    authEnabled: false,
    dir: '/tmp/test-bot',
    ...overrides,
  };
}

let fleetDir: string;

beforeEach(async () => {
  fleetDir = await mkdtemp(join(tmpdir(), 'golem-fleet-'));
});

afterEach(async () => {
  await rm(fleetDir, { recursive: true, force: true });
});

// ── Registry I/O ─────────────────────────────────────────────────────────────

describe('registerInstance', () => {
  it('creates directory and writes JSON file', async () => {
    const entry = makeEntry();
    await registerInstance(entry, fleetDir);
    const files = await readdir(fleetDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toBe('test-bot-3000.json');
    const content = JSON.parse(await readFile(join(fleetDir, files[0]), 'utf-8'));
    expect(content.name).toBe('test-bot');
    expect(content.pid).toBe(process.pid);
  });

  it('handles special characters in bot name', async () => {
    const entry = makeEntry({ name: 'my bot @#$' });
    await registerInstance(entry, fleetDir);
    const files = await readdir(fleetDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^my-bot-+-3000\.json$/);
  });
});

describe('unregisterInstance', () => {
  it('removes the registration file', async () => {
    await registerInstance(makeEntry(), fleetDir);
    expect(await readdir(fleetDir)).toHaveLength(1);
    await unregisterInstance('test-bot', 3000, fleetDir);
    expect(await readdir(fleetDir)).toHaveLength(0);
  });

  it('does not throw for non-existent file', async () => {
    await expect(unregisterInstance('no-bot', 9999, fleetDir)).resolves.not.toThrow();
  });
});

describe('isProcessAlive', () => {
  it('returns true for current process', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it('returns false for invalid PID', () => {
    expect(isProcessAlive(999999)).toBe(false);
  });
});

describe('listInstances', () => {
  it('returns empty array when directory does not exist', async () => {
    const result = await listInstances('/tmp/nonexistent-fleet-dir-12345');
    expect(result).toEqual([]);
  });

  it('returns alive instances', async () => {
    await registerInstance(makeEntry(), fleetDir);
    const instances = await listInstances(fleetDir);
    expect(instances).toHaveLength(1);
    expect(instances[0].name).toBe('test-bot');
    expect(instances[0].alive).toBe(true);
  });

  it('cleans up stale files (dead PID)', async () => {
    await registerInstance(makeEntry({ pid: 999999 }), fleetDir);
    const instances = await listInstances(fleetDir);
    expect(instances).toHaveLength(0);
    // File should be cleaned up
    expect(await readdir(fleetDir)).toHaveLength(0);
  });

  it('skips malformed JSON files', async () => {
    const { writeFile: wf } = await import('node:fs/promises');
    await wf(join(fleetDir, 'bad.json'), 'not json!!!');
    await registerInstance(makeEntry(), fleetDir);
    const instances = await listInstances(fleetDir);
    expect(instances).toHaveLength(1);
  });

  it('returns multiple instances', async () => {
    await registerInstance(makeEntry({ name: 'bot-a', url: 'http://127.0.0.1:3000' }), fleetDir);
    await registerInstance(makeEntry({ name: 'bot-b', url: 'http://127.0.0.1:3001' }), fleetDir);
    const instances = await listInstances(fleetDir);
    expect(instances).toHaveLength(2);
  });
});

// ── Dashboard rendering ──────────────────────────────────────────────────────

describe('renderFleetDashboard', () => {
  it('returns valid HTML', () => {
    const html = renderFleetDashboard([], '1.0.0');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('GolemBot Fleet');
  });

  it('shows empty state when no instances', () => {
    const html = renderFleetDashboard([], '1.0.0');
    expect(html).toContain('No running bots found');
    expect(html).toContain('golembot gateway');
  });

  it('shows bot cards with engine badge', () => {
    const inst: FleetInstance = {
      ...makeEntry(),
      alive: true,
      metrics: { totalMessages: 42, totalCostUsd: 1.23, avgDurationMs: 2000, uptime: 60000 },
    };
    const html = renderFleetDashboard([inst], '1.0.0');
    expect(html).toContain('test-bot');
    expect(html).toContain('Claude-code');
    expect(html).toContain('claude-opus-4-6');
    expect(html).toContain('42');
    expect(html).toContain('$1.2300');
  });

  it('shows auth badge for auth-enabled instances', () => {
    const inst: FleetInstance = {
      ...makeEntry({ authEnabled: true }),
      alive: true,
    };
    const html = renderFleetDashboard([inst], '1.0.0');
    expect(html).toContain('Auth Required');
  });

  it('escapes XSS in bot name', () => {
    const inst: FleetInstance = {
      ...makeEntry({ name: '<script>alert(1)</script>' }),
      alive: true,
    };
    const html = renderFleetDashboard([inst], '1.0.0');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('shows channel names', () => {
    const inst: FleetInstance = {
      ...makeEntry({ channels: [{ type: 'telegram', status: 'connected' }, { type: 'slack', status: 'connected' }] }),
      alive: true,
    };
    const html = renderFleetDashboard([inst], '1.0.0');
    expect(html).toContain('Telegram');
    expect(html).toContain('Slack');
  });

  it('shows Unreachable for instances without metrics', () => {
    const inst: FleetInstance = {
      ...makeEntry(),
      alive: true,
      // no metrics
    };
    const html = renderFleetDashboard([inst], '1.0.0');
    expect(html).toContain('Unreachable');
  });

  it('shows correct count in header', () => {
    const instances: FleetInstance[] = [
      { ...makeEntry({ name: 'a', url: 'http://127.0.0.1:3000' }), alive: true },
      { ...makeEntry({ name: 'b', url: 'http://127.0.0.1:3001' }), alive: true },
    ];
    const html = renderFleetDashboard(instances, '1.0.0');
    expect(html).toContain('2 bots');
  });

  it('renders stopped bot cards with Start button', () => {
    const stopped = [{ ...makeEntry(), stopped: true as const }];
    const html = renderFleetDashboard([], '1.0.0', stopped);
    expect(html).toContain('Stopped');
    expect(html).toContain('btn-start');
    expect(html).toContain('Start');
    // Header says "No running bots found" because 0 running, but cards still render
    expect(html).toContain('stopped-card');
  });

  it('renders both running and stopped cards', () => {
    const running: FleetInstance[] = [{ ...makeEntry({ name: 'live' }), alive: true }];
    const stopped = [{ ...makeEntry({ name: 'dead' }), stopped: true as const }];
    const html = renderFleetDashboard(running, '1.0.0', stopped);
    expect(html).toContain('live');
    expect(html).toContain('dead');
    expect(html).toContain('btn-stop');
    expect(html).toContain('btn-start');
  });
});

// ── Stop / Start ────────────────────────────────────────────────────────────

describe('stopInstance', () => {
  it('throws for dead PID', async () => {
    const inst: FleetInstance = { ...makeEntry({ pid: 999999 }), alive: false };
    await expect(stopInstance(inst, fleetDir)).rejects.toThrow('is not running');
  });
});

describe('listStoppedInstances', () => {
  it('returns empty array when no stopped bots', async () => {
    await registerInstance(makeEntry(), fleetDir);
    const stopped = await listStoppedInstances(fleetDir);
    expect(stopped).toEqual([]);
  });

  it('returns stopped entries', async () => {
    const { writeFile: wf } = await import('node:fs/promises');
    const entry = { ...makeEntry({ pid: 999999 }), stopped: true };
    await wf(join(fleetDir, 'test-bot-3000.json'), JSON.stringify(entry));
    const stopped = await listStoppedInstances(fleetDir);
    expect(stopped).toHaveLength(1);
    expect(stopped[0].name).toBe('test-bot');
    expect(stopped[0].stopped).toBe(true);
  });

  it('excludes stopped entries with alive PID (bot restarted externally)', async () => {
    const { writeFile: wf } = await import('node:fs/promises');
    // Use current PID (alive) — should not appear in stopped list
    const entry = { ...makeEntry({ pid: process.pid }), stopped: true };
    await wf(join(fleetDir, 'test-bot-3000.json'), JSON.stringify(entry));
    const stopped = await listStoppedInstances(fleetDir);
    expect(stopped).toHaveLength(0);
  });
});

describe('findInstance', () => {
  it('finds instance by name', async () => {
    await registerInstance(makeEntry(), fleetDir);
    const found = await findInstance('test-bot', fleetDir);
    expect(found).toBeDefined();
    expect(found!.name).toBe('test-bot');
  });

  it('finds instance by port', async () => {
    await registerInstance(makeEntry(), fleetDir);
    const found = await findInstance('3000', fleetDir);
    expect(found).toBeDefined();
  });

  it('returns undefined for unknown name', async () => {
    const found = await findInstance('nonexistent', fleetDir);
    expect(found).toBeUndefined();
  });
});

describe('findStoppedInstance', () => {
  it('finds stopped instance by name', async () => {
    const { writeFile: wf } = await import('node:fs/promises');
    const entry = { ...makeEntry({ pid: 999999 }), stopped: true };
    await wf(join(fleetDir, 'test-bot-3000.json'), JSON.stringify(entry));
    const found = await findStoppedInstance('test-bot', fleetDir);
    expect(found).toBeDefined();
    expect(found!.stopped).toBe(true);
  });
});
