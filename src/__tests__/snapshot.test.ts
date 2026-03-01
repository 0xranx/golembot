import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile, lstat, readlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateAgentsMd, initWorkspace, writeConfig, loadConfig, type GolemConfig } from '../workspace.js';
import { injectClaudeSkills } from '../engine.js';

describe('generated file consistency', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'golem-snap-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // ── AGENTS.md structure ───────────────────────

  describe('AGENTS.md', () => {
    it('has consistent structure with skills', async () => {
      const skills = [
        { name: 'general', path: '/tmp/g', description: 'General assistant' },
        { name: 'code-review', path: '/tmp/cr', description: 'Code review skill' },
      ];

      await generateAgentsMd(dir, skills);
      const content = await readFile(join(dir, 'AGENTS.md'), 'utf-8');

      expect(content).toMatch(/^# Assistant Context/m);
      expect(content).toMatch(/^## Installed Skills/m);
      expect(content).toContain('- general: General assistant');
      expect(content).toContain('- code-review: Code review skill');
      expect(content).toMatch(/^## Directory Structure/m);
      expect(content).toMatch(/^## Conventions/m);
      expect(content).toContain('notes.md');
    });

    it('has consistent structure with empty skills', async () => {
      await generateAgentsMd(dir, []);
      const content = await readFile(join(dir, 'AGENTS.md'), 'utf-8');

      expect(content).toMatch(/^# Assistant Context/m);
      expect(content).toContain('no skills installed');
      expect(content).toMatch(/^## Conventions/m);
    });

    it('regeneration produces identical output', async () => {
      const skills = [{ name: 'test', path: '/tmp', description: 'Test skill' }];

      await generateAgentsMd(dir, skills);
      const first = await readFile(join(dir, 'AGENTS.md'), 'utf-8');

      await generateAgentsMd(dir, skills);
      const second = await readFile(join(dir, 'AGENTS.md'), 'utf-8');

      expect(first).toBe(second);
    });
  });

  // ── golem.yaml round-trip ─────────────────────

  describe('golem.yaml', () => {
    it('round-trips minimal config', async () => {
      const config: GolemConfig = { name: 'bot', engine: 'cursor' };
      await writeConfig(dir, config);
      const loaded = await loadConfig(dir);
      expect(loaded.name).toBe('bot');
      expect(loaded.engine).toBe('cursor');
      expect(loaded.model).toBeUndefined();
      expect(loaded.channels).toBeUndefined();
    });

    it('round-trips full config with channels and gateway', async () => {
      const config: GolemConfig = {
        name: 'full-bot',
        engine: 'claude-code',
        model: 'claude-sonnet-4-20250514',
        channels: {
          feishu: { appId: 'fid', appSecret: 'fsecret' },
          dingtalk: { clientId: 'did', clientSecret: 'dsecret' },
        },
        gateway: { port: 8080, host: '0.0.0.0', token: 'secret123' },
      };

      await writeConfig(dir, config);
      const loaded = await loadConfig(dir);

      expect(loaded.name).toBe('full-bot');
      expect(loaded.engine).toBe('claude-code');
      expect(loaded.model).toBe('claude-sonnet-4-20250514');
      expect(loaded.channels?.feishu?.appId).toBe('fid');
      expect(loaded.channels?.dingtalk?.clientId).toBe('did');
      expect(loaded.gateway?.port).toBe(8080);
      expect(loaded.gateway?.token).toBe('secret123');
    });

    it('preserves YAML readability', async () => {
      const config: GolemConfig = { name: 'bot', engine: 'cursor' };
      await writeConfig(dir, config);
      const raw = await readFile(join(dir, 'golem.yaml'), 'utf-8');

      expect(raw).toContain('name: bot');
      expect(raw).toContain('engine: cursor');
      expect(raw).not.toContain('{');
    });
  });

  // ── CLAUDE.md generation ──────────────────────

  describe('CLAUDE.md', () => {
    it('creates symlink to AGENTS.md', async () => {
      const workspace = dir;
      await mkdir(join(workspace, '.claude', 'skills'), { recursive: true });
      await injectClaudeSkills(workspace, [], [
        { name: 'general', description: 'General assistant' },
        { name: 'faq', description: 'FAQ support' },
      ]);

      const claudeMdPath = join(workspace, 'CLAUDE.md');
      const s = await lstat(claudeMdPath);
      expect(s.isSymbolicLink()).toBe(true);
      const target = await readlink(claudeMdPath);
      expect(target).toBe('AGENTS.md');
    });

    it('symlink works with empty skill list', async () => {
      const workspace = dir;
      await mkdir(join(workspace, '.claude', 'skills'), { recursive: true });
      await injectClaudeSkills(workspace, [], []);

      const s = await lstat(join(workspace, 'CLAUDE.md'));
      expect(s.isSymbolicLink()).toBe(true);
    });
  });

  // ── initWorkspace output consistency ──────────

  describe('initWorkspace', () => {
    it('produces a complete directory structure', async () => {
      const builtinDir = join(__dirname, '..', '..', 'skills');
      await initWorkspace(dir, { name: 'snap-bot', engine: 'cursor' }, builtinDir);

      const configRaw = await readFile(join(dir, 'golem.yaml'), 'utf-8');
      expect(configRaw).toContain('name: snap-bot');
      expect(configRaw).toContain('engine: cursor');

      const generalSkill = await readFile(join(dir, 'skills', 'general', 'SKILL.md'), 'utf-8');
      expect(generalSkill).toContain('General');

      const imAdapterSkill = await readFile(join(dir, 'skills', 'im-adapter', 'SKILL.md'), 'utf-8');
      expect(imAdapterSkill.length).toBeGreaterThan(0);

      const agentsMd = await readFile(join(dir, 'AGENTS.md'), 'utf-8');
      expect(agentsMd).toContain('general');
      expect(agentsMd).toContain('im-adapter');

      const gitignore = await readFile(join(dir, '.gitignore'), 'utf-8');
      expect(gitignore).toContain('.golem/');
    });

    it('produces opencode-specific .gitignore entry', async () => {
      await initWorkspace(dir, { name: 'oc-bot', engine: 'opencode' }, '/tmp/nonexistent');

      const gitignore = await readFile(join(dir, '.gitignore'), 'utf-8');
      expect(gitignore).toContain('.opencode/');
    });
  });
});
