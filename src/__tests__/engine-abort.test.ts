import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn(() => true);
}

async function makeWorkspace(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  await writeFile(join(dir, 'AGENTS.md'), '# test\n');
  return dir;
}

async function collectAbortMessage<
  T extends { invoke(prompt: string, opts: any): AsyncIterable<{ type: string; message?: string }> },
>(engine: T, workspace: string): Promise<string | undefined> {
  const controller = new AbortController();
  const events: Array<{ type: string; message?: string }> = [];
  const run = (async () => {
    for await (const evt of engine.invoke('hello', { workspace, skillPaths: [], signal: controller.signal })) {
      events.push(evt);
    }
  })();
  await new Promise((resolve) => setTimeout(resolve, 50));
  controller.abort('user');
  await run;
  return events.find((evt) => evt.type === 'error')?.message;
}

describe('engine abort handling', () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('Codex emits stopped-by-user on user abort', async () => {
    vi.resetModules();
    const workspace = await makeWorkspace('golem-engine-codex-');
    try {
      vi.doMock('node:child_process', () => ({ spawn: vi.fn(() => new FakeChild()) }));
      vi.doMock('../engines/shared.js', async (importOriginal) => {
        const original = await importOriginal<typeof import('../engines/shared.js')>();
        return { ...original, isOnPath: () => true, spawnCommand: vi.fn(() => new FakeChild()) };
      });
      const { CodexEngine } = await import('../engines/codex.js');
      const message = await collectAbortMessage(new CodexEngine(), workspace);
      expect(message).toContain('stopped by user');
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it('Claude Code emits stopped-by-user on user abort', async () => {
    vi.resetModules();
    const workspace = await makeWorkspace('golem-engine-claude-');
    try {
      vi.doMock('node:child_process', () => ({ spawn: vi.fn(() => new FakeChild()) }));
      vi.doMock('node:fs', async (importOriginal) => {
        const original = await importOriginal<typeof import('node:fs')>();
        return { ...original, existsSync: () => false };
      });
      vi.doMock('../engines/shared.js', async (importOriginal) => {
        const original = await importOriginal<typeof import('../engines/shared.js')>();
        return {
          ...original,
          resolveCliBinary: () => 'claude',
          spawnCommand: vi.fn(() => new FakeChild()),
        };
      });
      const { ClaudeCodeEngine } = await import('../engines/claude-code.js');
      const message = await collectAbortMessage(new ClaudeCodeEngine(), workspace);
      expect(message).toContain('stopped by user');
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it('OpenCode emits stopped-by-user on user abort', async () => {
    vi.resetModules();
    const workspace = await makeWorkspace('golem-engine-opencode-');
    try {
      vi.doMock('node:child_process', () => ({ spawn: vi.fn(() => new FakeChild()) }));
      vi.doMock('../engines/shared.js', async (importOriginal) => {
        const original = await importOriginal<typeof import('../engines/shared.js')>();
        return { ...original, isOnPath: () => true, spawnCommand: vi.fn(() => new FakeChild()) };
      });
      const { OpenCodeEngine } = await import('../engines/opencode.js');
      const message = await collectAbortMessage(new OpenCodeEngine(), workspace);
      expect(message).toContain('stopped by user');
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it('Cursor emits stopped-by-user on user abort', async () => {
    vi.resetModules();
    const workspace = await makeWorkspace('golem-engine-cursor-');
    try {
      vi.doMock('node:child_process', () => ({ spawn: vi.fn(() => new FakeChild()) }));
      vi.doMock('node:fs', async (importOriginal) => {
        const original = await importOriginal<typeof import('node:fs')>();
        return { ...original, existsSync: () => false };
      });
      vi.doMock('../engines/shared.js', async (importOriginal) => {
        const original = await importOriginal<typeof import('../engines/shared.js')>();
        return {
          ...original,
          resolveCliBinary: () => 'agent',
          spawnCommand: vi.fn(() => new FakeChild()),
        };
      });
      const { CursorEngine } = await import('../engines/cursor.js');
      const message = await collectAbortMessage(new CursorEngine(), workspace);
      expect(message).toContain('stopped by user');
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
