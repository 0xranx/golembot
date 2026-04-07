import { afterEach, describe, expect, it, vi } from 'vitest';

describe('engine shared spawn helpers', () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('resolveOnPath returns the first resolved executable', async () => {
    vi.doMock('node:child_process', async (importOriginal) => {
      const original = await importOriginal<typeof import('node:child_process')>();
      return {
        ...original,
        execFileSync: vi.fn(() => '/usr/local/bin/claude\n/usr/bin/claude\n'),
      };
    });

    const { isOnPath, resolveOnPath } = await import('../engines/shared.js');
    expect(resolveOnPath('claude')).toBe('/usr/local/bin/claude');
    expect(isOnPath('claude')).toBe(true);
  });

  it('prependPathEntries uses the provided path delimiter', async () => {
    const { prependPathEntries } = await import('../engines/shared.js');
    expect(prependPathEntries('C:\\Windows\\System32', ['C:\\Users\\me\\.local\\bin'], ';')).toBe(
      'C:\\Users\\me\\.local\\bin;C:\\Windows\\System32',
    );
  });

  it('spawnCommand uses the resolved executable path', async () => {
    const crossSpawnMock = vi.fn();
    vi.doMock('cross-spawn', () => ({
      default: crossSpawnMock,
    }));
    vi.doMock('node:child_process', async (importOriginal) => {
      const original = await importOriginal<typeof import('node:child_process')>();
      return {
        ...original,
        execFileSync: vi.fn(() => 'C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd\r\n'),
      };
    });

    const { spawnCommand } = await import('../engines/shared.js');
    const options = { stdio: 'ignore' as const };
    spawnCommand('claude', ['--version'], options);

    expect(crossSpawnMock).toHaveBeenCalledWith(
      'C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd',
      ['--version'],
      options,
    );
  });
});
