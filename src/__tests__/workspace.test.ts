import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ensureReady,
  generateAgentsMd,
  generateCursorCliJson,
  initWorkspace,
  loadConfig,
  refreshSkillInjection,
  scanSkills,
  writeConfig,
} from '../workspace.js';

describe('workspace', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'golem-test-ws-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // ── loadConfig ────────────────────────────────────

  describe('loadConfig', () => {
    it('reads a minimal golem.yaml', async () => {
      await writeFile(join(dir, 'golem.yaml'), 'name: bot\nengine: cursor\n');
      const cfg = await loadConfig(dir);
      expect(cfg).toEqual({ name: 'bot', engine: 'cursor', model: undefined });
    });

    it('reads golem.yaml with model field', async () => {
      await writeFile(join(dir, 'golem.yaml'), 'name: bot\nengine: cursor\nmodel: claude-sonnet\n');
      const cfg = await loadConfig(dir);
      expect(cfg).toEqual({ name: 'bot', engine: 'cursor', model: 'claude-sonnet' });
    });

    it('throws when golem.yaml is missing', async () => {
      await expect(loadConfig(dir)).rejects.toThrow();
    });

    it('throws when golem.yaml is missing required fields', async () => {
      await writeFile(join(dir, 'golem.yaml'), 'name: bot\n');
      await expect(loadConfig(dir)).rejects.toThrow('engine');
    });

    it('throws on empty YAML', async () => {
      await writeFile(join(dir, 'golem.yaml'), '');
      await expect(loadConfig(dir)).rejects.toThrow();
    });

    it('reads skipPermissions field', async () => {
      await writeFile(join(dir, 'golem.yaml'), 'name: bot\nengine: cursor\nskipPermissions: false\n');
      const cfg = await loadConfig(dir);
      expect(cfg.skipPermissions).toBe(false);
    });

    it('skipPermissions defaults to undefined when not set', async () => {
      await writeFile(join(dir, 'golem.yaml'), 'name: bot\nengine: cursor\n');
      const cfg = await loadConfig(dir);
      expect(cfg.skipPermissions).toBeUndefined();
    });

    it('reads codex mode field', async () => {
      await writeFile(join(dir, 'golem.yaml'), 'name: bot\nengine: codex\ncodex:\n  mode: safe\n');
      const cfg = await loadConfig(dir);
      expect(cfg.codex).toEqual({ mode: 'safe' });
    });

    it('reads autoContinue field', async () => {
      await writeFile(join(dir, 'golem.yaml'), 'name: bot\nengine: cursor\nautoContinue: 3\n');
      const cfg = await loadConfig(dir);
      expect(cfg.autoContinue).toBe(3);
    });

    it('reads autoContinue: 0 (disabled) as a valid value', async () => {
      await writeFile(join(dir, 'golem.yaml'), 'name: bot\nengine: cursor\nautoContinue: 0\n');
      const cfg = await loadConfig(dir);
      expect(cfg.autoContinue).toBe(0);
    });

    it('autoContinue is undefined when not set (gateway applies default)', async () => {
      await writeFile(join(dir, 'golem.yaml'), 'name: bot\nengine: cursor\n');
      const cfg = await loadConfig(dir);
      expect(cfg.autoContinue).toBeUndefined();
    });

    it('reads extended codex config fields', async () => {
      await writeFile(
        join(dir, 'golem.yaml'),
        'name: bot\nengine: codex\ncodex:\n  sandbox: read-only\n  approval: never\n  search: true\n  addDirs:\n    - ../shared\n',
      );
      const cfg = await loadConfig(dir);
      expect(cfg.codex).toEqual({
        sandbox: 'read-only',
        approval: 'never',
        search: true,
        addDirs: ['../shared'],
      });
    });
  });

  // ── writeConfig ───────────────────────────────────

  describe('writeConfig', () => {
    it('writes config that can be read back', async () => {
      await writeConfig(dir, { name: 'test', engine: 'cursor', model: 'gpt-4' });
      const cfg = await loadConfig(dir);
      expect(cfg).toEqual({ name: 'test', engine: 'cursor', model: 'gpt-4' });
    });

    it('omits model when undefined', async () => {
      await writeConfig(dir, { name: 'test', engine: 'cursor' });
      const raw = await readFile(join(dir, 'golem.yaml'), 'utf-8');
      expect(raw).not.toContain('model');
    });

    it('round-trips skipPermissions', async () => {
      await writeConfig(dir, { name: 'test', engine: 'cursor', skipPermissions: false });
      const cfg = await loadConfig(dir);
      expect(cfg.skipPermissions).toBe(false);
    });

    it('omits skipPermissions when undefined', async () => {
      await writeConfig(dir, { name: 'test', engine: 'cursor' });
      const raw = await readFile(join(dir, 'golem.yaml'), 'utf-8');
      expect(raw).not.toContain('skipPermissions');
    });

    it('round-trips autoContinue (including 0)', async () => {
      await writeConfig(dir, { name: 'test', engine: 'cursor', autoContinue: 0 });
      const cfg = await loadConfig(dir);
      expect(cfg.autoContinue).toBe(0);
    });

    it('omits autoContinue when undefined', async () => {
      await writeConfig(dir, { name: 'test', engine: 'cursor' });
      const raw = await readFile(join(dir, 'golem.yaml'), 'utf-8');
      expect(raw).not.toContain('autoContinue');
    });

    it('round-trips codex config', async () => {
      await writeConfig(dir, {
        name: 'test',
        engine: 'codex',
        codex: {
          mode: 'unrestricted',
          sandbox: 'workspace-write',
          approval: 'on-request',
          search: true,
          addDirs: ['../shared'],
        },
      });
      const cfg = await loadConfig(dir);
      expect(cfg.codex).toEqual({
        mode: 'unrestricted',
        sandbox: 'workspace-write',
        approval: 'on-request',
        search: true,
        addDirs: ['../shared'],
      });
    });
  });

  describe('writeConfig provider', () => {
    it('round-trips provider config', async () => {
      await writeConfig(dir, {
        name: 'test',
        engine: 'claude-code',
        provider: {
          baseUrl: 'https://api.minimax.io/v1',
          apiKey: 'sk-test',
          model: 'MiniMax-M3',
          models: { 'claude-code': 'MiniMax-M3' },
        },
      });
      const cfg = await loadConfig(dir);
      expect(cfg.provider).toEqual({
        baseUrl: 'https://api.minimax.io/v1',
        apiKey: 'sk-test',
        model: 'MiniMax-M3',
        models: { 'claude-code': 'MiniMax-M3' },
      });
    });

    it('omits provider when undefined', async () => {
      await writeConfig(dir, { name: 'test', engine: 'cursor' });
      const raw = await readFile(join(dir, 'golem.yaml'), 'utf-8');
      expect(raw).not.toContain('provider');
    });

    it('reads persona config', async () => {
      await writeFile(
        join(dir, 'golem.yaml'),
        'name: bot\nengine: cursor\npersona:\n  displayName: Alice\n  role: Support Agent\n  tone: friendly\n  boundaries:\n    - No pricing\n',
      );
      const cfg = await loadConfig(dir);
      expect(cfg.persona).toEqual({
        displayName: 'Alice',
        role: 'Support Agent',
        tone: 'friendly',
        boundaries: ['No pricing'],
      });
    });

    it('round-trips persona through writeConfig/loadConfig', async () => {
      const persona = { displayName: 'Bob', role: 'Engineer', tone: 'concise', boundaries: ['No deploys'] };
      await writeConfig(dir, { name: 'test', engine: 'cursor', persona });
      const cfg = await loadConfig(dir);
      expect(cfg.persona).toEqual(persona);
    });
  });

  // ── scanSkills ────────────────────────────────────

  describe('scanSkills', () => {
    it('returns empty array when skills/ does not exist', async () => {
      const skills = await scanSkills(dir);
      expect(skills).toEqual([]);
    });

    it('returns empty array when skills/ is empty', async () => {
      await mkdir(join(dir, 'skills'));
      const skills = await scanSkills(dir);
      expect(skills).toEqual([]);
    });

    it('discovers a skill with YAML front matter', async () => {
      const skillDir = join(dir, 'skills', 'ops-xhs');
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, 'SKILL.md'),
        '---\nname: ops-xhs\ndescription: Xiaohongshu ops assistant\n---\n\n# XHS\n',
      );

      const skills = await scanSkills(dir);
      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe('ops-xhs');
      expect(skills[0].description).toBe('Xiaohongshu ops assistant');
      expect(skills[0].path).toBe(skillDir);
    });

    it('falls back to directory name when no front matter', async () => {
      const skillDir = join(dir, 'skills', 'my-skill');
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, 'SKILL.md'), '# My Skill\nSome content.\n');

      const skills = await scanSkills(dir);
      expect(skills).toHaveLength(1);
      expect(skills[0].description).toBe('my-skill');
    });

    it('skips directories without SKILL.md', async () => {
      const withSkill = join(dir, 'skills', 'valid');
      const withoutSkill = join(dir, 'skills', 'nofile');
      await mkdir(withSkill, { recursive: true });
      await mkdir(withoutSkill, { recursive: true });
      await writeFile(join(withSkill, 'SKILL.md'), '---\nname: valid\n---\n');

      const skills = await scanSkills(dir);
      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe('valid');
    });

    it('discovers multiple skills', async () => {
      for (const name of ['alpha', 'beta', 'gamma']) {
        const skillDir = join(dir, 'skills', name);
        await mkdir(skillDir, { recursive: true });
        await writeFile(join(skillDir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name} skill\n---\n`);
      }

      const skills = await scanSkills(dir);
      expect(skills).toHaveLength(3);
      const names = skills.map((s) => s.name).sort();
      expect(names).toEqual(['alpha', 'beta', 'gamma']);
    });

    it('ignores files (not directories) in skills/', async () => {
      await mkdir(join(dir, 'skills'));
      await writeFile(join(dir, 'skills', 'README.md'), 'hello');
      const skills = await scanSkills(dir);
      expect(skills).toEqual([]);
    });

    it('parses type from SKILL.md front matter', async () => {
      const skillDir = join(dir, 'skills', 'my-task');
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, 'SKILL.md'),
        '---\nname: my-task\ndescription: Task manager\ntype: capability\n---\n',
      );

      const skills = await scanSkills(dir);
      expect(skills).toHaveLength(1);
      expect(skills[0].type).toBe('capability');
    });

    it('returns undefined type when not in front matter', async () => {
      const skillDir = join(dir, 'skills', 'plain');
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, 'SKILL.md'), '---\nname: plain\ndescription: No type\n---\n');

      const skills = await scanSkills(dir);
      expect(skills).toHaveLength(1);
      expect(skills[0].type).toBeUndefined();
    });
  });

  // ── generateAgentsMd ─────────────────────────────

  describe('generateAgentsMd', () => {
    it('generates AGENTS.md with skill list', async () => {
      await generateAgentsMd(dir, [
        { name: 'general', path: '/tmp/x', description: 'General assistant' },
        { name: 'ops-xhs', path: '/tmp/y', description: 'Xiaohongshu operations' },
      ]);

      const content = await readFile(join(dir, 'AGENTS.md'), 'utf-8');
      expect(content).toContain('- general: General assistant');
      expect(content).toContain('- ops-xhs: Xiaohongshu operations');
      expect(content).toContain('auto-generated by Golem');
    });

    it('handles empty skill list', async () => {
      await generateAgentsMd(dir, []);
      const content = await readFile(join(dir, 'AGENTS.md'), 'utf-8');
      expect(content).toContain('no skills installed');
    });

    it('groups skills by type when types are present', async () => {
      await generateAgentsMd(dir, [
        { name: 'general', path: '/tmp/a', description: 'General assistant', type: 'behavior' },
        { name: 'im-adapter', path: '/tmp/b', description: 'IM guidelines', type: 'behavior' },
        { name: 'task-mgr', path: '/tmp/c', description: 'Task manager', type: 'capability' },
      ]);

      const content = await readFile(join(dir, 'AGENTS.md'), 'utf-8');
      expect(content).toContain('### behavior');
      expect(content).toContain('### capability');
      expect(content).toContain('- general: General assistant');
      expect(content).toContain('- task-mgr: Task manager');
    });

    it('uses flat list when no skills have types', async () => {
      await generateAgentsMd(dir, [
        { name: 'alpha', path: '/tmp/a', description: 'Alpha skill' },
        { name: 'beta', path: '/tmp/b', description: 'Beta skill' },
      ]);

      const content = await readFile(join(dir, 'AGENTS.md'), 'utf-8');
      expect(content).not.toContain('###');
      expect(content).toContain('- alpha: Alpha skill');
    });

    it('renders persona section when persona config is provided', async () => {
      await generateAgentsMd(dir, [{ name: 'general', path: '/tmp/a', description: 'General' }], undefined, {
        displayName: 'Alice',
        role: 'Support Agent',
        tone: 'friendly',
        boundaries: ['No pricing info'],
      });

      const content = await readFile(join(dir, 'AGENTS.md'), 'utf-8');
      expect(content).toContain('## Persona');
      expect(content).toContain('- Display Name: Alice');
      expect(content).toContain('- Role: Support Agent');
      expect(content).toContain('- Tone: friendly');
      expect(content).toContain('- No pricing info');
    });

    it('omits persona section when no persona config', async () => {
      await generateAgentsMd(dir, [{ name: 'general', path: '/tmp/a', description: 'General' }]);

      const content = await readFile(join(dir, 'AGENTS.md'), 'utf-8');
      expect(content).not.toContain('## Persona');
    });

    it('always regenerates AGENTS.md when called again with different skills', async () => {
      // First call creates AGENTS.md with skillA
      await generateAgentsMd(dir, [{ name: 'skill-a', path: '/tmp/a', description: 'First skill' }]);

      // Second call with different skills must overwrite the existing file
      await generateAgentsMd(dir, [{ name: 'skill-b', path: '/tmp/b', description: 'Second skill' }]);

      const content = await readFile(join(dir, 'AGENTS.md'), 'utf-8');
      expect(content).toContain('- skill-b: Second skill');
      expect(content).not.toContain('- skill-a: First skill');
    });
  });

  // ── ensureReady ───────────────────────────────────

  describe('ensureReady', () => {
    it('full flow: reads config, scans skills, generates AGENTS.md', async () => {
      await writeFile(join(dir, 'golem.yaml'), 'name: assistant\nengine: cursor\n');
      const skillDir = join(dir, 'skills', 'demo');
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, 'SKILL.md'), '---\nname: demo\ndescription: demo skill\n---\n');

      const { config, skills } = await ensureReady(dir);
      expect(config.name).toBe('assistant');
      expect(config.engine).toBe('cursor');
      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe('demo');

      const agentsMd = await readFile(join(dir, 'AGENTS.md'), 'utf-8');
      expect(agentsMd).toContain('demo: demo skill');
    });
  });

  // ── initWorkspace ─────────────────────────────────

  describe('initWorkspace', () => {
    it('creates a fully initialized assistant directory', async () => {
      // Use project's built-in skills as source
      const builtinDir = join(__dirname, '..', '..', 'skills');
      await initWorkspace(dir, { name: 'my-bot', engine: 'cursor' }, builtinDir);

      // golem.yaml created
      const cfg = await loadConfig(dir);
      expect(cfg.name).toBe('my-bot');
      expect(cfg.engine).toBe('cursor');

      // skills/general/SKILL.md copied
      const skillMd = await readFile(join(dir, 'skills', 'general', 'SKILL.md'), 'utf-8');
      expect(skillMd).toContain('General');

      // .golem/ created
      const golemStat = await stat(join(dir, '.golem'));
      expect(golemStat.isDirectory()).toBe(true);

      // AGENTS.md generated
      const agentsMd = await readFile(join(dir, 'AGENTS.md'), 'utf-8');
      expect(agentsMd).toContain('general');

      // .gitignore created
      const gitignore = await readFile(join(dir, '.gitignore'), 'utf-8');
      expect(gitignore).toContain('.golem/');
    });

    it('throws when golem.yaml already exists (prevent double init)', async () => {
      await writeFile(join(dir, 'golem.yaml'), 'name: old\nengine: cursor\n');
      await expect(initWorkspace(dir, { name: 'new', engine: 'cursor' }, '/tmp')).rejects.toThrow('already exists');
    });

    it('falls back to default SKILL.md when builtin source missing', async () => {
      await initWorkspace(dir, { name: 'fallback-bot', engine: 'cursor' }, '/tmp/nonexistent-builtin-path');

      const skillMd = await readFile(join(dir, 'skills', 'general', 'SKILL.md'), 'utf-8');
      expect(skillMd).toContain('General');
    });

    it('does not overwrite existing .gitignore', async () => {
      await writeFile(join(dir, '.gitignore'), 'node_modules/\ncustom/\n');
      await initWorkspace(dir, { name: 'bot', engine: 'cursor' }, '/tmp/nonexistent');

      const gitignore = await readFile(join(dir, '.gitignore'), 'utf-8');
      expect(gitignore).toContain('custom/');
      expect(gitignore).not.toContain('.golem/');
    });

    it('generates .cursor/cli.json when permissions are configured', async () => {
      await initWorkspace(
        dir,
        {
          name: 'secure-bot',
          engine: 'cursor',
          permissions: {
            allowedPaths: ['./src', './tests'],
            deniedPaths: ['./.env', './secrets'],
            allowedCommands: ['npm test', 'npm run build'],
            deniedCommands: ['rm -rf *'],
          },
        },
        '/tmp/nonexistent',
      );

      const cliJson = JSON.parse(await readFile(join(dir, '.cursor', 'cli.json'), 'utf-8'));
      expect(cliJson.permissions.allowedDirectories).toEqual(['./src', './tests']);
      expect(cliJson.permissions.deniedDirectories).toEqual(['./.env', './secrets']);
      expect(cliJson.permissions.allowedCommands).toEqual(['npm test', 'npm run build']);
      expect(cliJson.permissions.deniedCommands).toEqual(['rm -rf *']);
    });

    it('does not generate .cursor/cli.json without permissions', async () => {
      await initWorkspace(dir, { name: 'plain-bot', engine: 'cursor' }, '/tmp/nonexistent');

      await expect(stat(join(dir, '.cursor', 'cli.json'))).rejects.toThrow();
    });

    it('installs multi-bot skill as a builtin', async () => {
      const builtinDir = join(__dirname, '..', '..', 'skills');
      await initWorkspace(dir, { name: 'fleet-bot', engine: 'cursor' }, builtinDir);

      const skillMd = await readFile(join(dir, 'skills', 'multi-bot', 'SKILL.md'), 'utf-8');
      expect(skillMd).toContain('multi-bot');
    });

    it('writes persona.role when provided', async () => {
      await initWorkspace(
        dir,
        { name: 'analyst-bot', engine: 'cursor', persona: { role: 'product analyst' } },
        '/tmp/nonexistent',
      );

      const cfg = await loadConfig(dir);
      expect(cfg.persona?.role).toBe('product analyst');
    });
  });

  // ── generateCursorCliJson ─────────────────────────

  describe('generateCursorCliJson', () => {
    it('generates cli.json with all permission fields', async () => {
      await generateCursorCliJson(dir, {
        allowedPaths: ['./src'],
        deniedPaths: ['./secrets'],
        allowedCommands: ['npm test'],
        deniedCommands: ['rm -rf /'],
      });

      const cliJson = JSON.parse(await readFile(join(dir, '.cursor', 'cli.json'), 'utf-8'));
      expect(cliJson.permissions).toEqual({
        allowedDirectories: ['./src'],
        deniedDirectories: ['./secrets'],
        allowedCommands: ['npm test'],
        deniedCommands: ['rm -rf /'],
      });
    });

    it('omits empty permission arrays', async () => {
      await generateCursorCliJson(dir, {
        allowedPaths: ['./src'],
      });

      const cliJson = JSON.parse(await readFile(join(dir, '.cursor', 'cli.json'), 'utf-8'));
      expect(cliJson.permissions.allowedDirectories).toEqual(['./src']);
      expect(cliJson.permissions.deniedDirectories).toBeUndefined();
      expect(cliJson.permissions.allowedCommands).toBeUndefined();
      expect(cliJson.permissions.deniedCommands).toBeUndefined();
    });

    it('generates empty object when no arrays provided', async () => {
      await generateCursorCliJson(dir, {});

      const cliJson = JSON.parse(await readFile(join(dir, '.cursor', 'cli.json'), 'utf-8'));
      expect(cliJson.permissions).toBeUndefined();
    });
  });

  // ── loadConfig permissions ─────────────────────────

  describe('loadConfig permissions', () => {
    it('parses permissions from golem.yaml', async () => {
      await writeFile(
        join(dir, 'golem.yaml'),
        [
          'name: secure-bot',
          'engine: cursor',
          'permissions:',
          '  allowedPaths:',
          '    - ./src',
          '  deniedCommands:',
          '    - rm -rf /',
        ].join('\n'),
        'utf-8',
      );

      const config = await loadConfig(dir);
      expect(config.permissions).toEqual({
        allowedPaths: ['./src'],
        deniedCommands: ['rm -rf /'],
      });
    });

    it('permissions is undefined when not in config', async () => {
      await writeFile(join(dir, 'golem.yaml'), 'name: bot\nengine: cursor\n', 'utf-8');
      const config = await loadConfig(dir);
      expect(config.permissions).toBeUndefined();
    });
  });

  // ── loadConfig mcp ──────────────────────────────────

  describe('loadConfig mcp', () => {
    it('parses mcp server config from golem.yaml', async () => {
      await writeFile(
        join(dir, 'golem.yaml'),
        [
          'name: bot',
          'engine: cursor',
          'mcp:',
          '  memory:',
          '    command: npx',
          '    args:',
          '      - -y',
          '      - "@anthropic-ai/mcp-memory"',
          '    env:',
          '      MEM_DIR: /tmp/mem',
        ].join('\n'),
        'utf-8',
      );

      const config = await loadConfig(dir);
      expect(config.mcp).toEqual({
        memory: {
          command: 'npx',
          args: ['-y', '@anthropic-ai/mcp-memory'],
          env: { MEM_DIR: '/tmp/mem' },
        },
      });
    });

    it('resolves env placeholders in mcp config', async () => {
      process.env.__TEST_MCP_KEY = 'secret-key';
      try {
        await writeFile(
          join(dir, 'golem.yaml'),
          [
            'name: bot',
            'engine: cursor',
            'mcp:',
            '  kb:',
            '    command: node',
            '    args:',
            '      - server.js',
            '    env:',
            '      API_KEY: ${__TEST_MCP_KEY}',
          ].join('\n'),
          'utf-8',
        );

        const config = await loadConfig(dir);
        expect(config.mcp!.kb.env!.API_KEY).toBe('secret-key');
      } finally {
        delete process.env.__TEST_MCP_KEY;
      }
    });

    it('mcp is undefined when not in config', async () => {
      await writeFile(join(dir, 'golem.yaml'), 'name: bot\nengine: cursor\n', 'utf-8');
      const config = await loadConfig(dir);
      expect(config.mcp).toBeUndefined();
    });

    it('round-trips mcp through writeConfig/loadConfig', async () => {
      const mcp = {
        memory: { command: 'npx', args: ['-y', 'mcp-memory'], env: { DIR: '/tmp' } },
        search: { command: 'node', args: ['search.js'] },
      };
      await writeConfig(dir, { name: 'test', engine: 'cursor', mcp });
      const cfg = await loadConfig(dir);
      expect(cfg.mcp).toEqual(mcp);
    });
  });

  // ── loadConfig escalation ───────────────────────────

  describe('loadConfig escalation', () => {
    it('parses escalation config from golem.yaml', async () => {
      await writeFile(
        join(dir, 'golem.yaml'),
        [
          'name: bot',
          'engine: cursor',
          'escalation:',
          '  enabled: true',
          '  target:',
          '    channel: feishu',
          '    chatId: oc_123',
        ].join('\n'),
        'utf-8',
      );

      const config = await loadConfig(dir);
      expect(config.escalation).toEqual({
        enabled: true,
        target: { channel: 'feishu', chatId: 'oc_123' },
      });
    });

    it('escalation is undefined when not in config', async () => {
      await writeFile(join(dir, 'golem.yaml'), 'name: bot\nengine: cursor\n', 'utf-8');
      const config = await loadConfig(dir);
      expect(config.escalation).toBeUndefined();
    });

    it('round-trips escalation through writeConfig/loadConfig', async () => {
      const escalation = { enabled: true, target: { channel: 'slack', chatId: 'C123' } };
      await writeConfig(dir, { name: 'test', engine: 'cursor', escalation });
      const cfg = await loadConfig(dir);
      expect(cfg.escalation).toEqual(escalation);
    });
  });

  describe('refreshSkillInjection', () => {
    it('returns false when no skills directory exists', async () => {
      await writeFile(join(dir, 'golem.yaml'), 'name: bot\nengine: cursor\n', 'utf-8');
      const changed = await refreshSkillInjection(dir);
      expect(changed).toBe(false);
    });

    it('regenerates AGENTS.md on first call', async () => {
      await writeFile(join(dir, 'golem.yaml'), 'name: bot\nengine: cursor\n', 'utf-8');
      const skillDir = join(dir, 'skills', 'test-skill');
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, 'SKILL.md'), '---\nname: test\ndescription: A test\n---\n# Test\n', 'utf-8');

      const changed = await refreshSkillInjection(dir);
      expect(changed).toBe(true);

      const agents = await readFile(join(dir, 'AGENTS.md'), 'utf-8');
      expect(agents).toContain('test-skill');
    });

    it('returns false on second call without changes', async () => {
      await writeFile(join(dir, 'golem.yaml'), 'name: bot\nengine: cursor\n', 'utf-8');
      const skillDir = join(dir, 'skills', 'test-skill');
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, 'SKILL.md'), '---\nname: test\ndescription: A test\n---\n# Test\n', 'utf-8');

      await refreshSkillInjection(dir);
      const changed = await refreshSkillInjection(dir);
      expect(changed).toBe(false);
    });
  });
});
