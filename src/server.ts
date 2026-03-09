import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Server as HttpServer } from 'node:http';
import type { Assistant } from './index.js';
import { parseCommand, executeCommand, type CommandContext } from './commands.js';
import { type DashboardContext, buildDashboardData, renderDashboard, recordMessage } from './dashboard.js';
import type { TaskStore } from './task-store.js';
import type { Scheduler } from './scheduler.js';

export interface CronContext {
  taskStore: TaskStore;
  scheduler: Scheduler;
  runTask: (id: string) => Promise<string>;
}

export interface ServerOpts {
  port?: number;
  token?: string;
  hostname?: string;
  onShutdown?: () => Promise<void> | void;
}

/** http.Server extended with a forceClose() method for clean shutdown. */
export interface GolemServer extends HttpServer {
  /** Close all active SSE connections and stop the server. */
  forceClose(): void;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function checkAuth(req: IncomingMessage, url: URL, token: string | undefined): boolean {
  if (!token) return true;
  const auth = req.headers.authorization;
  if (auth === `Bearer ${token}`) return true;
  // Support ?token= query param for EventSource (cannot set headers)
  return url.searchParams.get('token') === token;
}

export function createGolemServer(assistant: Assistant, opts: ServerOpts = {}, dashboard?: DashboardContext, dir?: string, getCronCtx?: () => CronContext | undefined): GolemServer {
  const token = opts.token || process.env.GOLEM_TOKEN;
  const activeConnections = new Set<ServerResponse>();

  const server = createHttpServer(async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const path = url.pathname;

    // Health (no auth)
    if (path === '/health' && req.method === 'GET') {
      json(res, 200, { status: 'ok', timestamp: new Date().toISOString() });
      return;
    }

    // Dashboard (no auth — landing page)
    if (path === '/' && req.method === 'GET') {
      if (dashboard) {
        const data = await buildDashboardData(dashboard);
        const html = renderDashboard(data);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      } else {
        json(res, 200, { hint: 'Use POST /chat to interact', endpoints: ['/chat', '/reset', '/health'] });
      }
      return;
    }

    // Auth check for everything below
    if (!checkAuth(req, url, token)) {
      json(res, 401, { error: 'Unauthorized' });
      return;
    }

    // POST /chat — SSE streaming
    if (path === '/chat' && req.method === 'POST') {
      let body: { message?: string; sessionKey?: string; images?: Array<{ mimeType?: string; data?: string; fileName?: string }> };
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        json(res, 400, { error: 'Invalid JSON body' });
        return;
      }

      // Allow image-only messages (no text required when images are present)
      const hasImages = Array.isArray(body.images) && body.images.length > 0;
      if ((!body.message || typeof body.message !== 'string') && !hasImages) {
        json(res, 400, { error: 'Missing "message" field' });
        return;
      }

      // Convert base64-encoded images to ImageAttachment[]
      const images: Array<{ mimeType: string; data: Buffer; fileName?: string }> = [];
      if (hasImages) {
        for (const img of body.images!) {
          if (!img.data) continue;
          try {
            images.push({
              mimeType: img.mimeType || 'image/png',
              data: Buffer.from(img.data, 'base64'),
              fileName: img.fileName,
            });
          } catch { /* skip malformed entries */ }
        }
      }

      const chatMessage = body.message || '(image)';

      // ── Slash command interception ──
      if (dir) {
        const parsed = parseCommand(chatMessage);
        if (parsed) {
          const cronCtx = getCronCtx?.();
          const cmdCtx: CommandContext = {
            dir,
            sessionKey: body.sessionKey,
            getStatus: () => assistant.getStatus(),
            setEngine: (e, c) => assistant.setEngine(e, c),
            setModel: (m) => assistant.setModel(m),
            resetSession: (k) => assistant.resetSession(k),
            listModels: () => assistant.listModels(),
            taskStore: cronCtx?.taskStore,
            scheduler: cronCtx?.scheduler,
            runTask: cronCtx?.runTask,
          };
          const result = await executeCommand(parsed, cmdCtx);
          if (result) {
            json(res, 200, { type: 'command', ...result.data, text: result.text });
            return;
          }
        }
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      activeConnections.add(res);
      res.on('close', () => activeConnections.delete(res));

      const chatStartMs = Date.now();
      let replyText = '';
      let costUsd: number | undefined;
      let durationMs: number | undefined;
      try {
        for await (const event of assistant.chat(chatMessage, { sessionKey: body.sessionKey, images: images.length > 0 ? images : undefined })) {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
          if (event.type === 'text') replyText += event.content;
          else if (event.type === 'done') { costUsd = event.costUsd; durationMs = event.durationMs; }
        }
      } catch (e: unknown) {
        const errEvent = { type: 'error', message: (e as Error).message };
        res.write(`data: ${JSON.stringify(errEvent)}\n\n`);
      }

      if (dashboard) {
        recordMessage(dashboard.metrics, {
          ts: new Date().toISOString(),
          source: 'http',
          sender: body.sessionKey ?? 'anonymous',
          messagePreview: chatMessage.slice(0, 120),
          responsePreview: replyText.slice(0, 120),
          durationMs: durationMs ?? (Date.now() - chatStartMs),
          costUsd,
        });
      }

      activeConnections.delete(res);
      res.end();
      return;
    }

    // POST /reset
    if (path === '/reset' && req.method === 'POST') {
      let body: { sessionKey?: string } = {};
      try {
        const raw = await readBody(req);
        if (raw.trim()) body = JSON.parse(raw);
      } catch {
        json(res, 400, { error: 'Invalid JSON body' });
        return;
      }

      await assistant.resetSession(body.sessionKey);
      json(res, 200, { ok: true });
      return;
    }

    // GET /api/status — dashboard data as JSON
    if (path === '/api/status' && req.method === 'GET') {
      if (dashboard) {
        json(res, 200, await buildDashboardData(dashboard));
      } else {
        json(res, 200, { hint: 'Dashboard not available (gateway mode only)' });
      }
      return;
    }

    // GET /api/events — SSE real-time activity stream
    if (path === '/api/events' && req.method === 'GET') {
      if (!dashboard) {
        json(res, 404, { error: 'Events not available (gateway mode only)' });
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.write(': connected\n\n');
      dashboard.metrics.eventSubscribers.add(res);
      activeConnections.add(res);
      res.on('close', () => {
        dashboard.metrics.eventSubscribers.delete(res);
        activeConnections.delete(res);
      });
      return;
    }

    // POST /shutdown — graceful gateway shutdown
    if (path === '/shutdown' && req.method === 'POST') {
      if (opts.onShutdown) {
        json(res, 200, { ok: true });
        // Delay shutdown slightly so the response is sent first
        setTimeout(() => { opts.onShutdown!(); }, 200);
      } else {
        json(res, 404, { error: 'Shutdown not available' });
      }
      return;
    }

    // 404
    json(res, 404, { error: 'Not found' });
  }) as GolemServer;

  server.forceClose = () => {
    for (const res of activeConnections) {
      try {
        res.write(`data: ${JSON.stringify({ type: 'error', message: 'Server shutting down' })}\n\n`);
        res.end();
      } catch { /* best effort */ }
    }
    activeConnections.clear();
    server.close();
  };

  return server;
}

export async function startServer(assistant: Assistant, opts: ServerOpts = {}, dir?: string): Promise<void> {
  const port = opts.port || Number(process.env.GOLEM_PORT) || 3000;
  const hostname = opts.hostname || '127.0.0.1';
  const server = createGolemServer(assistant, opts, undefined, dir);

  return new Promise((resolve) => {
    server.listen(port, hostname, () => {
      const tokenStatus = opts.token || process.env.GOLEM_TOKEN ? 'enabled' : 'disabled (set --token or GOLEM_TOKEN)';
      console.log(`🤖 Golem server listening on http://${hostname}:${port}`);
      console.log(`   POST /chat    — SSE streaming chat`);
      console.log(`   POST /reset   — reset session`);
      console.log(`   GET  /health  — health check`);
      console.log(`   Auth: ${tokenStatus}`);
      resolve();
    });
  });
}
