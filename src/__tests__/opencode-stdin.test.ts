import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StreamEvent } from '../engine.js';

// Expose findOpenCodeBin for testing via a hidden export in the module
// (we will verify behaviour indirectly by mocking resolveOnPath)

/**
 * Issue #43 — the prompt must be piped to opencode via stdin, never passed as
 * an argv element: multi-line prompts containing [System:] / [CONTINUE]
 * markers corrupt PowerShell -File argument parsing on Windows, silently
 * dropping --format json and hanging the gateway.
 */

class StdinRecordingChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdinChunks: string[] = [];
  stdinEnded = false;
  stdin = {
    on: vi.fn(),
    write: vi.fn((chunk: string) => {
      this.stdinChunks.push(chunk);
      return true;
    }),
    end: vi.fn(() => {
      this.stdinEnded = true;
    }),
  };
  kill = vi.fn(() => true);
}

const GATEWAY_PROMPT = [
  '[System: This is a private 1-on-1 conversation with 用户178387.]',
  '[System: When your reply ends, execution stops completely. If your work is not finished, end with [CONTINUE] on its own line.]',
  '你好',
].join('\n');

describe('OpenCodeEngine prompt delivery (issue #43)', () => {
  let workspace: string;
  let child: StdinRecordingChild;
  let capturedArgs: string[];

  beforeEach(async () => {
    vi.resetModules();
    workspace = await mkdtemp(join(tmpdir(), 'golem-oc-stdin-'));
    child = new StdinRecordingChild();
    capturedArgs = [];
    vi.doMock('../engines/shared.js', async (importOriginal) => {
      const original = await importOriginal<typeof import('../engines/shared.js')>();
      return {
        ...original,
        isOnPath: () => true,
        spawnCommand: vi.fn((_bin: string, args: string[]) => {
          capturedArgs = args;
          const ndjson = [
            JSON.stringify({ type: 'text', sessionID: 's1', part: { type: 'text', text: 'ok' } }),
            JSON.stringify({ type: 'step_finish', sessionID: 's1', part: { type: 'step-finish', cost: 0 } }),
          ].join('\n');
          setTimeout(() => {
            child.stdout.emit('data', Buffer.from(`${ndjson}\n`));
            child.emit('close', 0);
          }, 10);
          return child;
        }),
      };
    });
  });

  afterEach(async () => {
    vi.doUnmock('../engines/shared.js');
    await rm(workspace, { recursive: true, force: true });
  });

  async function invokeAndCollect(opts: Record<string, unknown> = {}): Promise<StreamEvent[]> {
    const { OpenCodeEngine } = await import('../engines/opencode.js');
    const events: StreamEvent[] = [];
    for await (const evt of new OpenCodeEngine().invoke(GATEWAY_PROMPT, {
      workspace,
      skillPaths: [],
      ...opts,
    })) {
      events.push(evt);
    }
    return events;
  }

  it('pipes the prompt via stdin and closes it', async () => {
    await invokeAndCollect();

    expect(child.stdinChunks.join('')).toBe(GATEWAY_PROMPT);
    expect(child.stdinEnded).toBe(true);
  });

  it('does not put the prompt (or any fragment of it) in argv', async () => {
    await invokeAndCollect();

    expect(capturedArgs).toEqual(['run', '--format', 'json']);
    for (const arg of capturedArgs) {
      expect(arg).not.toContain('[System:');
      expect(arg).not.toContain('你好');
    }
  });

  it('keeps session and model flags in argv', async () => {
    await invokeAndCollect({ sessionId: 'ses_123', model: 'openrouter/x' });

    expect(capturedArgs).toEqual(['run', '--format', 'json', '--session', 'ses_123', '--model', 'openrouter/x']);
  });

  it('still parses the NDJSON response normally', async () => {
    const events = await invokeAndCollect();

    expect(events.some((e) => e.type === 'text' && e.content === 'ok')).toBe(true);
    expect(events.some((e) => e.type === 'done')).toBe(true);
  });
});

describe('findOpenCodeBin Windows .exe direct path (issue #7)', () => {
  let ws: string;
  let capturedArgs: string[];

  beforeEach(async () => {
    vi.resetModules();
    ws = await mkdtemp(join(tmpdir(), 'golem-oc-exe-'));
    capturedArgs = [];
  });

  afterEach(async () => {
    vi.doUnmock('../engines/shared.js');
    vi.doUnmock('node:fs');
    vi.restoreAllMocks();
    await rm(ws, { recursive: true, force: true });
  });

  it('returns the direct .exe path when npm global layout is detected', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const child = new StdinRecordingChild();
    const capturedBin: string[] = [];
    try {
      vi.doMock('../engines/shared.js', async (importOriginal) => {
        const original = await importOriginal<typeof import('../engines/shared.js')>();
        return {
          ...original,
          resolveOnPath: vi.fn(() => 'C:\\Program Files\\nodejs\\opencode.ps1'),
          spawnCommand: vi.fn((bin: string, args: string[]) => {
            capturedBin.push(bin);
            capturedArgs = args;
            setTimeout(() => {
              child.stdout.emit('data', Buffer.from(`\n`));
              child.emit('close', 0);
            }, 10);
            return child;
          }),
        };
      });
      vi.doMock('node:fs', async (importOriginal) => {
        const original = await importOriginal<typeof import('node:fs')>();
        return {
          ...original,
          existsSync: vi.fn(
            (p: string) => p === 'C:\\Program Files\\nodejs\\node_modules\\opencode-ai\\bin\\opencode.exe',
          ),
        };
      });

      const { OpenCodeEngine } = await import('../engines/opencode.js');
      for await (const _evt of OpenCodeEngine.prototype.invoke('test', { workspace: ws, skillPaths: [] })) {
        break;
      }
      expect(capturedBin[0]).toBe('C:\\Program Files\\nodejs\\node_modules\\opencode-ai\\bin\\opencode.exe');
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });

  it('falls back to "opencode" when .exe is absent', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const child = new StdinRecordingChild();
    const capturedBin: string[] = [];
    try {
      vi.doMock('../engines/shared.js', async (importOriginal) => {
        const original = await importOriginal<typeof import('../engines/shared.js')>();
        return {
          ...original,
          resolveOnPath: vi.fn(() => 'C:\\Program Files\\nodejs\\opencode.cmd'),
          spawnCommand: vi.fn((bin: string, args: string[]) => {
            capturedBin.push(bin);
            capturedArgs = args;
            setTimeout(() => {
              child.stdout.emit('data', Buffer.from(`\n`));
              child.emit('close', 0);
            }, 10);
            return child;
          }),
        };
      });
      vi.doMock('node:fs', async (importOriginal) => {
        const original = await importOriginal<typeof import('node:fs')>();
        return {
          ...original,
          existsSync: vi.fn(() => false),
        };
      });

      const { OpenCodeEngine } = await import('../engines/opencode.js');
      for await (const _evt of OpenCodeEngine.prototype.invoke('test', { workspace: ws, skillPaths: [] })) {
        break;
      }
      expect(capturedBin[0]).toBe('opencode');
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });
});
