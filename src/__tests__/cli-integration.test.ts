import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

const CLI_PATH = resolve(__dirname, '..', '..', 'dist', 'cli.js');

async function runCli(args: string[], cwd?: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await exec('node', [CLI_PATH, ...args], {
      cwd: cwd || process.cwd(),
      timeout: 10000,
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (e: any) {
    return {
      stdout: e.stdout || '',
      stderr: e.stderr || '',
      exitCode: e.code ?? 1,
    };
  }
}

describe('CLI integration', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'golem-cli-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // ── golembot --version ────────────────────────

  it('shows version', async () => {
    const { stdout, exitCode } = await runCli(['--version']);
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toMatch(/\d+\.\d+\.\d+/);
  });

  // ── golembot --help ───────────────────────────

  it('shows help', async () => {
    const { stdout, exitCode } = await runCli(['--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('init');
    expect(stdout).toContain('run');
    expect(stdout).toContain('serve');
    expect(stdout).toContain('gateway');
    expect(stdout).toContain('onboard');
    expect(stdout).toContain('status');
    expect(stdout).toContain('skill');
  });

  // ── golembot init (non-interactive) ───────────

  it('init creates assistant directory with -n and -e flags', async () => {
    const { stdout, exitCode } = await runCli(['init', '-e', 'cursor', '-n', 'test-bot'], dir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('GolemBot assistant created');

    const configRaw = await readFile(join(dir, 'golem.yaml'), 'utf-8');
    expect(configRaw).toContain('name: test-bot');
    expect(configRaw).toContain('engine: cursor');

    const skillEntries = await readdir(join(dir, 'skills'));
    expect(skillEntries).toContain('general');
    expect(skillEntries).toContain('im-adapter');

    const agentsMd = await readFile(join(dir, 'AGENTS.md'), 'utf-8');
    expect(agentsMd).toContain('general');
  });

  it('init rejects double initialization', async () => {
    await runCli(['init', '-e', 'cursor', '-n', 'first'], dir);
    const { stderr, exitCode } = await runCli(['init', '-e', 'cursor', '-n', 'second'], dir);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain('already exists');
  });

  it('init supports claude-code engine', async () => {
    const { exitCode } = await runCli(['init', '-e', 'claude-code', '-n', 'claude-bot'], dir);
    expect(exitCode).toBe(0);
    const config = await readFile(join(dir, 'golem.yaml'), 'utf-8');
    expect(config).toContain('engine: claude-code');
  });

  it('init supports opencode engine', async () => {
    const { exitCode } = await runCli(['init', '-e', 'opencode', '-n', 'oc-bot'], dir);
    expect(exitCode).toBe(0);
    const config = await readFile(join(dir, 'golem.yaml'), 'utf-8');
    expect(config).toContain('engine: opencode');
  });

  // ── golembot status ───────────────────────────

  it('status shows assistant info', async () => {
    await runCli(['init', '-e', 'cursor', '-n', 'status-bot'], dir);
    const { stdout, exitCode } = await runCli(['status', '-d', dir]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('status-bot');
    expect(stdout).toContain('cursor');
    expect(stdout).toContain('general');
  });

  it('status fails without golem.yaml', async () => {
    const { exitCode, stderr } = await runCli(['status', '-d', dir]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain('Failed to read assistant status');
  });

  // ── golembot skill list ───────────────────────

  it('skill list shows installed skills', async () => {
    await runCli(['init', '-e', 'cursor', '-n', 'skill-bot'], dir);
    const { stdout, exitCode } = await runCli(['skill', 'list', '-d', dir]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('general');
    expect(stdout).toContain('im-adapter');
  });

  it('skill list shows empty message when no skills', async () => {
    await mkdir(dir, { recursive: true });
    const { stdout, exitCode } = await runCli(['skill', 'list', '-d', dir]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('no skills installed');
  });

  // ── golembot skill add ────────────────────────

  it('skill add copies skill and updates AGENTS.md', async () => {
    await runCli(['init', '-e', 'cursor', '-n', 'add-bot'], dir);

    const srcSkill = join(dir, '_external', 'my-skill');
    await mkdir(srcSkill, { recursive: true });
    await writeFile(join(srcSkill, 'SKILL.md'), '---\nname: my-skill\ndescription: Custom skill\n---\n# Custom\n');

    const { stdout, exitCode } = await runCli(['skill', 'add', srcSkill, '-d', dir]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Skill added: my-skill');

    const copiedSkill = await readFile(join(dir, 'skills', 'my-skill', 'SKILL.md'), 'utf-8');
    expect(copiedSkill).toContain('Custom skill');

    const agentsMd = await readFile(join(dir, 'AGENTS.md'), 'utf-8');
    expect(agentsMd).toContain('my-skill');
  });

  it('skill add rejects when skill already exists', async () => {
    await runCli(['init', '-e', 'cursor', '-n', 'dup-bot'], dir);

    const srcSkill = join(dir, '_external', 'general');
    await mkdir(srcSkill, { recursive: true });
    await writeFile(join(srcSkill, 'SKILL.md'), '# Duplicate\n');

    const { stderr, exitCode } = await runCli(['skill', 'add', srcSkill, '-d', dir]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain('already exists');
  });

  it('skill add rejects source without SKILL.md', async () => {
    await runCli(['init', '-e', 'cursor', '-n', 'no-skill-bot'], dir);

    const srcDir = join(dir, '_external', 'bad-source');
    await mkdir(srcDir, { recursive: true });
    await writeFile(join(srcDir, 'random.txt'), 'no SKILL.md');

    const { stderr, exitCode } = await runCli(['skill', 'add', srcDir, '-d', dir]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain('does not exist or does not contain SKILL.md');
  });

  // ── golembot skill remove ────────────────────

  it('skill remove deletes skill and updates AGENTS.md', async () => {
    await runCli(['init', '-e', 'cursor', '-n', 'rm-bot'], dir);

    // Add a custom skill first
    const srcSkill = join(dir, '_external', 'removable');
    await mkdir(srcSkill, { recursive: true });
    await writeFile(join(srcSkill, 'SKILL.md'), '---\nname: removable\ndescription: Will be removed\n---\n');
    await runCli(['skill', 'add', srcSkill, '-d', dir]);

    // Verify it's there
    let listResult = await runCli(['skill', 'list', '-d', dir]);
    expect(listResult.stdout).toContain('removable');

    // Remove it
    const { stdout, exitCode } = await runCli(['skill', 'remove', 'removable', '-d', dir]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Skill removed: removable');

    // Verify it's gone
    listResult = await runCli(['skill', 'list', '-d', dir]);
    expect(listResult.stdout).not.toContain('removable');
  });

  it('skill remove fails for nonexistent skill', async () => {
    await runCli(['init', '-e', 'cursor', '-n', 'rm-fail-bot'], dir);

    const { stderr, exitCode } = await runCli(['skill', 'remove', 'nonexistent', '-d', dir]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain('not found');
  });
});
