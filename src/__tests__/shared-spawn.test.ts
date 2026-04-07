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

  it('resolveCliBinary prefers PATH on Windows when both PATH and local bin exist', async () => {
    vi.doMock('node:child_process', async (importOriginal) => {
      const original = await importOriginal<typeof import('node:child_process')>();
      return {
        ...original,
        execFileSync: vi.fn(() => 'C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd\r\n'),
      };
    });
    vi.doMock('node:fs', async (importOriginal) => {
      const original = await importOriginal<typeof import('node:fs')>();
      return {
        ...original,
        existsSync: vi.fn(() => true),
      };
    });

    const { resolveCliBinary } = await import('../engines/shared.js');
    expect(resolveCliBinary('claude', 'C:\\Users\\me\\.local\\bin\\claude', 'win32')).toBe(
      'C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd',
    );
  });

  it('resolveCliBinary prefers local bin on Unix when it exists', async () => {
    vi.doMock('node:child_process', async (importOriginal) => {
      const original = await importOriginal<typeof import('node:child_process')>();
      return {
        ...original,
        execFileSync: vi.fn(() => '/usr/local/bin/claude\n'),
      };
    });
    vi.doMock('node:fs', async (importOriginal) => {
      const original = await importOriginal<typeof import('node:fs')>();
      return {
        ...original,
        existsSync: vi.fn((path: string) => path === '/Users/me/.local/bin/claude'),
      };
    });

    const { resolveCliBinary } = await import('../engines/shared.js');
    expect(resolveCliBinary('claude', '/Users/me/.local/bin/claude', 'darwin')).toBe('/Users/me/.local/bin/claude');
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

  it('spawnCommand prefers a sibling PowerShell shim on Windows when available', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const crossSpawnMock = vi.fn();
    try {
      vi.doMock('cross-spawn', () => ({
        default: crossSpawnMock,
      }));
      vi.doMock('node:child_process', async (importOriginal) => {
        const original = await importOriginal<typeof import('node:child_process')>();
        return {
          ...original,
          execFileSync: vi.fn((cmd: string, args: string[]) => {
            if (cmd === 'where' && args[0] === 'claude') return 'C:\\Program Files\\nodejs\\claude\r\n';
            if (cmd === 'where' && args[0] === 'powershell.exe')
              return 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe\r\n';
            return '';
          }),
        };
      });
      vi.doMock('node:fs', async (importOriginal) => {
        const original = await importOriginal<typeof import('node:fs')>();
        return {
          ...original,
          existsSync: vi.fn((path: string) => path === 'C:\\Program Files\\nodejs\\claude.ps1'),
        };
      });

      const { spawnCommand } = await import('../engines/shared.js');
      const options = { stdio: 'ignore' as const };
      spawnCommand('claude', ['--version'], options);

      expect(crossSpawnMock).toHaveBeenCalledWith(
        'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
        [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          'C:\\Program Files\\nodejs\\claude.ps1',
          '--version',
        ],
        options,
      );
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });
});
