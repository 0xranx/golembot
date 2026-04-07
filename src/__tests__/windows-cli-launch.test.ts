import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { StreamEvent } from '../engine.js';
import { createAssistant } from '../index.js';

const itWindows = process.platform === 'win32' ? it : it.skip;

describe('Windows CLI launch smoke', () => {
  const tempDirs: string[] = [];
  let originalPath: string | undefined;

  afterEach(async () => {
    process.env.PATH = originalPath;
    originalPath = undefined;
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  itWindows('launches a claude.cmd shim from PATH without ENOENT', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'golem-win-workspace-'));
    const fakeBin = await mkdtemp(join(tmpdir(), 'golem-win-bin-'));
    tempDirs.push(workspace, fakeBin);

    await mkdir(join(workspace, 'skills', 'general'), { recursive: true });
    await writeFile(join(workspace, 'golem.yaml'), 'name: windows-smoke\nengine: claude-code\n', 'utf-8');
    await writeFile(
      join(workspace, 'skills', 'general', 'SKILL.md'),
      '---\nname: general\ndescription: General assistant\n---\n# General\n',
      'utf-8',
    );

    await writeFile(
      join(fakeBin, 'claude.cmd'),
      [
        '@echo off',
        'echo {"type":"assistant","message":{"content":[{"type":"text","text":"shim ok"}]}}',
        'echo {"type":"result","is_error":false,"session_id":"win-shim"}',
        '',
      ].join('\r\n'),
      'utf-8',
    );

    originalPath = process.env.PATH;
    process.env.PATH = [fakeBin, originalPath].filter(Boolean).join(delimiter);

    const assistant = createAssistant({ dir: workspace, timeoutMs: 5_000 });
    const events: StreamEvent[] = [];
    for await (const event of assistant.chat('hello from windows')) {
      events.push(event);
    }

    expect(events).toContainEqual({ type: 'text', content: 'shim ok' });
    expect(events.some((event) => event.type === 'done' && event.sessionId === 'win-shim')).toBe(true);
    expect(events.some((event) => event.type === 'error')).toBe(false);
  });
});
