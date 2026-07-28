import { lstat, mkdir, mkdtemp, readdir, readFile, readlink, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StreamEvent } from '../engine.js';
import {
  buildCodexExecArgs,
  buildGrokArgs,
  ClaudeCodeEngine,
  CodexEngine,
  CursorEngine,
  createEngine,
  ensureOpenCodeConfig,
  GrokEngine,
  injectClaudeSkills,
  injectCodexSkills,
  injectGrokSkills,
  injectOpenCodeSkills,
  injectSkills,
  OpenCodeEngine,
  parseClaudeStreamLine,
  parseCodexStreamLine,
  parseGrokStreamLine,
  parseOpenCodeStreamLine,
  parseStreamLine,
  resolveCodexMode,
  resolveOpenCodeEnv,
  stripAnsi,
  writeGrokMcpConfig,
} from '../engine.js';

// ═══════════════════════════════════════════════════════
// Real Cursor stream-json samples (based on actual output)
// ═══════════════════════════════════════════════════════

const SAMPLES = {
  systemInit: '{"type":"system","subtype":"init","session_id":"sess-abc-123"}',

  assistantSimple: JSON.stringify({
    type: 'assistant',
    message: {
      content: [{ type: 'text', text: 'Hello! I am your AI assistant.' }],
    },
    session_id: 'sess-abc-123',
    timestamp_ms: 1700000000000,
  }),

  assistantMultiBlock: JSON.stringify({
    type: 'assistant',
    message: {
      content: [
        { type: 'text', text: 'First paragraph reply.' },
        { type: 'text', text: 'Second paragraph supplement.' },
      ],
    },
    session_id: 'sess-abc-123',
    timestamp_ms: 1700000000100,
  }),

  // Summary event (no timestamp_ms) — should be skipped to avoid duplication
  assistantSummary: JSON.stringify({
    type: 'assistant',
    message: {
      content: [{ type: 'text', text: 'Complete reply text (duplicate summary)' }],
    },
    session_id: 'sess-abc-123',
  }),

  assistantEmpty: JSON.stringify({
    type: 'assistant',
    message: { content: [] },
    timestamp_ms: 1700000000200,
  }),

  toolCallRead: JSON.stringify({
    type: 'tool_call',
    subtype: 'started',
    tool_call: {
      ReadToolCall: {
        args: { path: '/home/user/notes.md', limit: 100 },
      },
    },
    session_id: 'sess-abc-123',
  }),

  toolCallWrite: JSON.stringify({
    type: 'tool_call',
    subtype: 'completed',
    tool_call: {
      WriteToolCall: {
        args: { path: '/home/user/report.md', content: '# Report' },
      },
    },
  }),

  toolCallShell: JSON.stringify({
    type: 'tool_call',
    subtype: 'started',
    tool_call: {
      ShellToolCall: {
        args: { command: 'python analyze.py --verbose' },
      },
    },
  }),

  resultSuccess: JSON.stringify({
    type: 'result',
    subtype: 'success',
    result: 'Task completed.',
    is_error: false,
    session_id: 'sess-abc-123',
    duration_ms: 4500,
  }),

  resultError: JSON.stringify({
    type: 'result',
    subtype: 'error',
    result: 'Agent response timeout.',
    is_error: true,
    session_id: 'sess-abc-123',
    duration_ms: 600000,
  }),

  resultResumeError: JSON.stringify({
    type: 'result',
    subtype: 'error',
    result: 'Failed to resume session: session expired',
    is_error: true,
  }),

  modelError:
    '{"type":"result","subtype":"error","is_error":true,"result":"Cannot use this model with your current plan"}',
};

// ═══════════════════════════════════════════════════════
// stripAnsi
// ═══════════════════════════════════════════════════════

describe('stripAnsi', () => {
  it('removes color codes', () => {
    expect(stripAnsi('\x1b[32m> Checking prebuilds...\x1b[0m')).toBe('> Checking prebuilds...');
  });

  it('removes cursor movement codes', () => {
    expect(stripAnsi('\x1b[2A\x1b[107Ghello')).toBe('hello');
  });

  it('removes bold/underline codes', () => {
    expect(stripAnsi('\x1b[1mBold\x1b[22m \x1b[4mUnderline\x1b[24m')).toBe('Bold Underline');
  });

  it('handles mixed ANSI + JSON', () => {
    const line = `\x1b[32m${SAMPLES.systemInit}\x1b[0m`;
    const cleaned = stripAnsi(line);
    expect(JSON.parse(cleaned)).toHaveProperty('type', 'system');
  });

  it('returns plain string unchanged', () => {
    expect(stripAnsi('hello world')).toBe('hello world');
  });
});

// ═══════════════════════════════════════════════════════
// parseStreamLine — based on real Cursor output scenarios
// ═══════════════════════════════════════════════════════

describe('parseStreamLine', () => {
  // ── system events ────────────────────────────────

  it('system init → null (does not terminate stream)', () => {
    const evt = parseStreamLine(SAMPLES.systemInit);
    expect(evt).toBeNull();
  });

  it('system event without session_id → null', () => {
    const evt = parseStreamLine('{"type":"system","subtype":"init"}');
    expect(evt).toBeNull();
  });

  // ── assistant events ─────────────────────────────

  it('assistant with simple text', () => {
    const evt = parseStreamLine(SAMPLES.assistantSimple);
    expect(evt).toEqual({ type: 'text', content: 'Hello! I am your AI assistant.' });
  });

  it('assistant with multiple text blocks → joined', () => {
    const evt = parseStreamLine(SAMPLES.assistantMultiBlock);
    expect(evt).toEqual({ type: 'text', content: 'First paragraph reply.\nSecond paragraph supplement.' });
  });

  it('assistant with empty content → null', () => {
    const evt = parseStreamLine(SAMPLES.assistantEmpty);
    expect(evt).toBeNull();
  });

  it('assistant summary (no timestamp_ms) → still returns text (dedup is in CursorEngine layer)', () => {
    const evt = parseStreamLine(SAMPLES.assistantSummary);
    expect(evt).toEqual({ type: 'text', content: 'Complete reply text (duplicate summary)' });
  });

  // ── tool_call events ─────────────────────────────

  it('tool_call ReadToolCall', () => {
    const evt = parseStreamLine(SAMPLES.toolCallRead);
    expect(evt?.type).toBe('tool_call');
    if (evt?.type === 'tool_call') {
      expect(evt.name).toBe('ReadToolCall');
      expect(JSON.parse(evt.args)).toHaveProperty('path', '/home/user/notes.md');
    }
  });

  it('tool_call completed → tool_result', () => {
    const evt = parseStreamLine(SAMPLES.toolCallWrite);
    expect(evt?.type).toBe('tool_result');
  });

  it('tool_call ShellToolCall', () => {
    const evt = parseStreamLine(SAMPLES.toolCallShell);
    expect(evt?.type).toBe('tool_call');
    if (evt?.type === 'tool_call') {
      expect(evt.name).toBe('ShellToolCall');
      expect(JSON.parse(evt.args)).toHaveProperty('command', 'python analyze.py --verbose');
    }
  });

  // ── result events ────────────────────────────────

  it('result success → done with sessionId and durationMs', () => {
    const evt = parseStreamLine(SAMPLES.resultSuccess);
    expect(evt).toEqual({ type: 'done', sessionId: 'sess-abc-123', durationMs: 4500, fullText: 'Task completed.' });
  });

  it('result success without duration_ms → durationMs undefined', () => {
    const line = JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: 'Done.',
      is_error: false,
      session_id: 'sess-no-dur',
    });
    const evt = parseStreamLine(line);
    expect(evt).toEqual({ type: 'done', sessionId: 'sess-no-dur', durationMs: undefined, fullText: 'Done.' });
  });

  it('result success with duration_ms=0 → durationMs 0', () => {
    const line = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      session_id: 'sess-zero',
      duration_ms: 0,
    });
    const evt = parseStreamLine(line);
    expect(evt).toEqual({ type: 'done', sessionId: 'sess-zero', durationMs: 0, fullText: undefined });
  });

  it('result error → error event (durationMs not exposed on errors)', () => {
    const evt = parseStreamLine(SAMPLES.resultError);
    expect(evt).toEqual({ type: 'error', message: 'Agent response timeout.' });
  });

  it('result resume error → error event', () => {
    const evt = parseStreamLine(SAMPLES.resultResumeError);
    expect(evt).toEqual({
      type: 'error',
      message: 'Failed to resume session: session expired',
    });
  });

  it('model error → error event', () => {
    const evt = parseStreamLine(SAMPLES.modelError);
    expect(evt?.type).toBe('error');
    if (evt?.type === 'error') {
      expect(evt.message).toContain('Cannot use this model');
    }
  });

  it('tool_call with function structure', () => {
    const line = JSON.stringify({
      type: 'tool_call',
      subtype: 'started',
      tool_call: {
        function: { name: 'custom_tool', arguments: '{"query": "test"}' },
      },
    });
    const evt = parseStreamLine(line);
    expect(evt?.type).toBe('tool_call');
    if (evt?.type === 'tool_call') {
      expect(evt.name).toBe('custom_tool');
      expect(evt.args).toBe('{"query": "test"}');
    }
  });

  it('tool_call completed with result data', () => {
    const line = JSON.stringify({
      type: 'tool_call',
      subtype: 'completed',
      tool_call: {
        readToolCall: {
          args: { path: 'file.txt' },
          result: { success: { content: 'hello', totalLines: 1 } },
        },
      },
    });
    const evt = parseStreamLine(line);
    expect(evt?.type).toBe('tool_result');
    if (evt?.type === 'tool_result') {
      const result = JSON.parse(evt.content);
      expect(result.success.content).toBe('hello');
    }
  });

  // ── edge cases ───────────────────────────────────

  it('empty string → null', () => {
    expect(parseStreamLine('')).toBeNull();
  });

  it('whitespace only → null', () => {
    expect(parseStreamLine('   \n  ')).toBeNull();
  });

  it('non-JSON text → null', () => {
    expect(parseStreamLine('Loading agent...')).toBeNull();
  });

  it('invalid JSON → null', () => {
    expect(parseStreamLine('{"broken')).toBeNull();
  });

  it('JSON without type field → null', () => {
    expect(parseStreamLine('{"foo":"bar"}')).toBeNull();
  });

  it('handles ANSI-wrapped JSON', () => {
    const line = `\x1b[32m${SAMPLES.assistantSimple}\x1b[0m`;
    const evt = parseStreamLine(line);
    expect(evt?.type).toBe('text');
  });

  // ── full conversation simulation ─────────────────

  it('parses a realistic multi-step conversation stream', () => {
    const lines = [
      SAMPLES.systemInit,
      SAMPLES.assistantSimple,
      SAMPLES.toolCallRead,
      SAMPLES.toolCallShell,
      SAMPLES.assistantMultiBlock,
      SAMPLES.resultSuccess,
    ];

    const events = lines.map((l) => parseStreamLine(l)).filter((e): e is StreamEvent => e !== null);

    // system init → null (filtered out), so first event is assistant text
    expect(events[0].type).toBe('text');
    // two tool calls
    expect(events[1].type).toBe('tool_call');
    expect(events[2].type).toBe('tool_call');
    // second assistant text
    expect(events[3].type).toBe('text');
    // result → done with durationMs
    expect(events[4].type).toBe('done');
    expect((events[4] as { type: 'done'; durationMs?: number }).durationMs).toBe(4500);
  });
});

// ═══════════════════════════════════════════════════════
// injectSkills — real symlink operations
// ═══════════════════════════════════════════════════════

describe('injectSkills', () => {
  let workspace: string;
  let skillSrc: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'golem-test-inject-'));
    skillSrc = await mkdtemp(join(tmpdir(), 'golem-test-skillsrc-'));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
    await rm(skillSrc, { recursive: true, force: true });
  });

  it('creates .cursor/skills/ with symlinks', async () => {
    const skill1 = join(skillSrc, 'general');
    const skill2 = join(skillSrc, 'ops-xhs');
    await mkdir(skill1, { recursive: true });
    await mkdir(skill2, { recursive: true });
    await writeFile(join(skill1, 'SKILL.md'), '# General');
    await writeFile(join(skill2, 'SKILL.md'), '# XHS');

    await injectSkills(workspace, [skill1, skill2]);

    const cursorSkills = join(workspace, '.cursor', 'skills');
    const entries = await readdir(cursorSkills);
    expect(entries.sort()).toEqual(['general', 'ops-xhs']);

    const target1 = await readlink(join(cursorSkills, 'general'));
    expect(target1).toBe(skill1);
  });

  it('cleans old symlinks before re-injecting', async () => {
    const skillA = join(skillSrc, 'alpha');
    const skillB = join(skillSrc, 'beta');
    await mkdir(skillA, { recursive: true });
    await mkdir(skillB, { recursive: true });

    // First injection
    await injectSkills(workspace, [skillA]);
    let entries = await readdir(join(workspace, '.cursor', 'skills'));
    expect(entries).toEqual(['alpha']);

    // Second injection with different skill
    await injectSkills(workspace, [skillB]);
    entries = await readdir(join(workspace, '.cursor', 'skills'));
    expect(entries).toEqual(['beta']);
  });

  it('handles empty skill list', async () => {
    await injectSkills(workspace, []);
    const cursorSkills = join(workspace, '.cursor', 'skills');
    const entries = await readdir(cursorSkills);
    expect(entries).toEqual([]);
  });

  it('does not remove non-symlink entries in .cursor/skills/', async () => {
    const cursorSkills = join(workspace, '.cursor', 'skills');
    await mkdir(cursorSkills, { recursive: true });
    // Pre-existing real directory (not a symlink)
    await mkdir(join(cursorSkills, 'user-managed'));
    await writeFile(join(cursorSkills, 'user-managed', 'SKILL.md'), '# User');

    const skill1 = join(skillSrc, 'injected');
    await mkdir(skill1, { recursive: true });

    await injectSkills(workspace, [skill1]);

    const entries = (await readdir(cursorSkills)).sort();
    expect(entries).toContain('user-managed');
    expect(entries).toContain('injected');
  });
});

// ═══════════════════════════════════════════════════════
// Claude Code stream-json samples
// ═══════════════════════════════════════════════════════

const CLAUDE_SAMPLES = {
  systemInit: JSON.stringify({
    type: 'system',
    subtype: 'init',
    session_id: 'session_01',
    cwd: '/repo',
    model: 'sonnet',
    tools: ['Bash', 'Read', 'Write'],
    mcp_servers: [],
  }),

  assistantText: JSON.stringify({
    type: 'assistant',
    session_id: 'session_01',
    message: {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'Planning next steps.' }],
      usage: { input_tokens: 120, output_tokens: 45 },
    },
  }),

  assistantToolUse: JSON.stringify({
    type: 'assistant',
    session_id: 'session_01',
    message: {
      id: 'msg_2',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls -la' } }],
    },
  }),

  assistantMixed: JSON.stringify({
    type: 'assistant',
    session_id: 'session_01',
    message: {
      id: 'msg_mixed',
      type: 'message',
      role: 'assistant',
      content: [
        { type: 'text', text: 'Let me read the file.' },
        { type: 'tool_use', id: 'toolu_2', name: 'Read', input: { file_path: 'README.md' } },
      ],
    },
  }),

  assistantEmpty: JSON.stringify({
    type: 'assistant',
    session_id: 'session_01',
    message: { id: 'msg_e', type: 'message', role: 'assistant', content: [] },
  }),

  userToolResultString: JSON.stringify({
    type: 'user',
    session_id: 'session_01',
    message: {
      id: 'msg_3',
      type: 'message',
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'total 2\nREADME.md\nsrc\n' }],
    },
  }),

  userToolResultArray: JSON.stringify({
    type: 'user',
    session_id: 'session_01',
    message: {
      id: 'msg_4',
      type: 'message',
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'toolu_2', content: [{ type: 'text', text: 'Task completed' }] }],
    },
  }),

  resultSuccess: JSON.stringify({
    type: 'result',
    subtype: 'success',
    session_id: 'session_01',
    total_cost_usd: 0.0123,
    is_error: false,
    duration_ms: 12345,
    duration_api_ms: 12000,
    num_turns: 2,
    result: 'Done.',
    usage: { input_tokens: 150, output_tokens: 70 },
  }),

  resultError: JSON.stringify({
    type: 'result',
    subtype: 'error',
    session_id: 'session_02',
    total_cost_usd: 0.001,
    is_error: true,
    duration_ms: 2000,
    result: '',
    error: 'Permission denied',
    permission_denials: [{ tool_name: 'Bash', tool_use_id: 'toolu_9' }],
  }),

  resultErrorWithResult: JSON.stringify({
    type: 'result',
    subtype: 'error',
    is_error: true,
    result: 'Model overloaded, please try again',
  }),
};

// ═══════════════════════════════════════════════════════
// parseClaudeStreamLine
// ═══════════════════════════════════════════════════════

describe('parseClaudeStreamLine', () => {
  it('system init → empty array', () => {
    expect(parseClaudeStreamLine(CLAUDE_SAMPLES.systemInit)).toEqual([]);
  });

  it('assistant text → [text event]', () => {
    const events = parseClaudeStreamLine(CLAUDE_SAMPLES.assistantText);
    expect(events).toEqual([{ type: 'text', content: 'Planning next steps.' }]);
  });

  it('assistant tool_use → [tool_call event]', () => {
    const events = parseClaudeStreamLine(CLAUDE_SAMPLES.assistantToolUse);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('tool_call');
    if (events[0].type === 'tool_call') {
      expect(events[0].name).toBe('Bash');
      expect(JSON.parse(events[0].args)).toEqual({ command: 'ls -la' });
    }
  });

  it('assistant mixed text + tool_use → [text, tool_call]', () => {
    const events = parseClaudeStreamLine(CLAUDE_SAMPLES.assistantMixed);
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ type: 'text', content: 'Let me read the file.' });
    expect(events[1].type).toBe('tool_call');
    if (events[1].type === 'tool_call') {
      expect(events[1].name).toBe('Read');
      expect(JSON.parse(events[1].args)).toEqual({ file_path: 'README.md' });
    }
  });

  it('assistant empty content → empty array', () => {
    expect(parseClaudeStreamLine(CLAUDE_SAMPLES.assistantEmpty)).toEqual([]);
  });

  it('user tool_result with string content', () => {
    const events = parseClaudeStreamLine(CLAUDE_SAMPLES.userToolResultString);
    expect(events).toEqual([{ type: 'tool_result', content: 'total 2\nREADME.md\nsrc\n' }]);
  });

  it('user tool_result with array content', () => {
    const events = parseClaudeStreamLine(CLAUDE_SAMPLES.userToolResultArray);
    expect(events).toEqual([{ type: 'tool_result', content: 'Task completed' }]);
  });

  it('result success → done with all metadata', () => {
    const events = parseClaudeStreamLine(CLAUDE_SAMPLES.resultSuccess);
    expect(events).toEqual([
      {
        type: 'done',
        sessionId: 'session_01',
        durationMs: 12345,
        costUsd: 0.0123,
        numTurns: 2,
        fullText: 'Done.',
      },
    ]);
  });

  it('result success without optional fields → undefined metadata', () => {
    const line = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      session_id: 'sess-minimal',
    });
    const events = parseClaudeStreamLine(line);
    expect(events).toEqual([
      {
        type: 'done',
        sessionId: 'sess-minimal',
        durationMs: undefined,
        costUsd: undefined,
        numTurns: undefined,
        fullText: undefined,
      },
    ]);
  });

  it('result error with error field', () => {
    const events = parseClaudeStreamLine(CLAUDE_SAMPLES.resultError);
    expect(events).toEqual([{ type: 'error', message: 'Permission denied' }]);
  });

  it('result error with result field (fallback)', () => {
    const events = parseClaudeStreamLine(CLAUDE_SAMPLES.resultErrorWithResult);
    expect(events).toEqual([{ type: 'error', message: 'Model overloaded, please try again' }]);
  });

  it('empty string → empty array', () => {
    expect(parseClaudeStreamLine('')).toEqual([]);
  });

  it('whitespace only → empty array', () => {
    expect(parseClaudeStreamLine('   \n  ')).toEqual([]);
  });

  it('non-JSON text → empty array', () => {
    expect(parseClaudeStreamLine('Loading claude...')).toEqual([]);
  });

  it('invalid JSON → empty array', () => {
    expect(parseClaudeStreamLine('{"broken')).toEqual([]);
  });

  it('JSON without type field → empty array', () => {
    expect(parseClaudeStreamLine('{"foo":"bar"}')).toEqual([]);
  });

  it('parses a realistic multi-step Claude Code conversation', () => {
    const lines = [
      CLAUDE_SAMPLES.systemInit,
      CLAUDE_SAMPLES.assistantText,
      CLAUDE_SAMPLES.assistantToolUse,
      CLAUDE_SAMPLES.userToolResultString,
      CLAUDE_SAMPLES.assistantMixed,
      CLAUDE_SAMPLES.userToolResultArray,
      CLAUDE_SAMPLES.resultSuccess,
    ];

    const allEvents = lines.flatMap((l) => parseClaudeStreamLine(l));

    // system → [], assistant text → [text], tool_use → [tool_call],
    // user result → [tool_result], mixed → [text, tool_call],
    // user result → [tool_result], result → [done]
    expect(allEvents).toHaveLength(7);
    expect(allEvents[0].type).toBe('text');
    expect(allEvents[1].type).toBe('tool_call');
    expect(allEvents[2].type).toBe('tool_result');
    expect(allEvents[3].type).toBe('text');
    expect(allEvents[4].type).toBe('tool_call');
    expect(allEvents[5].type).toBe('tool_result');
    expect(allEvents[6].type).toBe('done');

    const done = allEvents[6] as { type: 'done'; durationMs?: number; costUsd?: number; numTurns?: number };
    expect(done.durationMs).toBe(12345);
    expect(done.costUsd).toBe(0.0123);
    expect(done.numTurns).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════
// injectClaudeSkills — symlinks to .claude/skills/ + CLAUDE.md
// ═══════════════════════════════════════════════════════

describe('injectClaudeSkills', () => {
  let workspace: string;
  let skillSrc: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'golem-test-claude-inject-'));
    skillSrc = await mkdtemp(join(tmpdir(), 'golem-test-claude-skillsrc-'));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
    await rm(skillSrc, { recursive: true, force: true });
  });

  it('creates .claude/skills/ with symlinks', async () => {
    const skill1 = join(skillSrc, 'general');
    const skill2 = join(skillSrc, 'devops');
    await mkdir(skill1, { recursive: true });
    await mkdir(skill2, { recursive: true });

    await injectClaudeSkills(workspace, [skill1, skill2]);

    const claudeSkills = join(workspace, '.claude', 'skills');
    const entries = await readdir(claudeSkills);
    expect(entries.sort()).toEqual(['devops', 'general']);

    const target1 = await readlink(join(claudeSkills, 'general'));
    expect(target1).toBe(skill1);
  });

  it('creates CLAUDE.md as symlink to AGENTS.md', async () => {
    await injectClaudeSkills(
      workspace,
      [],
      [
        { name: 'general', description: 'General assistant' },
        { name: 'devops', description: 'DevOps operations' },
      ],
    );

    const claudeMdPath = join(workspace, 'CLAUDE.md');
    const s = await lstat(claudeMdPath);
    expect(s.isSymbolicLink()).toBe(true);
    const target = await readlink(claudeMdPath);
    expect(target).toBe('AGENTS.md');
  });

  it('recreates CLAUDE.md symlink on re-inject', async () => {
    // First inject
    await injectClaudeSkills(workspace, []);
    // Second inject should not throw
    await injectClaudeSkills(workspace, []);

    const s = await lstat(join(workspace, 'CLAUDE.md'));
    expect(s.isSymbolicLink()).toBe(true);
  });

  it('cleans old symlinks before re-injecting', async () => {
    const skillA = join(skillSrc, 'alpha');
    const skillB = join(skillSrc, 'beta');
    await mkdir(skillA, { recursive: true });
    await mkdir(skillB, { recursive: true });

    await injectClaudeSkills(workspace, [skillA]);
    let entries = await readdir(join(workspace, '.claude', 'skills'));
    expect(entries).toEqual(['alpha']);

    await injectClaudeSkills(workspace, [skillB]);
    entries = await readdir(join(workspace, '.claude', 'skills'));
    expect(entries).toEqual(['beta']);
  });

  it('does not remove non-symlink entries in .claude/skills/', async () => {
    const claudeSkills = join(workspace, '.claude', 'skills');
    await mkdir(claudeSkills, { recursive: true });
    await mkdir(join(claudeSkills, 'user-managed'));
    await writeFile(join(claudeSkills, 'user-managed', 'SKILL.md'), '# User');

    const skill1 = join(skillSrc, 'injected');
    await mkdir(skill1, { recursive: true });

    await injectClaudeSkills(workspace, [skill1]);

    const entries = (await readdir(claudeSkills)).sort();
    expect(entries).toContain('user-managed');
    expect(entries).toContain('injected');
  });
});

// ═══════════════════════════════════════════════════════
// createEngine factory
// ═══════════════════════════════════════════════════════

describe('createEngine', () => {
  it('cursor → CursorEngine', () => {
    expect(createEngine('cursor')).toBeInstanceOf(CursorEngine);
  });

  it('claude-code → ClaudeCodeEngine', () => {
    expect(createEngine('claude-code')).toBeInstanceOf(ClaudeCodeEngine);
  });

  it('opencode → OpenCodeEngine', () => {
    expect(createEngine('opencode')).toBeInstanceOf(OpenCodeEngine);
  });

  it('codex → CodexEngine', () => {
    expect(createEngine('codex')).toBeInstanceOf(CodexEngine);
  });

  it('grok → GrokEngine', () => {
    expect(createEngine('grok')).toBeInstanceOf(GrokEngine);
  });

  it('unknown engine → throws', () => {
    expect(() => createEngine('gpt')).toThrow(/Unsupported engine/);
  });
});

// ═══════════════════════════════════════════════════════
// OpenCode stream-json samples
// ═══════════════════════════════════════════════════════

const OPENCODE_SAMPLES = {
  errorEvent: JSON.stringify({
    type: 'error',
    timestamp: 1772335804867,
    sessionID: 'ses_3588dd885ffeJynG8QZsSrpPiL',
    error: {
      name: 'APIError',
      data: {
        message: 'Your credit balance is too low to make this request.',
        statusCode: 400,
        isRetryable: false,
      },
    },
  }),

  errorMinimal: JSON.stringify({
    type: 'error',
    error: { name: 'NetworkError' },
  }),

  textEvent: JSON.stringify({
    type: 'text',
    timestamp: 1772337656660,
    sessionID: 'ses_abc123',
    part: {
      type: 'text',
      text: 'Let me help you analyze this problem.',
      time: { start: 1772337656655, end: 1772337656655 },
    },
  }),

  textEmpty: JSON.stringify({
    type: 'text',
    sessionID: 'ses_abc123',
    part: { type: 'text', text: '' },
  }),

  toolUseCompleted: JSON.stringify({
    type: 'tool_use',
    timestamp: 1772337671383,
    sessionID: 'ses_abc123',
    part: {
      type: 'tool',
      tool: 'read',
      state: {
        status: 'completed',
        input: { filePath: '/tmp/test.txt' },
        output: '<file>\n00001| hello world\n</file>',
      },
    },
  }),

  toolUsePending: JSON.stringify({
    type: 'tool_use',
    sessionID: 'ses_abc123',
    part: {
      type: 'tool',
      tool: 'bash',
      state: {
        status: 'pending',
        input: { command: 'ls -la' },
      },
    },
  }),

  toolUseNoState: JSON.stringify({
    type: 'tool_use',
    sessionID: 'ses_abc123',
    part: {
      type: 'tool',
      tool: 'write',
    },
  }),

  stepFinish: JSON.stringify({
    type: 'step_finish',
    timestamp: 1772337656661,
    sessionID: 'ses_abc123',
    part: {
      type: 'step-finish',
      reason: 'stop',
      cost: 0.034347,
      tokens: { input: 11424, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
    },
  }),

  stepFinishNoCost: JSON.stringify({
    type: 'step_finish',
    sessionID: 'ses_abc123',
    part: { type: 'step-finish', reason: 'stop' },
  }),

  stepFinishToolCalls: JSON.stringify({
    type: 'step_finish',
    sessionID: 'ses_abc123',
    part: {
      type: 'step-finish',
      reason: 'tool-calls',
      cost: 0.005,
      tokens: { input: 151, output: 79, reasoning: 0, cache: { read: 11277, write: 0 } },
    },
  }),

  stepStart: JSON.stringify({
    type: 'step_start',
    sessionID: 'ses_abc123',
    part: { type: 'step-start' },
  }),
};

// ═══════════════════════════════════════════════════════
// resolveOpenCodeEnv
// ═══════════════════════════════════════════════════════

describe('resolveOpenCodeEnv', () => {
  it('no apiKey → empty object', () => {
    expect(resolveOpenCodeEnv('openrouter/some-model')).toEqual({});
  });

  it('no model → defaults to OPENROUTER_API_KEY', () => {
    expect(resolveOpenCodeEnv(undefined, 'sk-xxx')).toEqual({ OPENROUTER_API_KEY: 'sk-xxx' });
  });

  it('anthropic model → ANTHROPIC_API_KEY', () => {
    expect(resolveOpenCodeEnv('anthropic/claude-sonnet-4-5', 'sk-ant')).toEqual({ ANTHROPIC_API_KEY: 'sk-ant' });
  });

  it('openai model → OPENAI_API_KEY', () => {
    expect(resolveOpenCodeEnv('openai/gpt-5', 'sk-oai')).toEqual({ OPENAI_API_KEY: 'sk-oai' });
  });

  it('openrouter model → OPENROUTER_API_KEY', () => {
    expect(resolveOpenCodeEnv('openrouter/anthropic/claude-sonnet-4-5', 'sk-or')).toEqual({
      OPENROUTER_API_KEY: 'sk-or',
    });
  });

  it('google model → GOOGLE_GENERATIVE_AI_API_KEY', () => {
    expect(resolveOpenCodeEnv('google/gemini-2.5-pro', 'gkey')).toEqual({ GOOGLE_GENERATIVE_AI_API_KEY: 'gkey' });
  });

  it('unknown provider → fallback to UPPERCASED_API_KEY', () => {
    expect(resolveOpenCodeEnv('fireworks/llama-3', 'fkey')).toEqual({ FIREWORKS_API_KEY: 'fkey' });
  });

  it('provider with hyphens → underscores in env var', () => {
    expect(resolveOpenCodeEnv('amazon-bedrock/claude', 'ak')).toEqual({ AWS_ACCESS_KEY_ID: 'ak' });
  });
});

// ═══════════════════════════════════════════════════════
// parseOpenCodeStreamLine
// ═══════════════════════════════════════════════════════

describe('parseOpenCodeStreamLine', () => {
  it('error event with data.message', () => {
    const events = parseOpenCodeStreamLine(OPENCODE_SAMPLES.errorEvent);
    expect(events).toEqual([{ type: 'error', message: 'Your credit balance is too low to make this request.' }]);
  });

  it('error event without data → fallback to error.name', () => {
    const events = parseOpenCodeStreamLine(OPENCODE_SAMPLES.errorMinimal);
    expect(events).toEqual([{ type: 'error', message: 'NetworkError' }]);
  });

  it('text event → text', () => {
    const events = parseOpenCodeStreamLine(OPENCODE_SAMPLES.textEvent);
    expect(events).toEqual([{ type: 'text', content: 'Let me help you analyze this problem.' }]);
  });

  it('text event with empty text → empty array', () => {
    const events = parseOpenCodeStreamLine(OPENCODE_SAMPLES.textEmpty);
    expect(events).toEqual([]);
  });

  it('tool_use completed → [tool_call, tool_result]', () => {
    const events = parseOpenCodeStreamLine(OPENCODE_SAMPLES.toolUseCompleted);
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('tool_call');
    if (events[0].type === 'tool_call') {
      expect(events[0].name).toBe('read');
      expect(JSON.parse(events[0].args)).toEqual({ filePath: '/tmp/test.txt' });
    }
    expect(events[1].type).toBe('tool_result');
    if (events[1].type === 'tool_result') {
      expect(events[1].content).toContain('hello world');
    }
  });

  it('tool_use pending → [tool_call] only', () => {
    const events = parseOpenCodeStreamLine(OPENCODE_SAMPLES.toolUsePending);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('tool_call');
    if (events[0].type === 'tool_call') {
      expect(events[0].name).toBe('bash');
      expect(JSON.parse(events[0].args)).toEqual({ command: 'ls -la' });
    }
  });

  it('tool_use without state → [tool_call] with empty args', () => {
    const events = parseOpenCodeStreamLine(OPENCODE_SAMPLES.toolUseNoState);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('tool_call');
    if (events[0].type === 'tool_call') {
      expect(events[0].name).toBe('write');
      expect(events[0].args).toBe('{}');
    }
  });

  it('step_finish with cost → done event with costUsd', () => {
    const events = parseOpenCodeStreamLine(OPENCODE_SAMPLES.stepFinish);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('done');
    if (events[0].type === 'done') {
      expect(events[0].sessionId).toBe('ses_abc123');
      expect(events[0].costUsd).toBe(0.034347);
    }
  });

  it('step_finish without cost → done with undefined costUsd', () => {
    const events = parseOpenCodeStreamLine(OPENCODE_SAMPLES.stepFinishNoCost);
    expect(events).toHaveLength(1);
    if (events[0].type === 'done') {
      expect(events[0].costUsd).toBeUndefined();
    }
  });

  it('step_finish with reason tool-calls → still done', () => {
    const events = parseOpenCodeStreamLine(OPENCODE_SAMPLES.stepFinishToolCalls);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('done');
    if (events[0].type === 'done') {
      expect(events[0].costUsd).toBe(0.005);
    }
  });

  it('step_start → ignored', () => {
    const events = parseOpenCodeStreamLine(OPENCODE_SAMPLES.stepStart);
    expect(events).toEqual([]);
  });

  it('empty string → empty array', () => {
    expect(parseOpenCodeStreamLine('')).toEqual([]);
  });

  it('whitespace only → empty array', () => {
    expect(parseOpenCodeStreamLine('   \n  ')).toEqual([]);
  });

  it('non-JSON text → empty array', () => {
    expect(parseOpenCodeStreamLine('Loading opencode...')).toEqual([]);
  });

  it('invalid JSON → empty array', () => {
    expect(parseOpenCodeStreamLine('{"broken')).toEqual([]);
  });

  it('JSON without recognized fields → empty array', () => {
    expect(parseOpenCodeStreamLine('{"foo":"bar"}')).toEqual([]);
  });

  it('parses a realistic multi-step OpenCode conversation', () => {
    const lines = [
      OPENCODE_SAMPLES.stepStart,
      OPENCODE_SAMPLES.textEvent,
      OPENCODE_SAMPLES.toolUseCompleted,
      OPENCODE_SAMPLES.stepFinishToolCalls,
      OPENCODE_SAMPLES.stepStart,
      OPENCODE_SAMPLES.textEvent,
      OPENCODE_SAMPLES.stepFinish,
    ];

    const allEvents = lines.flatMap((l) => parseOpenCodeStreamLine(l));

    // step_start(ignored) → text → tool_call + tool_result → done → step_start(ignored) → text → done
    expect(allEvents).toHaveLength(6);
    expect(allEvents[0].type).toBe('text');
    expect(allEvents[1].type).toBe('tool_call');
    expect(allEvents[2].type).toBe('tool_result');
    expect(allEvents[3].type).toBe('done');
    expect(allEvents[4].type).toBe('text');
    expect(allEvents[5].type).toBe('done');

    const finalDone = allEvents[5] as { type: 'done'; costUsd?: number };
    expect(finalDone.costUsd).toBe(0.034347);
  });
});

// ═══════════════════════════════════════════════════════
// injectOpenCodeSkills — symlinks to .opencode/skills/
// ═══════════════════════════════════════════════════════

describe('injectOpenCodeSkills', () => {
  let workspace: string;
  let skillSrc: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'golem-test-oc-inject-'));
    skillSrc = await mkdtemp(join(tmpdir(), 'golem-test-oc-skillsrc-'));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
    await rm(skillSrc, { recursive: true, force: true });
  });

  it('creates .opencode/skills/ with symlinks', async () => {
    const skill1 = join(skillSrc, 'general');
    const skill2 = join(skillSrc, 'devops');
    await mkdir(skill1, { recursive: true });
    await mkdir(skill2, { recursive: true });

    await injectOpenCodeSkills(workspace, [skill1, skill2]);

    const ocSkills = join(workspace, '.opencode', 'skills');
    const entries = await readdir(ocSkills);
    expect(entries.sort()).toEqual(['devops', 'general']);

    const target1 = await readlink(join(ocSkills, 'general'));
    expect(target1).toBe(skill1);
  });

  it('cleans old symlinks before re-injecting', async () => {
    const skillA = join(skillSrc, 'alpha');
    const skillB = join(skillSrc, 'beta');
    await mkdir(skillA, { recursive: true });
    await mkdir(skillB, { recursive: true });

    await injectOpenCodeSkills(workspace, [skillA]);
    let entries = await readdir(join(workspace, '.opencode', 'skills'));
    expect(entries).toEqual(['alpha']);

    await injectOpenCodeSkills(workspace, [skillB]);
    entries = await readdir(join(workspace, '.opencode', 'skills'));
    expect(entries).toEqual(['beta']);
  });

  it('handles empty skill list', async () => {
    await injectOpenCodeSkills(workspace, []);
    const ocSkills = join(workspace, '.opencode', 'skills');
    const entries = await readdir(ocSkills);
    expect(entries).toEqual([]);
  });

  it('does not remove non-symlink entries in .opencode/skills/', async () => {
    const ocSkills = join(workspace, '.opencode', 'skills');
    await mkdir(ocSkills, { recursive: true });
    await mkdir(join(ocSkills, 'user-managed'));
    await writeFile(join(ocSkills, 'user-managed', 'SKILL.md'), '# User');

    const skill1 = join(skillSrc, 'injected');
    await mkdir(skill1, { recursive: true });

    await injectOpenCodeSkills(workspace, [skill1]);

    const entries = (await readdir(ocSkills)).sort();
    expect(entries).toContain('user-managed');
    expect(entries).toContain('injected');
  });
});

// ═══════════════════════════════════════════════════════
// ensureOpenCodeConfig
// ═══════════════════════════════════════════════════════

describe('ensureOpenCodeConfig', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'golem-test-oc-config-'));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it('creates opencode.json with permission allow-all', async () => {
    await ensureOpenCodeConfig(workspace);

    const raw = await readFile(join(workspace, 'opencode.json'), 'utf-8');
    const config = JSON.parse(raw);
    expect(config.permission).toEqual({ '*': 'allow' });
  });

  it('includes model when provided', async () => {
    await ensureOpenCodeConfig(workspace, 'openrouter/anthropic/claude-sonnet-4-5');

    const raw = await readFile(join(workspace, 'opencode.json'), 'utf-8');
    const config = JSON.parse(raw);
    expect(config.model).toBe('openrouter/anthropic/claude-sonnet-4-5');
  });

  it('registers provider block for openrouter model', async () => {
    await ensureOpenCodeConfig(workspace, 'openrouter/anthropic/claude-sonnet-4-5');

    const raw = await readFile(join(workspace, 'opencode.json'), 'utf-8');
    const config = JSON.parse(raw);
    expect(config.provider.openrouter).toEqual({
      options: { apiKey: '{env:OPENROUTER_API_KEY}' },
      models: { 'anthropic/claude-sonnet-4-5': {} },
    });
  });

  it('registers provider block for anthropic model', async () => {
    await ensureOpenCodeConfig(workspace, 'anthropic/claude-sonnet-4-5');

    const raw = await readFile(join(workspace, 'opencode.json'), 'utf-8');
    const config = JSON.parse(raw);
    expect(config.provider.anthropic).toEqual({
      options: { apiKey: '{env:ANTHROPIC_API_KEY}' },
      models: { 'claude-sonnet-4-5': {} },
    });
  });

  it('preserves existing apiKey but still registers missing model entry', async () => {
    await writeFile(
      join(workspace, 'opencode.json'),
      JSON.stringify({ provider: { openrouter: { options: { apiKey: 'hardcoded-key' } } } }),
      'utf-8',
    );

    await ensureOpenCodeConfig(workspace, 'openrouter/anthropic/claude-sonnet-4-5');

    const raw = await readFile(join(workspace, 'opencode.json'), 'utf-8');
    const config = JSON.parse(raw);
    expect(config.provider.openrouter.options.apiKey).toBe('hardcoded-key');
    expect(config.provider.openrouter.models['anthropic/claude-sonnet-4-5']).toEqual({});
  });

  it('preserves existing model-level config when model is already registered', async () => {
    await writeFile(
      join(workspace, 'opencode.json'),
      JSON.stringify({
        provider: {
          openrouter: { models: { 'anthropic/claude-sonnet-4-5': { options: { provider: { order: ['baseten'] } } } } },
        },
      }),
      'utf-8',
    );

    await ensureOpenCodeConfig(workspace, 'openrouter/anthropic/claude-sonnet-4-5');

    const raw = await readFile(join(workspace, 'opencode.json'), 'utf-8');
    const config = JSON.parse(raw);
    expect(config.provider.openrouter.models['anthropic/claude-sonnet-4-5']).toEqual({
      options: { provider: { order: ['baseten'] } },
    });
  });

  it('skips provider registration for unknown provider prefix', async () => {
    await ensureOpenCodeConfig(workspace, 'my-custom-provider/my-model');

    const raw = await readFile(join(workspace, 'opencode.json'), 'utf-8');
    const config = JSON.parse(raw);
    expect(config.provider).toBeUndefined();
  });

  it('preserves existing config fields', async () => {
    await writeFile(
      join(workspace, 'opencode.json'),
      JSON.stringify({ mcp: { 'my-server': { type: 'local' } } }),
      'utf-8',
    );

    await ensureOpenCodeConfig(workspace);

    const raw = await readFile(join(workspace, 'opencode.json'), 'utf-8');
    const config = JSON.parse(raw);
    expect(config.mcp).toEqual({ 'my-server': { type: 'local' } });
    expect(config.permission).toEqual({ '*': 'allow' });
  });

  it('does not overwrite existing permission config', async () => {
    await writeFile(
      join(workspace, 'opencode.json'),
      JSON.stringify({ permission: { '*': 'ask', bash: { '*': 'deny' } } }),
      'utf-8',
    );

    await ensureOpenCodeConfig(workspace);

    const raw = await readFile(join(workspace, 'opencode.json'), 'utf-8');
    const config = JSON.parse(raw);
    expect(config.permission).toEqual({ '*': 'ask', bash: { '*': 'deny' } });
  });

  it('does not overwrite existing model config', async () => {
    await writeFile(
      join(workspace, 'opencode.json'),
      JSON.stringify({ model: { default: 'anthropic/claude-sonnet-4-5' } }),
      'utf-8',
    );

    await ensureOpenCodeConfig(workspace, 'openrouter/other-model');

    const raw = await readFile(join(workspace, 'opencode.json'), 'utf-8');
    const config = JSON.parse(raw);
    expect(config.model).toEqual({ default: 'anthropic/claude-sonnet-4-5' });
  });
});

// ═══════════════════════════════════════════════════════
// Codex stream-json samples
// ═══════════════════════════════════════════════════════

const CODEX_SAMPLES = {
  threadStarted: JSON.stringify({
    type: 'thread.started',
    thread_id: 'thread_abc123',
  }),

  // Primary format: item.text (documented Codex CLI --json output)
  agentMessage: JSON.stringify({
    type: 'item.completed',
    item: {
      type: 'agent_message',
      text: 'Hello! I can help you.',
    },
  }),

  // Fallback format: item.content[] content blocks (OpenAI API-style)
  agentMessageMultiBlock: JSON.stringify({
    type: 'item.completed',
    item: {
      type: 'agent_message',
      content: [
        { type: 'output_text', text: 'First part. ' },
        { type: 'output_text', text: 'Second part.' },
      ],
    },
  }),

  agentMessageEmpty: JSON.stringify({
    type: 'item.completed',
    item: {
      type: 'agent_message',
    },
  }),

  commandExecution: JSON.stringify({
    type: 'item.completed',
    item: {
      type: 'command_execution',
      command: 'ls -la',
      output: 'total 32\ndrwxr-xr-x  8 user user 4096 Jan 1 00:00 .',
    },
  }),

  commandExecutionNoOutput: JSON.stringify({
    type: 'item.completed',
    item: {
      type: 'command_execution',
      command: 'mkdir -p /tmp/test',
    },
  }),

  turnCompleted: JSON.stringify({
    type: 'turn.completed',
    usage: { total_tokens: 42, input_tokens: 20, output_tokens: 22 },
  }),

  turnFailed: JSON.stringify({
    type: 'turn.failed',
    error: { message: 'Rate limit exceeded' },
  }),

  turnFailedNoMessage: JSON.stringify({
    type: 'turn.failed',
    error: {},
  }),

  topLevelError: JSON.stringify({
    type: 'error',
    message: 'Invalid API key',
  }),

  topLevelErrorNoMessage: JSON.stringify({
    type: 'error',
  }),

  unknownItemType: JSON.stringify({
    type: 'item.completed',
    item: { type: 'reasoning', content: 'thinking...' },
  }),
};

// ═══════════════════════════════════════════════════════
// parseCodexStreamLine
// ═══════════════════════════════════════════════════════

describe('parseCodexStreamLine', () => {
  it('thread.started — saves threadId, returns []', () => {
    const state: { threadId?: string } = {};
    const events = parseCodexStreamLine(CODEX_SAMPLES.threadStarted, state);
    expect(events).toEqual([]);
    expect(state.threadId).toBe('thread_abc123');
  });

  it('agent_message — returns text event', () => {
    const state: { threadId?: string } = {};
    const events = parseCodexStreamLine(CODEX_SAMPLES.agentMessage, state);
    expect(events).toEqual([{ type: 'text', content: 'Hello! I can help you.' }]);
  });

  it('agent_message with content array (fallback format) — concatenates text', () => {
    const state: { threadId?: string } = {};
    const events = parseCodexStreamLine(CODEX_SAMPLES.agentMessageMultiBlock, state);
    expect(events).toEqual([{ type: 'text', content: 'First part. Second part.' }]);
  });

  it('agent_message with no text and no content — returns []', () => {
    const state: { threadId?: string } = {};
    const events = parseCodexStreamLine(CODEX_SAMPLES.agentMessageEmpty, state);
    expect(events).toEqual([]);
  });

  it('command_execution — returns tool_call + tool_result', () => {
    const state: { threadId?: string } = {};
    const events = parseCodexStreamLine(CODEX_SAMPLES.commandExecution, state);
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ type: 'tool_call', name: 'ls -la', args: '' });
    expect(events[1]).toEqual({
      type: 'tool_result',
      content: 'total 32\ndrwxr-xr-x  8 user user 4096 Jan 1 00:00 .',
    });
  });

  it('command_execution without output — returns only tool_call', () => {
    const state: { threadId?: string } = {};
    const events = parseCodexStreamLine(CODEX_SAMPLES.commandExecutionNoOutput, state);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: 'tool_call', name: 'mkdir -p /tmp/test', args: '' });
  });

  it('turn.completed — returns done event with threadId from state', () => {
    const state: { threadId?: string } = { threadId: 'thread_abc123' };
    const events = parseCodexStreamLine(CODEX_SAMPLES.turnCompleted, state);
    expect(events).toEqual([{ type: 'done', sessionId: 'thread_abc123' }]);
  });

  it('turn.completed without prior thread.started — done with undefined sessionId', () => {
    const state: { threadId?: string } = {};
    const events = parseCodexStreamLine(CODEX_SAMPLES.turnCompleted, state);
    expect(events).toEqual([{ type: 'done', sessionId: undefined }]);
  });

  it('turn.failed — returns error event', () => {
    const state: { threadId?: string } = {};
    const events = parseCodexStreamLine(CODEX_SAMPLES.turnFailed, state);
    expect(events).toEqual([{ type: 'error', message: 'Rate limit exceeded' }]);
  });

  it('turn.failed without message — returns fallback error', () => {
    const state: { threadId?: string } = {};
    const events = parseCodexStreamLine(CODEX_SAMPLES.turnFailedNoMessage, state);
    expect(events).toEqual([{ type: 'error', message: 'Codex turn failed' }]);
  });

  it('top-level error — returns error event for non-reconnection errors (e.g. auth failure)', () => {
    const state: { threadId?: string } = {};
    const events = parseCodexStreamLine(CODEX_SAMPLES.topLevelError, state);
    expect(events).toEqual([{ type: 'error', message: 'Invalid API key' }]);
  });

  it('top-level error without message — returns fallback error', () => {
    const state: { threadId?: string } = {};
    const events = parseCodexStreamLine(CODEX_SAMPLES.topLevelErrorNoMessage, state);
    expect(events).toEqual([{ type: 'error', message: 'Codex error' }]);
  });

  it('top-level error — suppresses WebSocket reconnection notices (returns [])', () => {
    const state: { threadId?: string } = {};
    const reconnect2 = JSON.stringify({
      type: 'error',
      message: 'Reconnecting... 2/5 (stream disconnected before completion: ...)',
    });
    const reconnect5 = JSON.stringify({
      type: 'error',
      message: 'Reconnecting... 5/5 (failed to send websocket request: Connection closed normally)',
    });
    expect(parseCodexStreamLine(reconnect2, state)).toEqual([]);
    expect(parseCodexStreamLine(reconnect5, state)).toEqual([]);
  });

  it('unknown item type — returns []', () => {
    const state: { threadId?: string } = {};
    const events = parseCodexStreamLine(CODEX_SAMPLES.unknownItemType, state);
    expect(events).toEqual([]);
  });

  it('empty string — returns []', () => {
    expect(parseCodexStreamLine('', {})).toEqual([]);
  });

  it('whitespace only — returns []', () => {
    expect(parseCodexStreamLine('   \n  ', {})).toEqual([]);
  });

  it('non-JSON text — returns []', () => {
    expect(parseCodexStreamLine('Starting codex agent...', {})).toEqual([]);
  });

  it('broken JSON — returns []', () => {
    expect(parseCodexStreamLine('{"broken', {})).toEqual([]);
  });

  it('unknown top-level type — returns []', () => {
    expect(parseCodexStreamLine('{"type":"unknown_event","data":"x"}', {})).toEqual([]);
  });

  it('full session sequence — thread.started → agent_message → turn.completed', () => {
    const lines = [
      CODEX_SAMPLES.threadStarted,
      CODEX_SAMPLES.agentMessage,
      CODEX_SAMPLES.commandExecution,
      CODEX_SAMPLES.turnCompleted,
    ];
    const state: { threadId?: string } = {};
    const allEvents = lines.flatMap((l) => parseCodexStreamLine(l, state));

    expect(state.threadId).toBe('thread_abc123');
    expect(allEvents).toHaveLength(4); // text + tool_call + tool_result + done
    expect(allEvents[0]).toEqual({ type: 'text', content: 'Hello! I can help you.' });
    expect(allEvents[1]).toEqual({ type: 'tool_call', name: 'ls -la', args: '' });
    expect(allEvents[2].type).toBe('tool_result');
    expect(allEvents[3]).toEqual({ type: 'done', sessionId: 'thread_abc123' });
  });
});

// ═══════════════════════════════════════════════════════
// Codex arg building
// ═══════════════════════════════════════════════════════

describe('buildCodexExecArgs', () => {
  it('defaults to unrestricted mode', () => {
    expect(resolveCodexMode({ codex: undefined })).toBe('unrestricted');

    const args = buildCodexExecArgs('fix tests', {
      codex: undefined,
      imagePaths: undefined,
      model: undefined,
      provider: undefined,
      sessionId: undefined,
      workspace: '/tmp/ws',
    });

    expect(args).toEqual([
      'exec',
      '--json',
      '--dangerously-bypass-approvals-and-sandbox',
      '--skip-git-repo-check',
      'fix tests',
    ]);
  });

  it('uses safe mode when configured', () => {
    const args = buildCodexExecArgs('review src', {
      codex: { mode: 'safe' },
      imagePaths: undefined,
      model: 'gpt-5.4',
      provider: undefined,
      sessionId: undefined,
      workspace: '/tmp/ws',
    });

    expect(args).toEqual([
      'exec',
      '--json',
      '--full-auto',
      '--skip-git-repo-check',
      '--model',
      'gpt-5.4',
      'review src',
    ]);
  });

  it('builds resume args with provider overrides', () => {
    const args = buildCodexExecArgs('continue', {
      codex: { mode: 'unrestricted' },
      imagePaths: undefined,
      model: 'gpt-5.4',
      provider: {
        codexProfile: 'm21',
        codexProviderId: 'minimax',
        codexWireApi: 'responses',
      },
      sessionId: 'thread_123',
      workspace: '/tmp/ws',
    });

    expect(args).toEqual([
      'exec',
      'resume',
      '--json',
      '--dangerously-bypass-approvals-and-sandbox',
      '--skip-git-repo-check',
      '--profile',
      'm21',
      '-c',
      'model_provider="minimax"',
      '-c',
      'model_providers.minimax.wire_api="responses"',
      '--model',
      'gpt-5.4',
      'thread_123',
      'continue',
    ]);
  });

  it('uses explicit sandbox and approval config when provided', () => {
    const args = buildCodexExecArgs('inspect repo', {
      codex: {
        mode: 'unrestricted',
        sandbox: 'read-only',
        approval: 'never',
      },
      imagePaths: undefined,
      model: undefined,
      provider: undefined,
      sessionId: undefined,
      workspace: '/tmp/ws',
    });

    expect(args).toEqual([
      '--ask-for-approval',
      'never',
      'exec',
      '--json',
      '--sandbox',
      'read-only',
      '--skip-git-repo-check',
      'inspect repo',
    ]);
  });

  it('defaults the missing explicit execution pair to workspace-write/on-request', () => {
    const args = buildCodexExecArgs('inspect repo', {
      codex: {
        sandbox: 'danger-full-access',
      },
      imagePaths: undefined,
      model: undefined,
      provider: undefined,
      sessionId: undefined,
      workspace: '/tmp/ws',
    });

    expect(args).toEqual([
      '--ask-for-approval',
      'on-request',
      'exec',
      '--json',
      '--sandbox',
      'danger-full-access',
      '--skip-git-repo-check',
      'inspect repo',
    ]);
  });

  it('passes search, image, and add-dir flags', () => {
    const args = buildCodexExecArgs('describe image', {
      codex: {
        search: true,
        addDirs: ['../shared', '/var/tmp/assets'],
      },
      imagePaths: ['/tmp/ws/.golem/images/a.png', '/tmp/ws/.golem/images/b.png'],
      model: undefined,
      provider: undefined,
      sessionId: undefined,
      workspace: '/tmp/ws',
    });

    expect(args).toEqual([
      '--search',
      'exec',
      '--json',
      '--dangerously-bypass-approvals-and-sandbox',
      '--skip-git-repo-check',
      '--add-dir',
      '/tmp/shared',
      '--add-dir',
      '/var/tmp/assets',
      'describe image',
      '--image',
      '/tmp/ws/.golem/images/a.png',
      '--image',
      '/tmp/ws/.golem/images/b.png',
    ]);
  });
});

// ═══════════════════════════════════════════════════════
// injectCodexSkills — symlinks skills to .agents/skills/
// ═══════════════════════════════════════════════════════

describe('injectCodexSkills', () => {
  let workspace: string;
  let skillSrc: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'golem-test-codex-inject-'));
    skillSrc = await mkdtemp(join(tmpdir(), 'golem-test-codex-skillsrc-'));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
    await rm(skillSrc, { recursive: true, force: true });
  });

  it('creates .agents/skills/ with symlinks', async () => {
    const skill1 = join(skillSrc, 'general');
    const skill2 = join(skillSrc, 'devops');
    await mkdir(skill1, { recursive: true });
    await mkdir(skill2, { recursive: true });

    await injectCodexSkills(workspace, [skill1, skill2]);

    const agentsSkills = join(workspace, '.agents', 'skills');
    const entries = await readdir(agentsSkills);
    expect(entries.sort()).toEqual(['devops', 'general']);

    const target1 = await readlink(join(agentsSkills, 'general'));
    expect(target1).toBe(skill1);
  });

  it('cleans old symlinks before re-injecting', async () => {
    const skillA = join(skillSrc, 'alpha');
    const skillB = join(skillSrc, 'beta');
    await mkdir(skillA, { recursive: true });
    await mkdir(skillB, { recursive: true });

    await injectCodexSkills(workspace, [skillA]);
    let entries = await readdir(join(workspace, '.agents', 'skills'));
    expect(entries).toEqual(['alpha']);

    await injectCodexSkills(workspace, [skillB]);
    entries = await readdir(join(workspace, '.agents', 'skills'));
    expect(entries).toEqual(['beta']);
  });

  it('handles empty skill list', async () => {
    await injectCodexSkills(workspace, []);
    const agentsSkills = join(workspace, '.agents', 'skills');
    const entries = await readdir(agentsSkills);
    expect(entries).toEqual([]);
  });

  it('does not remove non-symlink entries in .agents/skills/', async () => {
    const agentsSkills = join(workspace, '.agents', 'skills');
    await mkdir(agentsSkills, { recursive: true });
    await mkdir(join(agentsSkills, 'user-managed'));
    await writeFile(join(agentsSkills, 'user-managed', 'SKILL.md'), '# User');

    const skill1 = join(skillSrc, 'injected');
    await mkdir(skill1, { recursive: true });

    await injectCodexSkills(workspace, [skill1]);

    const entries = (await readdir(agentsSkills)).sort();
    expect(entries).toContain('user-managed');
    expect(entries).toContain('injected');
  });
});

// ═══════════════════════════════════════════════════════
// ensureOpenCodeConfig — MCP translation to OpenCode schema (issue #42)
// ═══════════════════════════════════════════════════════

describe('ensureOpenCodeConfig mcp', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'golem-test-oc-mcp-'));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it('translates mcpConfig into OpenCode local-server schema', async () => {
    await ensureOpenCodeConfig(workspace, undefined, {
      memory: { command: 'npx', args: ['-y', 'mcp-memory'], env: { DIR: '/tmp' } },
    });

    const raw = await readFile(join(workspace, 'opencode.json'), 'utf-8');
    const config = JSON.parse(raw);
    expect(config.mcp).toEqual({
      memory: {
        type: 'local',
        command: ['npx', '-y', 'mcp-memory'],
        enabled: true,
        environment: { DIR: '/tmp' },
      },
    });
  });

  it('omits environment when env is not set', async () => {
    await ensureOpenCodeConfig(workspace, undefined, {
      simple: { command: 'my-server' },
    });

    const config = JSON.parse(await readFile(join(workspace, 'opencode.json'), 'utf-8'));
    expect(config.mcp.simple).toEqual({ type: 'local', command: ['my-server'], enabled: true });
    expect(config.mcp.simple.environment).toBeUndefined();
  });

  it('preserves user-authored valid mcp entries untouched', async () => {
    const userEntry = {
      type: 'local',
      command: ['npx', '-y', 'mcp-oracle-db'],
      enabled: true,
      environment: { ORACLE_URL: 'oracle://localhost' },
    };
    await writeFile(join(workspace, 'opencode.json'), JSON.stringify({ mcp: { 'oracle-db': userEntry } }), 'utf-8');

    await ensureOpenCodeConfig(workspace, undefined, {
      newServer: { command: 'npx', args: ['new-server'] },
    });

    const config = JSON.parse(await readFile(join(workspace, 'opencode.json'), 'utf-8'));
    expect(config.mcp['oracle-db']).toEqual(userEntry);
    expect(config.mcp.newServer).toEqual({ type: 'local', command: ['npx', 'new-server'], enabled: true });
  });

  it('migrates legacy broken entries written by golembot ≤ 0.48.x', async () => {
    // Shape written verbatim from golem.yaml by the old sync code (issue #42)
    await writeFile(
      join(workspace, 'opencode.json'),
      JSON.stringify({
        mcp: {
          memory: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-memory'],
            env: { MEMORY_FILE_PATH: '/tmp/mem.jsonl' },
          },
        },
      }),
      'utf-8',
    );

    // Migration runs even without new mcpConfig being passed
    await ensureOpenCodeConfig(workspace);

    const config = JSON.parse(await readFile(join(workspace, 'opencode.json'), 'utf-8'));
    expect(config.mcp.memory).toEqual({
      type: 'local',
      command: ['npx', '-y', '@modelcontextprotocol/server-memory'],
      enabled: true,
      environment: { MEMORY_FILE_PATH: '/tmp/mem.jsonl' },
    });
  });

  it('does not override existing mcp entry with same name (after migration)', async () => {
    await writeFile(
      join(workspace, 'opencode.json'),
      JSON.stringify({ mcp: { memory: { command: 'custom-cmd' } } }),
      'utf-8',
    );

    await ensureOpenCodeConfig(workspace, undefined, {
      memory: { command: 'npx', args: ['mcp-memory'] },
    });

    const config = JSON.parse(await readFile(join(workspace, 'opencode.json'), 'utf-8'));
    // legacy entry migrated in place, not replaced by the golem.yaml value
    expect(config.mcp.memory).toEqual({ type: 'local', command: ['custom-cmd'], enabled: true });
  });

  it('skips mcp when mcpConfig is undefined', async () => {
    await ensureOpenCodeConfig(workspace);

    const raw = await readFile(join(workspace, 'opencode.json'), 'utf-8');
    const config = JSON.parse(raw);
    expect(config.mcp).toBeUndefined();
  });

  it('skips mcp when mcpConfig is empty', async () => {
    await ensureOpenCodeConfig(workspace, undefined, {});

    const raw = await readFile(join(workspace, 'opencode.json'), 'utf-8');
    const config = JSON.parse(raw);
    expect(config.mcp).toBeUndefined();
  });

  it('does not rewrite opencode.json when nothing changed', async () => {
    await ensureOpenCodeConfig(workspace, undefined, {
      memory: { command: 'npx', args: ['-y', 'mcp-memory'] },
    });
    const stat1 = await stat(join(workspace, 'opencode.json'));

    await new Promise((r) => setTimeout(r, 20));
    await ensureOpenCodeConfig(workspace, undefined, {
      memory: { command: 'npx', args: ['-y', 'mcp-memory'] },
    });
    const stat2 = await stat(join(workspace, 'opencode.json'));

    expect(stat2.mtimeMs).toBe(stat1.mtimeMs);
  });
});

// ═══════════════════════════════════════════════════════
// Grok Build streaming-json samples
// ═══════════════════════════════════════════════════════

const GROK_SAMPLES = {
  textChunk: JSON.stringify({ type: 'text', data: 'Hello from Grok' }),
  textChunkContent: JSON.stringify({ type: 'text', content: 'alt field' }),
  thought: JSON.stringify({ type: 'thought', data: 'reasoning...' }),
  end: JSON.stringify({
    type: 'end',
    stopReason: 'EndTurn',
    sessionId: 'sess-grok-123',
    requestId: 'req-1',
  }),
  error: JSON.stringify({ type: 'error', message: 'auth failed' }),
  errorEmpty: JSON.stringify({ type: 'error' }),
  maxTurns: JSON.stringify({ type: 'max_turns_reached' }),
  toolCall: JSON.stringify({ type: 'tool_call', name: 'read_file', input: { path: 'a.ts' } }),
  toolResult: JSON.stringify({ type: 'tool_result', content: 'file body' }),
  jsonFormat: JSON.stringify({
    text: 'full reply',
    stopReason: 'EndTurn',
    sessionId: 'sess-json-1',
    requestId: 'req-2',
  }),
};

// ═══════════════════════════════════════════════════════
// parseGrokStreamLine
// ═══════════════════════════════════════════════════════

describe('parseGrokStreamLine', () => {
  it('parses text chunks', () => {
    const events = parseGrokStreamLine(GROK_SAMPLES.textChunk, {});
    expect(events).toEqual([{ type: 'text', content: 'Hello from Grok' }]);
  });

  it('accepts content field as text fallback', () => {
    const events = parseGrokStreamLine(GROK_SAMPLES.textChunkContent, {});
    expect(events).toEqual([{ type: 'text', content: 'alt field' }]);
  });

  it('skips thought events', () => {
    expect(parseGrokStreamLine(GROK_SAMPLES.thought, {})).toEqual([]);
  });

  it('parses end as done with sessionId', () => {
    const state: { sessionId?: string } = {};
    const events = parseGrokStreamLine(GROK_SAMPLES.end, state);
    expect(events).toEqual([{ type: 'done', sessionId: 'sess-grok-123' }]);
    expect(state.sessionId).toBe('sess-grok-123');
  });

  it('parses error events', () => {
    expect(parseGrokStreamLine(GROK_SAMPLES.error, {})).toEqual([{ type: 'error', message: 'auth failed' }]);
  });

  it('uses default error message when missing', () => {
    expect(parseGrokStreamLine(GROK_SAMPLES.errorEmpty, {})).toEqual([{ type: 'error', message: 'Grok error' }]);
  });

  it('maps max_turns_reached to warning', () => {
    expect(parseGrokStreamLine(GROK_SAMPLES.maxTurns, {})).toEqual([
      { type: 'warning', message: 'Grok reached max turns limit' },
    ]);
  });

  it('parses optional tool_call / tool_result', () => {
    expect(parseGrokStreamLine(GROK_SAMPLES.toolCall, {})).toEqual([
      { type: 'tool_call', name: 'read_file', args: JSON.stringify({ path: 'a.ts' }) },
    ]);
    expect(parseGrokStreamLine(GROK_SAMPLES.toolResult, {})).toEqual([{ type: 'tool_result', content: 'file body' }]);
  });

  it('parses non-streaming json format object', () => {
    const state: { sessionId?: string } = {};
    const events = parseGrokStreamLine(GROK_SAMPLES.jsonFormat, state);
    expect(events).toEqual([
      { type: 'text', content: 'full reply' },
      { type: 'done', sessionId: 'sess-json-1', fullText: 'full reply' },
    ]);
    expect(state.sessionId).toBe('sess-json-1');
  });

  it('ignores non-json and empty lines', () => {
    expect(parseGrokStreamLine('', {})).toEqual([]);
    expect(parseGrokStreamLine('starting...', {})).toEqual([]);
    expect(parseGrokStreamLine('{"broken', {})).toEqual([]);
  });

  it('end-to-end stream maps to text + done', () => {
    const state: { sessionId?: string } = {};
    const lines = [
      GROK_SAMPLES.textChunk,
      JSON.stringify({ type: 'text', data: '!' }),
      GROK_SAMPLES.thought,
      GROK_SAMPLES.end,
    ];
    const all = lines.flatMap((l) => parseGrokStreamLine(l, state));
    expect(all.filter((e) => e.type === 'text')).toHaveLength(2);
    expect(all.find((e) => e.type === 'done')).toEqual({ type: 'done', sessionId: 'sess-grok-123' });
  });
});

// ═══════════════════════════════════════════════════════
// buildGrokArgs
// ═══════════════════════════════════════════════════════

describe('buildGrokArgs', () => {
  it('builds headless streaming-json args with always-approve by default', () => {
    const args = buildGrokArgs('hello', { workspace: '/tmp/ws' });
    expect(args).toEqual(['-p', 'hello', '--output-format', 'streaming-json', '--cwd', '/tmp/ws', '--always-approve']);
  });

  it('adds resume and model flags', () => {
    const args = buildGrokArgs('continue', {
      workspace: '/tmp/ws',
      sessionId: 'sess-1',
      model: 'grok-4.5',
    });
    expect(args).toContain('--resume');
    expect(args).toContain('sess-1');
    expect(args).toContain('-m');
    expect(args).toContain('grok-4.5');
  });

  it('omits always-approve when skipPermissions is false', () => {
    const args = buildGrokArgs('careful', { workspace: '/tmp/ws', skipPermissions: false });
    expect(args).not.toContain('--always-approve');
  });

  it('appends image path hints into the prompt', () => {
    const args = buildGrokArgs('describe', {
      workspace: '/tmp/ws',
      imagePaths: ['/tmp/a.png', '/tmp/b.png'],
    });
    const prompt = args[1];
    expect(prompt).toContain('/tmp/a.png');
    expect(prompt).toContain('/tmp/b.png');
    expect(prompt).toContain('describe');
  });
});

// ═══════════════════════════════════════════════════════
// injectGrokSkills + writeGrokMcpConfig
// ═══════════════════════════════════════════════════════

describe('injectGrokSkills', () => {
  let workspace: string;
  let skillSrc: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'golem-test-grok-inject-'));
    skillSrc = await mkdtemp(join(tmpdir(), 'golem-test-grok-skillsrc-'));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
    await rm(skillSrc, { recursive: true, force: true });
  });

  it('creates .grok/skills/ with symlinks', async () => {
    const skill1 = join(skillSrc, 'general');
    const skill2 = join(skillSrc, 'im-adapter');
    await mkdir(skill1, { recursive: true });
    await mkdir(skill2, { recursive: true });

    await injectGrokSkills(workspace, [skill1, skill2]);

    const grokSkills = join(workspace, '.grok', 'skills');
    const entries = await readdir(grokSkills);
    expect(entries.sort()).toEqual(['general', 'im-adapter']);

    const target1 = await readlink(join(grokSkills, 'general'));
    expect(target1).toBe(skill1);
  });

  it('cleans old symlinks before re-injecting', async () => {
    const skillA = join(skillSrc, 'alpha');
    const skillB = join(skillSrc, 'beta');
    await mkdir(skillA, { recursive: true });
    await mkdir(skillB, { recursive: true });

    await injectGrokSkills(workspace, [skillA]);
    expect(await readdir(join(workspace, '.grok', 'skills'))).toEqual(['alpha']);

    await injectGrokSkills(workspace, [skillB]);
    expect(await readdir(join(workspace, '.grok', 'skills'))).toEqual(['beta']);
  });
});

describe('writeGrokMcpConfig', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'golem-test-grok-mcp-'));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it('writes mcp servers to .grok/config.toml', async () => {
    await writeGrokMcpConfig(workspace, {
      memory: { command: 'npx', args: ['-y', 'mcp-memory'], env: { DIR: '/tmp' } },
    });

    const raw = await readFile(join(workspace, '.grok', 'config.toml'), 'utf-8');
    expect(raw).toContain('[mcp_servers.memory]');
    expect(raw).toContain('command = "npx"');
    expect(raw).toContain('"-y"');
    expect(raw).toContain('mcp-memory');
    expect(raw).toContain('DIR = "/tmp"');
  });
});
