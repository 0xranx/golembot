import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMetrics, type DashboardContext } from '../dashboard.js';
import type { InvokeOpts, StreamEvent } from '../engine.js';
import { createEngine } from '../engine.js';
import type { GolemServer } from '../server.js';

vi.mock('../engine.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../engine.js')>();
  return {
    ...original,
    createEngine: vi.fn(() => ({
      async *invoke(_p: string, _opts: InvokeOpts): AsyncIterable<StreamEvent> {
        yield { type: 'text', content: 'hello' };
        yield { type: 'done', sessionId: 'srv-sess-1' };
      },
    })),
  };
});

import { createAssistant } from '../index.js';
import { Scheduler } from '../scheduler.js';
import { type CronContext, createGolemServer } from '../server.js';
import { TaskStore } from '../task-store.js';

function installDefaultEngineMock() {
  vi.mocked(createEngine).mockImplementation(() => ({
    async *invoke(_p: string, _opts: InvokeOpts): AsyncIterable<StreamEvent> {
      yield { type: 'text', content: 'hello' };
      yield { type: 'done', sessionId: 'srv-sess-1' };
    },
  }));
}

function request(
  server: http.Server,
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: addr.port,
        path,
        method,
        headers: { 'Content-Type': 'application/json', ...headers },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks).toString() }),
        );
      },
    );
    req.on('error', reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

describe('Golem HTTP Server', () => {
  let dir: string;
  let server: GolemServer;

  beforeEach(async () => {
    installDefaultEngineMock();
    dir = await mkdtemp(join(tmpdir(), 'golem-test-server-'));
    await writeFile(join(dir, 'golem.yaml'), 'name: srv-bot\nengine: cursor\n');
    await mkdir(join(dir, 'skills', 'general'), { recursive: true });
    await writeFile(join(dir, 'skills', 'general', 'SKILL.md'), '---\nname: general\ndescription: g\n---\n');
  });

  afterEach(async () => {
    if (server?.listening) await new Promise<void>((r) => server.close(() => r()));
    await rm(dir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  function startServer(token?: string) {
    const assistant = createAssistant({ dir });
    server = createGolemServer(assistant, { token });
    return new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  }

  describe('GET /health', () => {
    it('returns 200 without auth', async () => {
      await startServer('secret');
      const res = await request(server, 'GET', '/health');
      expect(res.status).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.status).toBe('ok');
    });
  });

  describe('POST /chat', () => {
    it('returns SSE stream', async () => {
      await startServer();
      const res = await request(server, 'POST', '/chat', { message: 'hi' });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('text/event-stream');

      const events = res.body
        .split('\n\n')
        .filter(Boolean)
        .map((line) => {
          const data = line.replace('data: ', '');
          return JSON.parse(data);
        });
      expect(events).toHaveLength(3);
      expect(events[0]).toEqual({ type: 'text', content: 'hello' });
      expect(events[1]).toEqual({ type: 'done', sessionId: 'srv-sess-1' });
      expect(events[2]).toEqual({
        type: 'completion',
        status: 'completed',
        finalText: 'hello',
        sessionId: 'srv-sess-1',
      });
    });

    it('passes sessionKey to assistant', async () => {
      await startServer();
      const res = await request(server, 'POST', '/chat', {
        message: 'hi',
        sessionKey: 'feishu:user_123',
      });
      expect(res.status).toBe(200);
      // Should succeed (sessionKey is forwarded internally)
      expect(res.body).toContain('"type":"text"');
    });

    it('returns 400 for missing message', async () => {
      await startServer();
      const res = await request(server, 'POST', '/chat', {});
      expect(res.status).toBe(400);
      expect(JSON.parse(res.body).error).toContain('message');
    });

    it('returns 400 for invalid JSON', async () => {
      await startServer();
      const addr = server.address() as { port: number };
      const res = await new Promise<{ status: number; body: string }>((resolve, reject) => {
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port: addr.port,
            path: '/chat',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          },
          (r) => {
            const chunks: Buffer[] = [];
            r.on('data', (c: Buffer) => chunks.push(c));
            r.on('end', () => resolve({ status: r.statusCode!, body: Buffer.concat(chunks).toString() }));
          },
        );
        req.on('error', reject);
        req.write('not json');
        req.end();
      });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /reset', () => {
    it('returns 200', async () => {
      await startServer();
      const res = await request(server, 'POST', '/reset', { sessionKey: 'test' });
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body).ok).toBe(true);
    });

    it('works with empty body', async () => {
      await startServer();
      const res = await request(server, 'POST', '/reset', {});
      expect(res.status).toBe(200);
    });
  });

  describe('POST /abort', () => {
    it('returns aborted=false when no task is running', async () => {
      await startServer();
      const res = await request(server, 'POST', '/abort', { sessionKey: 'test' });
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ ok: true, aborted: false });
    });

    it('returns aborted=true and stops an active task', async () => {
      vi.mocked(createEngine).mockReturnValue({
        async *invoke(_p: string, opts: InvokeOpts): AsyncIterable<StreamEvent> {
          await new Promise<void>((resolve) => {
            if (opts.signal?.aborted) return resolve();
            opts.signal?.addEventListener('abort', () => resolve(), { once: true });
          });
          yield {
            type: 'error',
            message: opts.signal?.reason === 'user' ? 'Agent invocation stopped by user' : 'Agent invocation timed out',
          };
        },
      } as any);

      const assistant = createAssistant({ dir, timeoutMs: 5000 });
      server = createGolemServer(assistant, {});
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
      const addr = server.address() as { port: number };

      const received: string[] = [];
      const chatDone = new Promise<void>((resolve) => {
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port: addr.port,
            path: '/chat',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          },
          (res) => {
            res.on('data', (chunk: Buffer) => received.push(chunk.toString()));
            res.on('end', resolve);
          },
        );
        req.write(JSON.stringify({ message: 'slow task', sessionKey: 'abort-me' }));
        req.end();
      });

      await new Promise((r) => setTimeout(r, 30));

      const abortRes = await request(server, 'POST', '/abort', { sessionKey: 'abort-me' });
      expect(abortRes.status).toBe(200);
      expect(JSON.parse(abortRes.body)).toEqual({ ok: true, aborted: true });

      await chatDone;
      const combined = received.join('');
      expect(combined).toContain('"type":"error"');
      expect(combined).toContain('stopped by user');
    }, 5000);
  });

  describe('auth', () => {
    it('rejects /chat without token when token is set', async () => {
      await startServer('my-secret');
      const res = await request(server, 'POST', '/chat', { message: 'hi' });
      expect(res.status).toBe(401);
    });

    it('accepts /chat with correct token', async () => {
      await startServer('my-secret');
      const res = await request(
        server,
        'POST',
        '/chat',
        { message: 'hi' },
        {
          Authorization: 'Bearer my-secret',
        },
      );
      expect(res.status).toBe(200);
    });

    it('rejects /chat with wrong token', async () => {
      await startServer('my-secret');
      const res = await request(
        server,
        'POST',
        '/chat',
        { message: 'hi' },
        {
          Authorization: 'Bearer wrong',
        },
      );
      expect(res.status).toBe(401);
    });

    it('/health does not require auth', async () => {
      await startServer('my-secret');
      const res = await request(server, 'GET', '/health');
      expect(res.status).toBe(200);
    });
  });

  describe('404', () => {
    it('unknown path returns 404', async () => {
      await startServer();
      const res = await request(server, 'GET', '/nonexistent');
      expect(res.status).toBe(404);
    });
  });

  describe('CORS', () => {
    it('OPTIONS returns 204', async () => {
      await startServer();
      const res = await request(server, 'OPTIONS', '/chat');
      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('*');
    });
  });

  describe('forceClose', () => {
    it('closes active SSE connections with shutdown error event', async () => {
      // Use a slow engine so the SSE connection stays open
      vi.mocked(createEngine).mockReturnValue({
        async *invoke(): AsyncIterable<StreamEvent> {
          await new Promise((r) => setTimeout(r, 2000)); // hang
          yield { type: 'done', sessionId: 's' };
        },
      } as any);

      await startServer();
      const addr = server.address() as { port: number };

      // Collect SSE data without waiting for the connection to close
      const received: string[] = [];
      const connectionClosed = new Promise<void>((resolve) => {
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port: addr.port,
            path: '/chat',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          },
          (res) => {
            res.on('data', (chunk: Buffer) => received.push(chunk.toString()));
            res.on('end', resolve);
          },
        );
        req.write(JSON.stringify({ message: 'slow' }));
        req.end();
      });

      // Give the SSE connection time to be established
      await new Promise((r) => setTimeout(r, 50));

      // Force close all connections
      server.forceClose();

      await connectionClosed;

      const combined = received.join('');
      expect(combined).toContain('"type":"error"');
      expect(combined).toContain('shutting down');
    }, 5000);
  });

  describe('rate limiting', () => {
    it('returns error SSE event when global concurrency limit is exceeded', async () => {
      const assistant = createAssistant({ dir, maxConcurrent: 0 });
      server = createGolemServer(assistant, {});
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));

      const res = await request(server, 'POST', '/chat', { message: 'hi' });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('text/event-stream');

      const events = res.body
        .split('\n\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line.replace('data: ', '')));
      const errEvt = events.find((e: { type: string; message?: string }) => e.type === 'error');
      expect(errEvt).toBeDefined();
      expect(errEvt.message).toMatch(/busy/i);
    });

    it('returns error SSE event when per-session queue is full', async () => {
      vi.mocked(createEngine).mockReturnValue({
        async *invoke(): AsyncIterable<StreamEvent> {
          await new Promise((r) => setTimeout(r, 500)); // hold the session mutex
          yield { type: 'done', sessionId: 's' };
        },
      } as any);

      const assistant = createAssistant({ dir, maxQueuePerSession: 0, maxConcurrent: 10, timeoutMs: 5000 });
      server = createGolemServer(assistant, {});
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));

      const addr = server.address() as { port: number };

      // First request holds the session mutex for 500ms
      const firstDone = new Promise<void>((resolve) => {
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port: addr.port,
            path: '/chat',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          },
          (res) => {
            res.resume();
            res.on('end', resolve);
          },
        );
        req.write(JSON.stringify({ message: 'first', sessionKey: 'test-sess' }));
        req.end();
      });

      // Wait long enough for first request to acquire the mutex
      await new Promise((r) => setTimeout(r, 30));

      // Second request for same session key — queue is full (maxQueuePerSession: 0)
      const res = await request(server, 'POST', '/chat', { message: 'second', sessionKey: 'test-sess' });
      const events = res.body
        .split('\n\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line.replace('data: ', '')));
      const errEvt = events.find((e: { type: string; message?: string }) => e.type === 'error');
      expect(errEvt).toBeDefined();
      expect(errEvt.message).toMatch(/pending/i);

      await firstDone;
    }, 5000);
  });

  describe('timeout', () => {
    it('emits error SSE event when engine invocation times out', async () => {
      vi.mocked(createEngine).mockReturnValue({
        async *invoke(_p: string, opts: InvokeOpts): AsyncIterable<StreamEvent> {
          // Hang until the AbortController fires
          await new Promise<void>((resolve) => {
            if (opts.signal?.aborted) return resolve();
            opts.signal?.addEventListener('abort', () => resolve(), { once: true });
          });
          yield { type: 'error', message: 'Agent invocation timed out' };
        },
      } as any);

      const assistant = createAssistant({ dir, timeoutMs: 50 });
      server = createGolemServer(assistant, {});
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));

      const res = await request(server, 'POST', '/chat', { message: 'slow task' });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('text/event-stream');

      const events = res.body
        .split('\n\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line.replace('data: ', '')));
      const errEvt = events.find((e: { type: string; message?: string }) => e.type === 'error');
      expect(errEvt).toBeDefined();
      expect(errEvt.message).toMatch(/timed out/i);
    }, 5000);
  });

  describe('conversation history', () => {
    beforeEach(() => {
      installDefaultEngineMock();
    });

    it('writes history.jsonl after a /chat request', async () => {
      await startServer();
      await request(server, 'POST', '/chat', { message: 'hello world', sessionKey: 'http-hist' });

      const raw = await readFile(join(dir, '.golem', 'history', 'http-hist.jsonl'), 'utf-8');
      const lines = raw
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l));

      expect(lines.find((l: { role: string }) => l.role === 'user')).toMatchObject({
        role: 'user',
        content: 'hello world',
        sessionKey: 'http-hist',
      });
      expect(lines.find((l: { role: string }) => l.role === 'assistant')).toMatchObject({
        role: 'assistant',
        content: 'hello',
      });
    });
  });

  describe('dashboard routes', () => {
    function makeDashboardCtx(): DashboardContext {
      return {
        config: { name: 'test-bot', engine: 'claude-code', channels: {} },
        skills: [{ name: 'general', path: '/skills/general', description: 'General' }],
        channelStatuses: [{ type: 'telegram', status: 'connected' as const }],
        metrics: createMetrics(),
        startTime: Date.now() - 5000,
        version: '1.0.0',
      };
    }

    function startServerWithDashboard(token?: string) {
      const assistant = createAssistant({ dir });
      const ctx = makeDashboardCtx();
      server = createGolemServer(assistant, { token }, ctx);
      return new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    }

    describe('GET /', () => {
      it('returns HTML when dashboard context is provided', async () => {
        await startServerWithDashboard();
        const res = await request(server, 'GET', '/');
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('text/html');
        expect(res.body).toContain('<!DOCTYPE html>');
        expect(res.body).toContain('test-bot');
      });

      it('returns JSON hint when no dashboard context', async () => {
        await startServer();
        const res = await request(server, 'GET', '/');
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.hint).toBeDefined();
      });

      it('does not require auth', async () => {
        await startServerWithDashboard('secret');
        const res = await request(server, 'GET', '/');
        expect(res.status).toBe(200);
        expect(res.body).toContain('<!DOCTYPE html>');
      });
    });

    describe('GET /api/status', () => {
      it('returns dashboard data as JSON', async () => {
        await startServerWithDashboard();
        const res = await request(server, 'GET', '/api/status');
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.name).toBe('test-bot');
        expect(body.engine).toBe('claude-code');
        expect(body.version).toBe('1.0.0');
        expect(body.channels).toHaveLength(1);
      });

      it('requires auth when token is set', async () => {
        await startServerWithDashboard('secret');
        const res = await request(server, 'GET', '/api/status');
        expect(res.status).toBe(401);
      });

      it('accepts auth via Bearer header', async () => {
        await startServerWithDashboard('secret');
        const res = await request(server, 'GET', '/api/status', undefined, { Authorization: 'Bearer secret' });
        expect(res.status).toBe(200);
      });

      it('accepts auth via ?token= query param', async () => {
        await startServerWithDashboard('secret');
        const res = await request(server, 'GET', '/api/status?token=secret');
        expect(res.status).toBe(200);
      });
    });

    describe('GET /api/events', () => {
      it('returns SSE stream', async () => {
        await startServerWithDashboard();
        const addr = server.address() as { port: number };

        const received: string[] = [];
        const connected = new Promise<void>((resolve) => {
          const req = http.request(
            { hostname: '127.0.0.1', port: addr.port, path: '/api/events', method: 'GET' },
            (res) => {
              expect(res.statusCode).toBe(200);
              expect(res.headers['content-type']).toBe('text/event-stream');
              res.on('data', (chunk: Buffer) => {
                received.push(chunk.toString());
                // Close after receiving the connected comment
                req.destroy();
              });
              resolve();
            },
          );
          req.end();
        });

        await connected;
        await new Promise((r) => setTimeout(r, 50));
        expect(received.join('')).toContain(': connected');
      });

      it('returns 404 when no dashboard context', async () => {
        await startServer();
        const res = await request(server, 'GET', '/api/events');
        expect(res.status).toBe(404);
      });
    });
  });

  // ── Slash commands via HTTP POST /chat ──────────────────────────────────
  describe('slash commands via POST /chat', () => {
    function startServerWithDir(token?: string) {
      const assistant = createAssistant({ dir });
      server = createGolemServer(assistant, { token }, undefined, dir);
      return new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    }

    it('/help returns JSON command result', async () => {
      await startServerWithDir();
      const res = await request(server, 'POST', '/chat', { message: '/help' });
      expect(res.status).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.type).toBe('command');
      expect(body.text).toContain('/help');
      expect(body.text).toContain('/cron');
      expect(body.commands).toBeDefined();
    });

    it('/status returns engine info', async () => {
      await startServerWithDir();
      const res = await request(server, 'POST', '/chat', { message: '/status' });
      expect(res.status).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.type).toBe('command');
      expect(body.text).toContain('Engine');
    });

    it('/stop returns JSON command result', async () => {
      await startServerWithDir();
      const res = await request(server, 'POST', '/chat', { message: '/stop', sessionKey: 'http-user' });
      expect(res.status).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.type).toBe('command');
      expect(body.text).toContain('No running task');
      expect(body.stopped).toBe(false);
    });

    it('/cron returns gateway-only hint (standalone server has no task store)', async () => {
      await startServerWithDir();
      const res = await request(server, 'POST', '/chat', { message: '/cron list' });
      expect(res.status).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.type).toBe('command');
      expect(body.text).toContain('gateway mode');
    });

    it('/cron list works with cronCtx but no runTask (coordinator undefined)', async () => {
      const assistant = createAssistant({ dir });
      const taskStore = new TaskStore(dir);
      const scheduler = new Scheduler();
      await taskStore.addTask({
        id: 'http-standalone',
        name: 'standalone-task',
        schedule: '0 6 * * *',
        prompt: 'daily',
        enabled: true,
        createdAt: '2026-01-01T00:00:00Z',
      });
      // No runTask — simulates gateway started without tasks configured (no coordinator)
      server = createGolemServer(assistant, {}, undefined, dir, () => ({ taskStore, scheduler }));
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));

      const res = await request(server, 'POST', '/chat', { message: '/cron list' });
      expect(res.status).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.type).toBe('command');
      expect(body.text).toContain('standalone-task');
    });

    it('/cron run shows Not available with cronCtx but no runTask (coordinator undefined)', async () => {
      const assistant = createAssistant({ dir });
      const taskStore = new TaskStore(dir);
      const scheduler = new Scheduler();
      await taskStore.addTask({
        id: 'http-standalone',
        name: 'standalone-task',
        schedule: '0 6 * * *',
        prompt: 'daily',
        enabled: true,
        createdAt: '2026-01-01T00:00:00Z',
      });
      server = createGolemServer(assistant, {}, undefined, dir, () => ({ taskStore, scheduler }));
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));

      const res = await request(server, 'POST', '/chat', { message: '/cron run http-standalone' });
      expect(res.status).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.type).toBe('command');
      expect(body.text).toContain('Not available');
    });
  });

  // ── Task REST API ──────────────────────────────────────
  describe('Task REST API', () => {
    let taskStore: TaskStore;

    function startServerWithCron(token?: string) {
      const assistant = createAssistant({ dir });
      taskStore = new TaskStore(dir);
      const scheduler = new Scheduler();
      const cronCtx: CronContext = {
        taskStore,
        scheduler,
        runTask: async (id: string) => {
          const task = await taskStore.getTask(id);
          if (!task) throw new Error(`Task not found: ${id}`);
          return `Executed: ${task.name}`;
        },
      };
      server = createGolemServer(assistant, { token }, undefined, dir, () => cronCtx);
      return new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    }

    function startServerWithCronNoRunTask(token?: string) {
      const assistant = createAssistant({ dir });
      taskStore = new TaskStore(dir);
      const scheduler = new Scheduler();
      const cronCtx: CronContext = { taskStore, scheduler };
      server = createGolemServer(assistant, { token }, undefined, dir, () => cronCtx);
      return new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    }

    describe('GET /api/tasks', () => {
      it('returns empty array when no tasks', async () => {
        await startServerWithCron();
        const res = await request(server, 'GET', '/api/tasks');
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toEqual([]);
      });

      it('returns 503 when no cron context', async () => {
        await startServer();
        const res = await request(server, 'GET', '/api/tasks');
        expect(res.status).toBe(503);
      });

      it('lists tasks when cron context has no runTask (coordinator undefined)', async () => {
        await startServerWithCronNoRunTask();
        await taskStore.addTask({
          id: 'no-run',
          name: 'standalone',
          schedule: '0 6 * * *',
          prompt: 'daily',
          enabled: true,
          createdAt: '2026-01-01T00:00:00Z',
        });
        const res = await request(server, 'GET', '/api/tasks');
        expect(res.status).toBe(200);
        const tasks = JSON.parse(res.body);
        expect(tasks).toHaveLength(1);
        expect(tasks[0].name).toBe('standalone');
      });
    });

    describe('POST /api/tasks', () => {
      it('creates a new task', async () => {
        await startServerWithCron();
        const res = await request(server, 'POST', '/api/tasks', {
          name: 'daily-summary',
          schedule: '0 9 * * *',
          prompt: 'Summarize updates',
        });
        expect(res.status).toBe(201);
        const body = JSON.parse(res.body);
        expect(body.name).toBe('daily-summary');
        expect(body.schedule).toBe('0 9 * * *');
        expect(body.createdBy).toBe('api');
        expect(body.id).toBeTruthy();

        // Verify persisted
        const tasks = await taskStore.listTasks();
        expect(tasks).toHaveLength(1);
        expect(tasks[0].name).toBe('daily-summary');
      });

      it('returns 400 for missing required fields', async () => {
        await startServerWithCron();
        const res = await request(server, 'POST', '/api/tasks', { name: 'incomplete' });
        expect(res.status).toBe(400);
        expect(JSON.parse(res.body).error).toContain('required');
      });
    });

    describe('PATCH /api/tasks/:id', () => {
      it('updates an existing task', async () => {
        await startServerWithCron();
        await taskStore.addTask({
          id: 'task-1',
          name: 'old-name',
          schedule: '0 9 * * *',
          prompt: 'old prompt',
          createdAt: new Date().toISOString(),
          enabled: true,
        });

        const res = await request(server, 'PATCH', '/api/tasks/task-1', {
          prompt: 'new prompt',
          enabled: false,
        });
        expect(res.status).toBe(200);

        const updated = await taskStore.getTask('task-1');
        expect(updated!.prompt).toBe('new prompt');
        expect(updated!.enabled).toBe(false);
      });

      it('returns 404 for nonexistent task', async () => {
        await startServerWithCron();
        const res = await request(server, 'PATCH', '/api/tasks/no-such', { prompt: 'x' });
        expect(res.status).toBe(404);
      });
    });

    describe('DELETE /api/tasks/:id', () => {
      it('removes an existing task', async () => {
        await startServerWithCron();
        await taskStore.addTask({
          id: 'task-del',
          name: 'to-delete',
          schedule: '0 9 * * *',
          prompt: 'delete me',
          createdAt: new Date().toISOString(),
          enabled: true,
        });

        const res = await request(server, 'DELETE', '/api/tasks/task-del');
        expect(res.status).toBe(200);

        const tasks = await taskStore.listTasks();
        expect(tasks).toHaveLength(0);
      });

      it('returns 404 for nonexistent task', async () => {
        await startServerWithCron();
        const res = await request(server, 'DELETE', '/api/tasks/no-such');
        expect(res.status).toBe(404);
      });
    });

    describe('POST /api/tasks/:id/run', () => {
      it('executes a task immediately', async () => {
        await startServerWithCron();
        await taskStore.addTask({
          id: 'task-run',
          name: 'run-me',
          schedule: '0 9 * * *',
          prompt: 'do stuff',
          createdAt: new Date().toISOString(),
          enabled: true,
        });

        const res = await request(server, 'POST', '/api/tasks/task-run/run');
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.ok).toBe(true);
        expect(body.reply).toBe('Executed: run-me');
      });

      it('returns 404 for nonexistent task', async () => {
        await startServerWithCron();
        const res = await request(server, 'POST', '/api/tasks/no-such/run');
        expect(res.status).toBe(404);
      });

      it('returns 503 when cron context has no runTask (coordinator undefined)', async () => {
        await startServerWithCronNoRunTask();
        await taskStore.addTask({
          id: 'no-run',
          name: 'standalone',
          schedule: '0 6 * * *',
          prompt: 'daily',
          enabled: true,
          createdAt: '2026-01-01T00:00:00Z',
        });
        const res = await request(server, 'POST', '/api/tasks/no-run/run');
        expect(res.status).toBe(503);
      });
    });
  });

  // ── Send API ──────────────────────────────────────────

  describe('POST /api/send', () => {
    const sentMessages: Array<{ chatId: string; text: string }> = [];

    function startServerWithAdapters() {
      const assistant = createAssistant({ dir });
      const adapters = new Map<string, import('../channel.js').ChannelAdapter>();
      adapters.set('feishu', {
        name: 'feishu',
        maxMessageLength: 4000,
        async start() {},
        async stop() {},
        async reply() {},
        async send(chatId: string, text: string) {
          sentMessages.push({ chatId, text });
        },
      } as any);
      adapters.set('nosend', {
        name: 'nosend',
        maxMessageLength: 4000,
        async start() {},
        async stop() {},
        async reply() {},
        // no send() method
      } as any);
      server = createGolemServer(assistant, {}, undefined, dir, undefined, () => adapters);
      sentMessages.length = 0;
      return new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    }

    it('sends a message successfully', async () => {
      await startServerWithAdapters();
      const res = await request(server, 'POST', '/api/send', {
        channel: 'feishu',
        chatId: 'oc_test123',
        text: 'Hello group!',
      });
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body).ok).toBe(true);
      expect(sentMessages).toEqual([{ chatId: 'oc_test123', text: 'Hello group!' }]);
    });

    it('returns 400 for missing fields', async () => {
      await startServerWithAdapters();
      const res = await request(server, 'POST', '/api/send', { channel: 'feishu' });
      expect(res.status).toBe(400);
      expect(JSON.parse(res.body).error).toContain('Missing required fields');
    });

    it('returns 404 for unknown channel', async () => {
      await startServerWithAdapters();
      const res = await request(server, 'POST', '/api/send', {
        channel: 'whatsapp',
        chatId: 'x',
        text: 'hi',
      });
      expect(res.status).toBe(404);
      expect(JSON.parse(res.body).error).toContain('whatsapp');
      expect(JSON.parse(res.body).error).toContain('feishu');
    });

    it('returns 501 when adapter has no send()', async () => {
      await startServerWithAdapters();
      const res = await request(server, 'POST', '/api/send', {
        channel: 'nosend',
        chatId: 'x',
        text: 'hi',
      });
      expect(res.status).toBe(501);
    });

    it('returns 503 when no adapters available', async () => {
      await startServer();
      const res = await request(server, 'POST', '/api/send', {
        channel: 'feishu',
        chatId: 'x',
        text: 'hi',
      });
      expect(res.status).toBe(503);
    });
  });

  describe('GET /api/channels', () => {
    it('lists available channels with send capability', async () => {
      const assistant = createAssistant({ dir });
      const adapters = new Map<string, import('../channel.js').ChannelAdapter>();
      adapters.set('feishu', { name: 'feishu', send: async () => {} } as any);
      adapters.set('dingtalk', { name: 'dingtalk' } as any);
      server = createGolemServer(assistant, {}, undefined, dir, undefined, () => adapters);
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));

      const res = await request(server, 'GET', '/api/channels');
      expect(res.status).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.channels).toEqual([
        { name: 'feishu', canSend: true },
        { name: 'dingtalk', canSend: false },
      ]);
    });

    it('returns empty array when no adapters', async () => {
      await startServer();
      const res = await request(server, 'GET', '/api/channels');
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body).channels).toEqual([]);
    });
  });

  describe('PATCH /api/config', () => {
    function startServerWithDir(token?: string) {
      const assistant = createAssistant({ dir });
      server = createGolemServer(assistant, { token }, undefined, dir);
      return new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    }

    it('updates config and returns new values', async () => {
      await startServerWithDir();
      const res = await request(server, 'PATCH', '/api/config', { timeout: 600 });
      expect(res.status).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.ok).toBe(true);
      expect(body.config.timeout).toBe(600);
      expect(body.config.name).toBe('srv-bot');
      expect(body.config.engine).toBe('cursor');
    });

    it('returns needsRestart=true when engine is changed', async () => {
      await startServerWithDir();
      const res = await request(server, 'PATCH', '/api/config', { engine: 'opencode' });
      expect(res.status).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.needsRestart).toBe(true);
    });

    it('returns needsRestart=false for hot-reloadable fields', async () => {
      await startServerWithDir();
      const res = await request(server, 'PATCH', '/api/config', { timeout: 300, sessionTtlDays: 7 });
      expect(res.status).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.needsRestart).toBe(false);
    });

    it('returns 401 without auth when token is set', async () => {
      await startServerWithDir('my-secret');
      const res = await request(server, 'PATCH', '/api/config', { timeout: 600 });
      expect(res.status).toBe(401);
    });

    it('returns 400 for invalid JSON', async () => {
      await startServerWithDir();
      const addr = server.address() as { port: number };
      const res = await new Promise<{ status: number; body: string }>((resolve) => {
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port: addr.port,
            path: '/api/config',
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
          },
          (r) => {
            let body = '';
            r.on('data', (d) => {
              body += d;
            });
            r.on('end', () => resolve({ status: r.statusCode!, body }));
          },
        );
        req.write('not-json');
        req.end();
      });
      expect(res.status).toBe(400);
    });
  });
});
