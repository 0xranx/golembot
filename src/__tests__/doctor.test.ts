import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// We test the doctor logic by importing and running it, capturing exit code
// Since runDoctor calls process.exit, we mock it

describe('doctor', () => {
  let dir: string;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'golem-doctor-'));
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    exitSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('exits 1 when golem.yaml is missing', async () => {
    const { runDoctor } = await import('../doctor.js');
    await runDoctor(dir);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('reports Node.js version check', async () => {
    const { runDoctor } = await import('../doctor.js');
    await runDoctor(dir);
    // Node.js version should always pass in test environment
    const output = logSpy.mock.calls.map((c: unknown[]) => c.join(' ')).join('\n');
    expect(output).toContain('Node.js >= 18');
  });

  it('reports skills status when golem.yaml exists', async () => {
    await writeFile(join(dir, 'golem.yaml'), 'name: doc-test\nengine: claude-code\n');
    await mkdir(join(dir, 'skills', 'general'), { recursive: true });
    await writeFile(
      join(dir, 'skills', 'general', 'SKILL.md'),
      '---\nname: general\ndescription: General assistant\n---\n',
    );

    const { runDoctor } = await import('../doctor.js');
    await runDoctor(dir);

    const output = logSpy.mock.calls.map((c: unknown[]) => c.join(' ')).join('\n');
    expect(output).toContain('golem.yaml');
    expect(output).toContain('claude-code');
    expect(output).toContain('general');
  });

  it('reports no skills when skills dir is empty', async () => {
    await writeFile(join(dir, 'golem.yaml'), 'name: no-skill\nengine: cursor\n');

    const { runDoctor } = await import('../doctor.js');
    await runDoctor(dir);

    const output = logSpy.mock.calls.map((c: unknown[]) => c.join(' ')).join('\n');
    expect(output).toContain('Skills');
  });
});
