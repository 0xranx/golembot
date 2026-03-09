import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { StreamEvent, AgentEngine, InvokeOpts } from '../engine.js';

// ── Mock engines ────────────────────────────────────────

function createMockEngine(scenario: 'simple' | 'multi-tool' | 'error' | 'resume-fail'): AgentEngine {
  return {
    async *invoke(prompt: string, opts: InvokeOpts): AsyncIterable<StreamEvent> {
      switch (scenario) {
        case 'simple':
          yield { type: 'text', content: `Reply: ${prompt}` };
          yield { type: 'done', sessionId: 'mock-session-001' };
          break;
        case 'multi-tool':
          yield { type: 'text', content: 'Let me help you look into it...' };
          yield { type: 'tool_call', name: 'ReadToolCall', args: '{"path":"data.csv"}' };
          yield { type: 'text', content: 'Report written to report.md.' };
          yield { type: 'done', sessionId: 'mock-session-002' };
          break;
        case 'error':
          yield { type: 'text', content: 'Processing...' };
          yield { type: 'error', message: 'Agent process crashed unexpectedly' };
          break;
        case 'resume-fail':
          if (opts.sessionId) {
            yield { type: 'error', message: 'Failed to resume session: session expired' };
          } else {
            yield { type: 'text', content: 'New session started' };
            yield { type: 'done', sessionId: 'fresh-session-999' };
          }
          break;
      }
    },
  };
}

vi.mock('../engine.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../engine.js')>();
  return {
    ...original,
    createEngine: vi.fn(() => createMockEngine('simple')),
  };
});

import { createAssistant } from '../index.js';
import { createEngine } from '../engine.js';
import { loadSession } from '../session.js';
import { readFile as fsReadFile } from 'node:fs/promises';

const mockedCreateEngine = vi.mocked(createEngine);

// ── Tests ───────────────────────────────────────────────

describe('createAssistant', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'golem-test-assistant-'));
    await writeFile(join(dir, 'golem.yaml'), 'name: test-bot\nengine: cursor\n');
    await mkdir(join(dir, 'skills', 'general'), { recursive: true });
    await writeFile(
      join(dir, 'skills', 'general', 'SKILL.md'),
      '---\nname: general\ndescription: General assistant\n---\n# General\n',
    );
    mockedCreateEngine.mockReturnValue(createMockEngine('simple'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  // ── basic chat ────────────────────────────────────

  describe('chat', () => {
    it('simple question → text reply', async () => {
      const assistant = createAssistant({ dir });
      const events: StreamEvent[] = [];
      for await (const evt of assistant.chat('Hello')) events.push(evt);
      expect(events).toEqual([
        { type: 'text', content: 'Reply: Hello' },
        { type: 'done', sessionId: 'mock-session-001' },
      ]);
    });

    it('multi-tool scenario', async () => {
      mockedCreateEngine.mockReturnValue(createMockEngine('multi-tool'));
      const assistant = createAssistant({ dir });
      const events: StreamEvent[] = [];
      for await (const evt of assistant.chat('Analyze data')) events.push(evt);
      expect(events.map(e => e.type)).toEqual(['text', 'tool_call', 'text', 'done']);
    });

    it('error scenario', async () => {
      mockedCreateEngine.mockReturnValue(createMockEngine('error'));
      const assistant = createAssistant({ dir });
      const events: StreamEvent[] = [];
      for await (const evt of assistant.chat('task')) events.push(evt);
      expect(events[1]).toEqual({ type: 'error', message: 'Agent process crashed unexpectedly' });
    });
  });

  // ── systemPrompt injection ──────────────────────

  describe('systemPrompt', () => {
    it('systemPrompt in golem.yaml is injected into AGENTS.md as System Instructions section', async () => {
      await writeFile(
        join(dir, 'golem.yaml'),
        'name: test-bot\nengine: cursor\nsystemPrompt: "You are a helpful assistant."\n',
      );
      const assistant = createAssistant({ dir });
      for await (const _ of assistant.chat('Hello')) {}
      const agentsMd = await fsReadFile(join(dir, 'AGENTS.md'), 'utf-8');
      expect(agentsMd).toContain('## System Instructions');
      expect(agentsMd).toContain('You are a helpful assistant.');
    });

    it('systemPrompt in golem.yaml does NOT alter the message passed to the engine', async () => {
      await writeFile(
        join(dir, 'golem.yaml'),
        'name: test-bot\nengine: cursor\nsystemPrompt: "You are a helpful assistant."\n',
      );
      let capturedPrompt = '';
      mockedCreateEngine.mockReturnValue({
        async *invoke(prompt: string): AsyncIterable<StreamEvent> {
          capturedPrompt = prompt;
          yield { type: 'done', sessionId: 'sp-sess' } as StreamEvent;
        },
      });
      const assistant = createAssistant({ dir });
      for await (const _ of assistant.chat('Hello')) {}
      expect(capturedPrompt).toBe('Hello');
    });

    it('without systemPrompt, AGENTS.md has no System Instructions section', async () => {
      const assistant = createAssistant({ dir });
      for await (const _ of assistant.chat('Hello')) {}
      const agentsMd = await fsReadFile(join(dir, 'AGENTS.md'), 'utf-8');
      expect(agentsMd).not.toContain('## System Instructions');
    });

    it('without systemPrompt the message is passed through unchanged', async () => {
      const assistant = createAssistant({ dir });
      const events: StreamEvent[] = [];
      for await (const evt of assistant.chat('Hello')) events.push(evt);
      const textEvt = events.find(e => e.type === 'text') as Extract<StreamEvent, { type: 'text' }>;
      expect(textEvt.content).toBe('Reply: Hello');
    });
  });

  // ── apiKey passthrough ──────────────────────────

  describe('apiKey passthrough', () => {
    it('apiKey from CreateAssistantOpts is forwarded to engine.invoke', async () => {
      let capturedApiKey: string | undefined;
      mockedCreateEngine.mockReturnValue({
        async *invoke(_p: string, opts: InvokeOpts) {
          capturedApiKey = opts.apiKey;
          yield { type: 'done', sessionId: 'sess-key' } as StreamEvent;
        },
      });

      const assistant = createAssistant({ dir, apiKey: 'my-secret-key' });
      for await (const _ of assistant.chat('hello')) {}

      expect(capturedApiKey).toBe('my-secret-key');
    });

    it('no apiKey → engine receives undefined', async () => {
      let capturedApiKey: string | undefined = 'should-be-overwritten';
      mockedCreateEngine.mockReturnValue({
        async *invoke(_p: string, opts: InvokeOpts) {
          capturedApiKey = opts.apiKey;
          yield { type: 'done', sessionId: 'sess-no-key' } as StreamEvent;
        },
      });

      const assistant = createAssistant({ dir });
      for await (const _ of assistant.chat('hello')) {}

      expect(capturedApiKey).toBeUndefined();
    });
  });

  // ── durationMs passthrough ────────────────────────

  describe('durationMs passthrough', () => {
    it('done event with durationMs from engine is yielded to caller', async () => {
      mockedCreateEngine.mockReturnValue({
        async *invoke() {
          yield { type: 'text', content: 'hi' } as StreamEvent;
          yield { type: 'done', sessionId: 'sess-d', durationMs: 12345 } as StreamEvent;
        },
      });

      const assistant = createAssistant({ dir });
      const events: StreamEvent[] = [];
      for await (const evt of assistant.chat('test')) events.push(evt);

      const doneEvt = events.find(e => e.type === 'done');
      expect(doneEvt).toBeDefined();
      expect((doneEvt as { type: 'done'; durationMs?: number }).durationMs).toBe(12345);
    });

    it('done event without durationMs → no durationMs field', async () => {
      mockedCreateEngine.mockReturnValue({
        async *invoke() {
          yield { type: 'done', sessionId: 'sess-nd' } as StreamEvent;
        },
      });

      const assistant = createAssistant({ dir });
      const events: StreamEvent[] = [];
      for await (const evt of assistant.chat('test')) events.push(evt);

      const doneEvt = events.find(e => e.type === 'done');
      expect(doneEvt).toEqual({ type: 'done', sessionId: 'sess-nd' });
    });
  });

  // ── sessionKey routing ────────────────────────────

  describe('sessionKey routing', () => {
    it('different sessionKeys get independent sessions', async () => {
      let callCount = 0;
      mockedCreateEngine.mockReturnValue({
        async *invoke(_p: string, _opts: InvokeOpts) {
          callCount++;
          yield { type: 'done', sessionId: `sess-${callCount}` } as StreamEvent;
        },
      });

      const assistant = createAssistant({ dir });

      for await (const _ of assistant.chat('hi', { sessionKey: 'user:alice' })) {}
      for await (const _ of assistant.chat('hi', { sessionKey: 'user:bob' })) {}

      expect(await loadSession(dir, 'user:alice')).toBe('sess-1');
      expect(await loadSession(dir, 'user:bob')).toBe('sess-2');
      expect(await loadSession(dir)).toBeUndefined(); // default untouched
    });

    it('same sessionKey resumes session', async () => {
      let capturedSessionId: string | undefined;
      mockedCreateEngine.mockReturnValue({
        async *invoke(_p: string, opts: InvokeOpts) {
          capturedSessionId = opts.sessionId;
          yield { type: 'done', sessionId: 'sess-round-2' } as StreamEvent;
        },
      });

      const assistant = createAssistant({ dir });

      // Round 1 with specific key
      const { saveSession } = await import('../session.js');
      await saveSession(dir, 'sess-round-1', 'user:alice');

      for await (const _ of assistant.chat('hello', { sessionKey: 'user:alice' })) {}
      expect(capturedSessionId).toBe('sess-round-1');
      expect(await loadSession(dir, 'user:alice')).toBe('sess-round-2');
    });

    it('resetSession with key only clears that key', async () => {
      const assistant = createAssistant({ dir });
      const { saveSession } = await import('../session.js');

      await saveSession(dir, 'sess-a', 'user:a');
      await saveSession(dir, 'sess-b', 'user:b');

      await assistant.resetSession('user:a');

      expect(await loadSession(dir, 'user:a')).toBeUndefined();
      expect(await loadSession(dir, 'user:b')).toBe('sess-b');
    });

    it('no sessionKey defaults to "default"', async () => {
      const assistant = createAssistant({ dir });
      for await (const _ of assistant.chat('hi')) {}
      expect(await loadSession(dir, 'default')).toBe('mock-session-001');
      expect(await loadSession(dir)).toBe('mock-session-001');
    });
  });

  // ── per-key concurrency ───────────────────────────

  describe('per-key concurrency', () => {
    it('same key: serialized', async () => {
      const order: string[] = [];
      mockedCreateEngine.mockReturnValue({
        async *invoke(prompt: string) {
          order.push(`start:${prompt}`);
          await new Promise(r => setTimeout(r, 30));
          order.push(`end:${prompt}`);
          yield { type: 'done', sessionId: 's' } as StreamEvent;
        },
      });

      const assistant = createAssistant({ dir });
      const p1 = (async () => { for await (const _ of assistant.chat('A', { sessionKey: 'k' })) {} })();
      const p2 = (async () => { for await (const _ of assistant.chat('B', { sessionKey: 'k' })) {} })();
      await Promise.all([p1, p2]);

      expect(order.indexOf('end:A')).toBeLessThan(order.indexOf('start:B'));
    });

    it('different keys: parallel', async () => {
      const order: string[] = [];
      mockedCreateEngine.mockReturnValue({
        async *invoke(prompt: string) {
          order.push(`start:${prompt}`);
          await new Promise(r => setTimeout(r, 30));
          order.push(`end:${prompt}`);
          yield { type: 'done', sessionId: 's' } as StreamEvent;
        },
      });

      const assistant = createAssistant({ dir });
      const p1 = (async () => { for await (const _ of assistant.chat('A', { sessionKey: 'k1' })) {} })();
      const p2 = (async () => { for await (const _ of assistant.chat('B', { sessionKey: 'k2' })) {} })();
      await Promise.all([p1, p2]);

      // Both should start before either ends (parallel)
      expect(order.indexOf('start:A')).toBeLessThan(order.indexOf('end:B'));
      expect(order.indexOf('start:B')).toBeLessThan(order.indexOf('end:A'));
    });
  });

  // ── resume auto-fallback ──────────────────────────

  describe('resume auto-fallback', () => {
    it('resume fails → emits warning, clears session and retries', async () => {
      const assistant = createAssistant({ dir });
      const { saveSession } = await import('../session.js');
      await saveSession(dir, 'expired-session');

      mockedCreateEngine.mockReturnValue(createMockEngine('resume-fail'));

      const events: StreamEvent[] = [];
      for await (const evt of assistant.chat('Resume conversation')) events.push(evt);

      expect(events.some(e => e.type === 'error')).toBe(true);
      expect(events.some(e => e.type === 'warning' && e.message.includes('could not be resumed'))).toBe(true);
      expect(events.some(e => e.type === 'text' && e.content === 'New session started')).toBe(true);
      expect(events.some(e => e.type === 'done' && e.sessionId === 'fresh-session-999')).toBe(true);
    });
  });

  // ── skipPermissions passthrough ──────────────────────

  describe('skipPermissions passthrough', () => {
    it('passes skipPermissions from config to engine', async () => {
      await writeFile(join(dir, 'golem.yaml'), 'name: test-bot\nengine: cursor\nskipPermissions: false\n');

      let capturedSkipPermissions: boolean | undefined;
      mockedCreateEngine.mockReturnValue({
        async *invoke(_p: string, opts: InvokeOpts) {
          capturedSkipPermissions = opts.skipPermissions;
          yield { type: 'done', sessionId: 'sess-sp' } as StreamEvent;
        },
      });

      const assistant = createAssistant({ dir });
      for await (const _ of assistant.chat('hello')) {}

      expect(capturedSkipPermissions).toBe(false);
    });

    it('skipPermissions undefined when not in config', async () => {
      let capturedSkipPermissions: boolean | undefined = true; // sentinel
      mockedCreateEngine.mockReturnValue({
        async *invoke(_p: string, opts: InvokeOpts) {
          capturedSkipPermissions = opts.skipPermissions;
          yield { type: 'done', sessionId: 'sess-sp2' } as StreamEvent;
        },
      });

      const assistant = createAssistant({ dir });
      for await (const _ of assistant.chat('hello')) {}

      expect(capturedSkipPermissions).toBeUndefined();
    });
  });

  // ── rate limiting ─────────────────────────────────

  describe('rate limiting', () => {
    it('rejects immediately when maxConcurrent is 0', async () => {
      const assistant = createAssistant({ dir, maxConcurrent: 0, timeoutMs: 5000 });
      const events: StreamEvent[] = [];
      for await (const evt of assistant.chat('hello')) events.push(evt);
      expect(events[0]).toMatchObject({ type: 'error', message: /too many concurrent/i });
    });

    it('rejects per-session queue when maxQueuePerSession is 0 and session is busy', async () => {
      // Slow engine: holds the session lock for 200ms
      mockedCreateEngine.mockReturnValue({
        async *invoke() {
          await new Promise(r => setTimeout(r, 200));
          yield { type: 'done', sessionId: 'slow' } as StreamEvent;
        },
      });

      const assistant = createAssistant({ dir, maxQueuePerSession: 0, maxConcurrent: 10, timeoutMs: 5000 });

      // Start A (slow) — don't await yet
      const aEvents: StreamEvent[] = [];
      const aPromise = (async () => {
        for await (const evt of assistant.chat('A', { sessionKey: 'k' })) aEvents.push(evt);
      })();

      // Give A a moment to acquire the mutex
      await new Promise(r => setTimeout(r, 20));

      // B should be rejected because queue is full (maxQueuePerSession=0)
      const bEvents: StreamEvent[] = [];
      for await (const evt of assistant.chat('B', { sessionKey: 'k' })) bEvents.push(evt);

      expect(bEvents[0]).toMatchObject({ type: 'error', message: /too many pending/i });

      await aPromise;
      expect(aEvents.some(e => e.type === 'done')).toBe(true);
    });
  });

  // ── timeout ───────────────────────────────────────

  describe('timeout', () => {
    it('aborts engine and yields error when timeoutMs is exceeded', async () => {
      mockedCreateEngine.mockReturnValue({
        async *invoke(_p: string, opts: InvokeOpts): AsyncIterable<StreamEvent> {
          // Hang until abort signal fires
          await new Promise<void>(resolve => {
            if (opts.signal?.aborted) return resolve();
            opts.signal?.addEventListener('abort', () => resolve(), { once: true });
          });
          yield { type: 'error', message: 'Agent invocation timed out' };
        },
      });

      const assistant = createAssistant({ dir, timeoutMs: 50 });
      const events: StreamEvent[] = [];
      for await (const evt of assistant.chat('slow task')) events.push(evt);

      expect(events.some(e => e.type === 'error' && e.message.includes('timed out'))).toBe(true);
    }, 5000);
  });

  // ── conversation history ───────────────────────────

  describe('conversation history', () => {
    it('writes user and assistant entries to per-session history file', async () => {
      mockedCreateEngine.mockReturnValue({
        async *invoke() {
          yield { type: 'text', content: 'world' } as StreamEvent;
          yield { type: 'done', sessionId: 'h-sess', durationMs: 100, costUsd: 0.005 } as StreamEvent;
        },
      });

      const assistant = createAssistant({ dir, timeoutMs: 5000 });
      for await (const _ of assistant.chat('hello', { sessionKey: 'hist-key' })) {}

      const raw = await readFile(join(dir, '.golem', 'history', 'hist-key.jsonl'), 'utf-8');
      const lines = raw.trim().split('\n').map(l => JSON.parse(l));

      expect(lines[0]).toMatchObject({ role: 'user', content: 'hello', sessionKey: 'hist-key' });
      expect(lines[1]).toMatchObject({ role: 'assistant', content: 'world', durationMs: 100, costUsd: 0.005 });
    });
  });

  // ── history recovery on new session ──────────────

  describe('history recovery', () => {
    it('injects history prompt when session is new and history file exists', async () => {
      let capturedPrompt = '';
      mockedCreateEngine.mockReturnValue({
        async *invoke(prompt: string) {
          capturedPrompt = prompt;
          yield { type: 'done', sessionId: 'new-sess' } as StreamEvent;
        },
      });

      // Write a prior history file for this sessionKey
      const { appendHistory } = await import('../session.js');
      await appendHistory(dir, { ts: 'ts', sessionKey: 'user:alice', role: 'user', content: 'old question' });
      await appendHistory(dir, { ts: 'ts', sessionKey: 'user:alice', role: 'assistant', content: 'old answer' });

      // No saved session → new session, history file exists → should inject
      const assistant = createAssistant({ dir, timeoutMs: 5000 });
      for await (const _ of assistant.chat('new question', { sessionKey: 'user:alice' })) {}

      expect(capturedPrompt).toContain('[System: This is a new session');
      expect(capturedPrompt).toContain('user:alice.jsonl');
      expect(capturedPrompt).toContain('new question');
    });

    it('does NOT inject when session already exists', async () => {
      let capturedPrompt = '';
      mockedCreateEngine.mockReturnValue({
        async *invoke(prompt: string) {
          capturedPrompt = prompt;
          yield { type: 'done', sessionId: 'existing-sess' } as StreamEvent;
        },
      });

      // Save a session first so loadSession returns a valid ID
      const { saveSession, appendHistory } = await import('../session.js');
      await saveSession(dir, 'existing-sess', 'user:bob', 'cursor');
      await appendHistory(dir, { ts: 'ts', sessionKey: 'user:bob', role: 'user', content: 'old msg' });

      const assistant = createAssistant({ dir, timeoutMs: 5000 });
      for await (const _ of assistant.chat('follow up', { sessionKey: 'user:bob' })) {}

      expect(capturedPrompt).not.toContain('[System: This is a new session');
      expect(capturedPrompt).toBe('follow up');
    });

    it('does NOT inject when no history file exists', async () => {
      let capturedPrompt = '';
      mockedCreateEngine.mockReturnValue({
        async *invoke(prompt: string) {
          capturedPrompt = prompt;
          yield { type: 'done', sessionId: 'brand-new' } as StreamEvent;
        },
      });

      // No history file, no saved session → truly new user
      const assistant = createAssistant({ dir, timeoutMs: 5000 });
      for await (const _ of assistant.chat('first message', { sessionKey: 'user:charlie' })) {}

      expect(capturedPrompt).not.toContain('[System: This is a new session');
      expect(capturedPrompt).toBe('first message');
    });
  });

  // ── init ──────────────────────────────────────────

  describe('init', () => {
    it('creates assistant from scratch', async () => {
      const freshDir = await mkdtemp(join(tmpdir(), 'golem-test-init-'));
      try {
        const assistant = createAssistant({ dir: freshDir });
        await assistant.init({ engine: 'cursor', name: 'dev-bot' });
        const yaml = await readFile(join(freshDir, 'golem.yaml'), 'utf-8');
        expect(yaml).toContain('dev-bot');
      } finally {
        await rm(freshDir, { recursive: true, force: true });
      }
    });
  });

  // ── Image support ───────────────────────────────────

  describe('image support', () => {
    it('saves images to disk and appends file paths to prompt', async () => {
      // Use a custom engine that captures the prompt
      let capturedPrompt = '';
      let capturedImagePaths: string[] | undefined;
      mockedCreateEngine.mockReturnValue({
        async *invoke(prompt: string, opts: InvokeOpts): AsyncIterable<StreamEvent> {
          capturedPrompt = prompt;
          capturedImagePaths = opts.imagePaths;
          yield { type: 'text', content: 'I see the image' };
          yield { type: 'done', sessionId: 'mock-img-session' };
        },
      });

      const assistant = createAssistant({ dir });
      const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG magic bytes
      const events: StreamEvent[] = [];
      for await (const evt of assistant.chat('What is this?', {
        images: [{ mimeType: 'image/png', data: pngHeader, fileName: 'screenshot.png' }],
      })) {
        events.push(evt);
      }

      expect(events.some(e => e.type === 'text' && e.content === 'I see the image')).toBe(true);
      expect(capturedPrompt).toContain('User attached 1 image(s)');
      expect(capturedPrompt).toContain('.golem/images/screenshot.png');
      expect(capturedImagePaths).toBeDefined();
      expect(capturedImagePaths!.length).toBe(1);
      expect(capturedImagePaths![0]).toContain('screenshot.png');
    });

    it('generates filename from timestamp when fileName is not provided', async () => {
      let capturedPrompt = '';
      mockedCreateEngine.mockReturnValue({
        async *invoke(prompt: string): AsyncIterable<StreamEvent> {
          capturedPrompt = prompt;
          yield { type: 'text', content: 'ok' };
          yield { type: 'done', sessionId: 'x' };
        },
      });

      const assistant = createAssistant({ dir });
      const events: StreamEvent[] = [];
      for await (const evt of assistant.chat('analyze', {
        images: [{ mimeType: 'image/jpeg', data: Buffer.from([0xFF, 0xD8, 0xFF]) }],
      })) {
        events.push(evt);
      }

      expect(capturedPrompt).toContain('User attached 1 image(s)');
      expect(capturedPrompt).toContain('.golem/images/img_');
      expect(capturedPrompt).toContain('.jpg');
    });

    it('handles multiple images', async () => {
      let capturedImagePaths: string[] | undefined;
      mockedCreateEngine.mockReturnValue({
        async *invoke(prompt: string, opts: InvokeOpts): AsyncIterable<StreamEvent> {
          capturedImagePaths = opts.imagePaths;
          yield { type: 'text', content: 'two images' };
          yield { type: 'done', sessionId: 'x' };
        },
      });

      const assistant = createAssistant({ dir });
      for await (const _evt of assistant.chat('compare these', {
        images: [
          { mimeType: 'image/png', data: Buffer.from([0x89, 0x50]) },
          { mimeType: 'image/jpeg', data: Buffer.from([0xFF, 0xD8]) },
        ],
      })) { /* drain */ }

      expect(capturedImagePaths?.length).toBe(2);
    });

    it('no images field → no imagePaths in invoke opts', async () => {
      let capturedImagePaths: string[] | undefined;
      mockedCreateEngine.mockReturnValue({
        async *invoke(prompt: string, opts: InvokeOpts): AsyncIterable<StreamEvent> {
          capturedImagePaths = opts.imagePaths;
          yield { type: 'text', content: 'text only' };
          yield { type: 'done', sessionId: 'x' };
        },
      });

      const assistant = createAssistant({ dir });
      for await (const _evt of assistant.chat('just text')) { /* drain */ }

      expect(capturedImagePaths).toBeUndefined();
    });
  });
});
