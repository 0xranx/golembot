import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildSessionKey, stripMention } from '../channel.js';
import {
  createEngine,
  ensureOpenCodeConfig,
  isOnPath,
  parseClaudeStreamLine,
  parseOpenCodeStreamLine,
  parseStreamLine,
  stripAnsi,
} from '../engine.js';
import { ensureReady, initWorkspace, loadConfig, resolveEnvPlaceholders, scanSkills } from '../workspace.js';

describe('error paths and edge cases', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'golem-err-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // ── Config error paths ────────────────────────

  describe('config errors', () => {
    it('loadConfig throws on malformed YAML', async () => {
      await writeFile(join(dir, 'golem.yaml'), '{{not valid yaml::}');
      await expect(loadConfig(dir)).rejects.toThrow();
    });

    it('loadConfig throws when name is missing', async () => {
      await writeFile(join(dir, 'golem.yaml'), 'engine: cursor\n');
      await expect(loadConfig(dir)).rejects.toThrow('Invalid golem.yaml');
    });

    it('loadConfig throws when engine is missing', async () => {
      await writeFile(join(dir, 'golem.yaml'), 'name: bot\n');
      await expect(loadConfig(dir)).rejects.toThrow('Invalid golem.yaml');
    });

    it('loadConfig throws when file does not exist', async () => {
      await expect(loadConfig(dir)).rejects.toThrow();
    });

    it('loadConfig handles name and engine as numbers gracefully', async () => {
      await writeFile(join(dir, 'golem.yaml'), 'name: 123\nengine: 456\n');
      await expect(loadConfig(dir)).rejects.toThrow('Invalid golem.yaml');
    });
  });

  // ── resolveEnvPlaceholders edge cases ─────────

  describe('resolveEnvPlaceholders', () => {
    it('handles nested objects with mixed types', () => {
      process.env._TEST_VAR = 'resolved';
      const result = resolveEnvPlaceholders({
        str: '${_TEST_VAR}',
        num: 42,
        bool: true,
        nil: null,
        arr: ['${_TEST_VAR}', 'literal'],
        nested: { deep: '${_TEST_VAR}' },
      });
      expect(result.str).toBe('resolved');
      expect(result.num).toBe(42);
      expect(result.bool).toBe(true);
      expect(result.nil).toBeNull();
      expect(result.arr).toEqual(['resolved', 'literal']);
      expect(result.nested.deep).toBe('resolved');
      delete process.env._TEST_VAR;
    });

    it('preserves unresolvable placeholders', () => {
      delete process.env._NONEXISTENT;
      expect(resolveEnvPlaceholders('${_NONEXISTENT}')).toBe('${_NONEXISTENT}');
    });

    it('handles empty string', () => {
      expect(resolveEnvPlaceholders('')).toBe('');
    });

    it('handles string with multiple placeholders', () => {
      process.env._A = 'hello';
      process.env._B = 'world';
      expect(resolveEnvPlaceholders('${_A} ${_B}')).toBe('hello world');
      delete process.env._A;
      delete process.env._B;
    });
  });

  // ── Engine parser edge cases ──────────────────

  describe('parser edge cases', () => {
    it('parseStreamLine handles empty string', () => {
      const event = parseStreamLine('');
      expect(event).toBeNull();
    });

    it('parseStreamLine handles non-JSON string', () => {
      const event = parseStreamLine('not json at all');
      expect(event).toBeNull();
    });

    it('parseStreamLine handles JSON without type field', () => {
      const event = parseStreamLine('{"foo":"bar"}');
      expect(event).toBeNull();
    });

    it('parseClaudeStreamLine handles empty string', () => {
      const events = parseClaudeStreamLine('');
      expect(events).toEqual([]);
    });

    it('parseClaudeStreamLine handles non-JSON', () => {
      const events = parseClaudeStreamLine('garbage');
      expect(events).toEqual([]);
    });

    it('parseOpenCodeStreamLine handles empty string', () => {
      const events = parseOpenCodeStreamLine('');
      expect(events).toEqual([]);
    });

    it('parseOpenCodeStreamLine handles non-JSON', () => {
      const events = parseOpenCodeStreamLine('not json');
      expect(events).toEqual([]);
    });

    it('parseStreamLine handles assistant event with empty content array', () => {
      const event = parseStreamLine(
        JSON.stringify({
          type: 'assistant',
          message: { content: [] },
        }),
      );
      expect(event).toBeNull();
    });

    it('parseStreamLine handles system event (returns null — not a terminal event)', () => {
      const event = parseStreamLine(
        JSON.stringify({
          type: 'system',
          subtype: 'init',
          session_id: 'ses_test',
        }),
      );
      expect(event).toBeNull();
    });
  });

  // ── createEngine error paths ──────────────────

  describe('createEngine', () => {
    it('throws for unknown engine type', () => {
      expect(() => createEngine('unknown-engine')).toThrow();
    });

    it('creates cursor engine', () => {
      const engine = createEngine('cursor');
      expect(engine).toBeDefined();
    });

    it('creates claude-code engine', () => {
      const engine = createEngine('claude-code');
      expect(engine).toBeDefined();
    });

    it('creates opencode engine', () => {
      const engine = createEngine('opencode');
      expect(engine).toBeDefined();
    });

    it('creates grok engine', () => {
      const engine = createEngine('grok');
      expect(engine).toBeDefined();
    });
  });

  // ── stripAnsi edge cases ──────────────────────

  describe('stripAnsi', () => {
    it('handles empty string', () => {
      expect(stripAnsi('')).toBe('');
    });

    it('handles string with no ANSI codes', () => {
      expect(stripAnsi('plain text')).toBe('plain text');
    });

    it('strips multiple ANSI sequences', () => {
      expect(stripAnsi('\x1b[31mred\x1b[0m \x1b[32mgreen\x1b[0m')).toBe('red green');
    });
  });

  // ── Channel edge cases ────────────────────────

  describe('channel edge cases', () => {
    it('buildSessionKey handles empty strings', () => {
      const key = buildSessionKey({
        channelType: '',
        senderId: '',
        chatId: '',
        chatType: 'dm',
        text: '',
        raw: {},
      });
      expect(key).toBe('::');
    });

    it('stripMention handles text with only whitespace', () => {
      expect(stripMention('   ')).toBe('');
    });

    it('stripMention handles text with only mention', () => {
      expect(stripMention('@BotName')).toBe('');
    });

    it('stripMention handles multiple @ mentions', () => {
      const result = stripMention('@Bot1 @Bot2 actual message');
      expect(result).toContain('actual message');
    });
  });

  // ── Workspace edge cases ──────────────────────

  describe('workspace edge cases', () => {
    it('scanSkills handles symlinks in skills directory gracefully', async () => {
      await mkdir(join(dir, 'skills'), { recursive: true });
      // Just a plain file, not a directory
      await writeFile(join(dir, 'skills', 'not-a-dir.txt'), 'just a file');

      const skills = await scanSkills(dir);
      expect(skills).toEqual([]);
    });

    it('scanSkills ignores skill directories without SKILL.md', async () => {
      const skillDir = join(dir, 'skills', 'empty-skill');
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, 'README.md'), '# Not a SKILL.md');

      const skills = await scanSkills(dir);
      expect(skills).toEqual([]);
    });

    it('ensureReady works with a valid setup', async () => {
      await writeFile(join(dir, 'golem.yaml'), 'name: test\nengine: cursor\n');
      await mkdir(join(dir, 'skills', 'demo'), { recursive: true });
      await writeFile(join(dir, 'skills', 'demo', 'SKILL.md'), '---\nname: demo\ndescription: Demo\n---\n');

      const { config, skills } = await ensureReady(dir);
      expect(config.name).toBe('test');
      expect(skills).toHaveLength(1);

      const agentsMd = await readFile(join(dir, 'AGENTS.md'), 'utf-8');
      expect(agentsMd).toContain('demo');
    });

    it('initWorkspace prevents double initialization', async () => {
      await writeFile(join(dir, 'golem.yaml'), 'name: existing\nengine: cursor\n');
      await expect(initWorkspace(dir, { name: 'new', engine: 'cursor' }, '/tmp')).rejects.toThrow('already exists');
    });
  });

  // ── ensureOpenCodeConfig edge cases ───────────

  describe('ensureOpenCodeConfig', () => {
    it('creates config when none exists', async () => {
      await ensureOpenCodeConfig(dir, 'openrouter/anthropic/claude-sonnet-4');
      const content = JSON.parse(await readFile(join(dir, 'opencode.json'), 'utf-8'));
      expect(content.permission).toEqual({ '*': 'allow' });
      expect(content.model).toBe('openrouter/anthropic/claude-sonnet-4');
    });

    it('preserves existing fields in opencode.json', async () => {
      await writeFile(
        join(dir, 'opencode.json'),
        JSON.stringify({
          customField: 'keep-me',
          model: 'existing-model',
        }),
      );
      await ensureOpenCodeConfig(dir, 'new-model');
      const content = JSON.parse(await readFile(join(dir, 'opencode.json'), 'utf-8'));
      expect(content.customField).toBe('keep-me');
    });

    it('does not overwrite existing permission config', async () => {
      await writeFile(
        join(dir, 'opencode.json'),
        JSON.stringify({
          permission: { Read: 'deny' },
        }),
      );
      await ensureOpenCodeConfig(dir);
      const content = JSON.parse(await readFile(join(dir, 'opencode.json'), 'utf-8'));
      expect(content.permission.Read).toBe('deny');
    });
  });

  // ── CLI binary detection ───────────────────────

  describe('isOnPath', () => {
    it('returns true for a known system command', () => {
      expect(isOnPath('node')).toBe(true);
    });

    it('returns false for a nonexistent command', () => {
      expect(isOnPath('golem-nonexistent-binary-xyz')).toBe(false);
    });
  });

  describe('engine invoke with missing binary', () => {
    async function drainFirst(iterable: AsyncIterable<unknown>): Promise<unknown> {
      const iter = iterable[Symbol.asyncIterator]();
      return iter.next();
    }

    it('CursorEngine.invoke throws with install guidance when binary is missing', async () => {
      const engine = createEngine('cursor');
      const fakeHome = join(dir, 'fake-home');
      await mkdir(fakeHome, { recursive: true });

      const originalHome = process.env.HOME;
      const originalPath = process.env.PATH;
      try {
        process.env.HOME = fakeHome;
        process.env.PATH = fakeHome;
        await expect(drainFirst(engine.invoke('test', { workspace: dir, skillPaths: [] }))).rejects.toThrow(
          'curl https://cursor.com/install',
        );
      } finally {
        process.env.HOME = originalHome;
        process.env.PATH = originalPath;
      }
    });

    it('ClaudeCodeEngine.invoke throws with install guidance when binary is missing', async () => {
      const engine = createEngine('claude-code');
      const fakeHome = join(dir, 'fake-home');
      await mkdir(fakeHome, { recursive: true });

      const originalHome = process.env.HOME;
      const originalPath = process.env.PATH;
      try {
        process.env.HOME = fakeHome;
        process.env.PATH = fakeHome;
        await expect(drainFirst(engine.invoke('test', { workspace: dir, skillPaths: [] }))).rejects.toThrow(
          'npm install -g @anthropic-ai/claude-code',
        );
      } finally {
        process.env.HOME = originalHome;
        process.env.PATH = originalPath;
      }
    });

    it('OpenCodeEngine.invoke throws with install guidance when binary is missing', async () => {
      const engine = createEngine('opencode');
      const fakeHome = join(dir, 'fake-home');
      await mkdir(fakeHome, { recursive: true });

      const originalHome = process.env.HOME;
      const originalPath = process.env.PATH;
      try {
        process.env.HOME = fakeHome;
        process.env.PATH = fakeHome;
        await expect(drainFirst(engine.invoke('test', { workspace: dir, skillPaths: [] }))).rejects.toThrow(
          'npm install -g opencode-ai',
        );
      } finally {
        process.env.HOME = originalHome;
        process.env.PATH = originalPath;
      }
    });
  });
});
