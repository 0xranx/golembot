/**
 * Engine output snapshot tests.
 *
 * Each fixture in `fixtures/` contains real (or realistic) NDJSON output from
 * an engine CLI. The tests replay each fixture through the corresponding parser
 * and assert the resulting StreamEvent sequence.
 *
 * When an engine's output format changes upstream, these tests will fail —
 * update the fixture and expected events to match the new format.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseStreamLine } from '../engines/cursor.js';
import { parseClaudeStreamLine } from '../engines/claude-code.js';
import { parseOpenCodeStreamLine } from '../engines/opencode.js';
import { parseCodexStreamLine } from '../engines/codex.js';
import type { StreamEvent } from '../engine.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, 'fixtures');

function loadFixture(name: string): string[] {
  const content = readFileSync(join(FIXTURES, name), 'utf-8');
  return content.split('\n').filter(l => l.trim());
}

// ── Helpers ─────────────────────────────────────────────

function replayCursor(lines: string[]): StreamEvent[] {
  const events: StreamEvent[] = [];
  for (const line of lines) {
    const evt = parseStreamLine(line);
    if (evt) events.push(evt);
  }
  return events;
}

function replayClaude(lines: string[]): StreamEvent[] {
  const events: StreamEvent[] = [];
  for (const line of lines) {
    events.push(...parseClaudeStreamLine(line));
  }
  return events;
}

function replayOpenCode(lines: string[]): StreamEvent[] {
  const events: StreamEvent[] = [];
  for (const line of lines) {
    events.push(...parseOpenCodeStreamLine(line));
  }
  return events;
}

function replayCodex(lines: string[]): StreamEvent[] {
  const events: StreamEvent[] = [];
  const state: { threadId?: string } = {};
  for (const line of lines) {
    events.push(...parseCodexStreamLine(line, state));
  }
  return events;
}

// ── Cursor ──────────────────────────────────────────────

describe('Cursor snapshot: tool call session', () => {
  const events = replayCursor(loadFixture('cursor-tool-call.ndjson'));

  it('produces correct event sequence', () => {
    const types = events.map(e => e.type);
    expect(types).toEqual([
      'tool_call',        // shellToolCall started
      'tool_result',      // shellToolCall completed
      'text',             // assistant reply
      'done',             // result success
    ]);
  });

  it('parses tool_call name correctly', () => {
    const tc = events.find(e => e.type === 'tool_call')!;
    expect(tc.type).toBe('tool_call');
    if (tc.type === 'tool_call') {
      expect(tc.name).toBe('shellToolCall');
    }
  });

  it('extracts text content', () => {
    const text = events.find(e => e.type === 'text')!;
    expect(text.type).toBe('text');
    if (text.type === 'text') {
      expect(text.content).toContain('/Users/test/project');
    }
  });

  it('extracts session ID and duration from done event', () => {
    const done = events.find(e => e.type === 'done')!;
    expect(done.type).toBe('done');
    if (done.type === 'done') {
      expect(done.sessionId).toBe('94ea14d1-cd73-4639-9db5-6037eaf6dd3c');
      expect(done.durationMs).toBe(5373);
    }
  });
});

describe('Cursor snapshot: model error', () => {
  const events = replayCursor(loadFixture('cursor-model-error.ndjson'));

  it('produces no events from non-JSON error message', () => {
    // Cursor prints plain text error to stdout, not JSON — parser returns null
    expect(events).toEqual([]);
  });
});

// ── Claude Code ─────────────────────────────────────────

describe('Claude Code snapshot: tool call session', () => {
  const events = replayClaude(loadFixture('claude-code-tool-call.ndjson'));

  it('produces correct event sequence', () => {
    const types = events.map(e => e.type);
    expect(types).toEqual([
      'text',             // "我来帮你查看当前目录。"
      'tool_call',        // Bash
      'tool_result',      // pwd output
      'text',             // final reply
      'done',             // result success
    ]);
  });

  it('parses Bash tool_call', () => {
    const tc = events.find(e => e.type === 'tool_call')!;
    if (tc.type === 'tool_call') {
      expect(tc.name).toBe('Bash');
    }
  });

  it('extracts cost from done event', () => {
    const done = events.find(e => e.type === 'done')!;
    if (done.type === 'done') {
      expect(done.costUsd).toBe(0.005);
      expect(done.sessionId).toBe('abc123');
    }
  });
});

describe('Claude Code snapshot: multi-tool session', () => {
  const events = replayClaude(loadFixture('claude-code-multi-tool.ndjson'));

  it('produces correct event count', () => {
    const types = events.map(e => e.type);
    // text + Bash tool_call + tool_result + Read tool_call + tool_result + text + done
    expect(types).toEqual([
      'text',             // "我来看看项目结构和配置。"
      'tool_call',        // Bash (ls -la)
      'tool_result',      // ls output
      'tool_call',        // Read (golem.yaml)
      'tool_result',      // file content
      'text',             // final summary
      'done',
    ]);
  });

  it('captures both tool names in order', () => {
    const toolCalls = events.filter(e => e.type === 'tool_call');
    expect(toolCalls).toHaveLength(2);
    if (toolCalls[0].type === 'tool_call') expect(toolCalls[0].name).toBe('Bash');
    if (toolCalls[1].type === 'tool_call') expect(toolCalls[1].name).toBe('Read');
  });

  it('captures cost and duration', () => {
    const done = events.find(e => e.type === 'done')!;
    if (done.type === 'done') {
      expect(done.costUsd).toBe(0.012);
      expect(done.durationMs).toBe(8500);
    }
  });
});

// ── OpenCode ────────────────────────────────────────────

describe('OpenCode snapshot: tool call session', () => {
  const events = replayOpenCode(loadFixture('opencode-tool-call.ndjson'));

  it('produces correct event sequence', () => {
    const types = events.map(e => e.type);
    expect(types).toEqual([
      'text',             // "我来帮你查看当前目录。\n"
      'tool_call',        // read (completed)
      'tool_result',      // golem.yaml content
      'text',             // config explanation
      'tool_call',        // bash (completed)
      'tool_result',      // pwd output
      'text',             // "当前工作目录是 ..."
      'done',             // step_finish with cost
    ]);
  });

  it('parses tool names correctly', () => {
    const toolCalls = events.filter(e => e.type === 'tool_call');
    expect(toolCalls).toHaveLength(2);
    if (toolCalls[0].type === 'tool_call') expect(toolCalls[0].name).toBe('read');
    if (toolCalls[1].type === 'tool_call') expect(toolCalls[1].name).toBe('bash');
  });

  it('extracts cost from step_finish', () => {
    const done = events.find(e => e.type === 'done')!;
    if (done.type === 'done') {
      expect(done.costUsd).toBe(0.003);
    }
  });
});

// ── Codex ───────────────────────────────────────────────

describe('Codex snapshot: tool call session', () => {
  const events = replayCodex(loadFixture('codex-tool-call.ndjson'));

  it('produces correct event sequence', () => {
    const types = events.map(e => e.type);
    expect(types).toEqual([
      'text',             // "Let me check the current directory."
      'tool_call',        // /bin/bash -lc ...
      'tool_result',      // pwd output
      'text',             // "当前目录是..."
      'done',             // turn.completed
    ]);
  });

  it('extracts full command as tool_call name', () => {
    const tc = events.find(e => e.type === 'tool_call')!;
    if (tc.type === 'tool_call') {
      // Codex puts the full command string in the name field
      expect(tc.name).toContain('/bin/bash');
    }
  });

  it('extracts thread ID as session ID in done event', () => {
    const done = events.find(e => e.type === 'done')!;
    if (done.type === 'done') {
      // thread.started sets threadId, turn.completed reads it
      expect(done.sessionId).toBe('thread_abc123');
    }
  });
});
