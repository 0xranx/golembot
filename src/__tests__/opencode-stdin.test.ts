import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StreamEvent } from '../engine.js';

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
