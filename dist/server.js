import { createServer as createHttpServer } from 'node:http';
import { executeCommand, parseCommand } from './commands.js';
import { buildDashboardData, recordMessage, renderDashboard } from './dashboard.js';
import { patchConfigFull } from './workspace.js';
function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        req.on('error', reject);
    });
}
function json(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
}
/** Reload all tasks from the store into the scheduler after a CUD operation. */
function refreshScheduler(cronCtx) {
    cronCtx.taskStore
        .listTasks()
        .then((tasks) => {
        cronCtx.scheduler.stop();
        for (const task of tasks) {
            if (task.enabled) {
                cronCtx.scheduler.addTask(task, async () => {
                    await cronCtx.runTask(task.id);
                });
            }
        }
    })
        .catch(() => { });
}
function checkAuth(req, url, token) {
    if (!token)
        return true;
    const auth = req.headers.authorization;
    if (auth === `Bearer ${token}`)
        return true;
    // Support ?token= query param for EventSource (cannot set headers)
    return url.searchParams.get('token') === token;
}
export function createGolemServer(assistant, opts = {}, dashboard, dir, getCronCtx, getAdapters) {
    const token = opts.token || process.env.GOLEM_TOKEN;
    const activeConnections = new Set();
    const server = createHttpServer(async (req, res) => {
        // CORS
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }
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
            }
            else {
                json(res, 200, { hint: 'Use POST /chat to interact', endpoints: ['/chat', '/abort', '/reset', '/health'] });
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
            let body;
            try {
                body = JSON.parse(await readBody(req));
            }
            catch {
                json(res, 400, { error: 'Invalid JSON body' });
                return;
            }
            // Allow image/file-only messages (no text required when attachments are present)
            const hasImages = Array.isArray(body.images) && body.images.length > 0;
            const hasFiles = Array.isArray(body.files) && body.files.length > 0;
            if ((!body.message || typeof body.message !== 'string') && !hasImages && !hasFiles) {
                json(res, 400, { error: 'Missing "message" field' });
                return;
            }
            // Convert base64-encoded images to ImageAttachment[]
            const images = [];
            if (hasImages) {
                for (const img of body.images) {
                    if (!img.data)
                        continue;
                    try {
                        images.push({
                            mimeType: img.mimeType || 'image/png',
                            data: Buffer.from(img.data, 'base64'),
                            fileName: img.fileName,
                        });
                    }
                    catch {
                        /* skip malformed entries */
                    }
                }
            }
            // Convert base64-encoded files to FileAttachment[]
            const files = [];
            if (hasFiles) {
                for (const f of body.files) {
                    if (!f.data || !f.fileName)
                        continue;
                    try {
                        files.push({
                            mimeType: f.mimeType || 'application/octet-stream',
                            data: Buffer.from(f.data, 'base64'),
                            fileName: f.fileName,
                        });
                    }
                    catch {
                        /* skip malformed entries */
                    }
                }
            }
            const chatMessage = body.message || (hasImages ? '(image)' : '(file)');
            // ── Slash command interception ──
            if (dir) {
                const parsed = parseCommand(chatMessage);
                if (parsed) {
                    const cronCtx = getCronCtx?.();
                    const cmdCtx = {
                        dir,
                        sessionKey: body.sessionKey,
                        getStatus: () => assistant.getStatus(),
                        setEngine: (e, c) => assistant.setEngine(e, c),
                        setModel: (m) => assistant.setModel(m),
                        resetSession: (k) => assistant.resetSession(k),
                        cancelSession: (k) => assistant.cancel(k),
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
                Connection: 'keep-alive',
            });
            activeConnections.add(res);
            res.on('close', () => activeConnections.delete(res));
            const chatStartMs = Date.now();
            let replyText = '';
            let costUsd;
            let durationMs;
            try {
                for await (const event of assistant.chat(chatMessage, {
                    sessionKey: body.sessionKey,
                    images: images.length > 0 ? images : undefined,
                    files: files.length > 0 ? files : undefined,
                })) {
                    res.write(`data: ${JSON.stringify(event)}\n\n`);
                    if (event.type === 'text')
                        replyText += event.content;
                    else if (event.type === 'done') {
                        costUsd = event.costUsd;
                        durationMs = event.durationMs;
                    }
                }
            }
            catch (e) {
                const errEvent = { type: 'error', message: e.message };
                res.write(`data: ${JSON.stringify(errEvent)}\n\n`);
            }
            if (dashboard) {
                recordMessage(dashboard.metrics, {
                    ts: new Date().toISOString(),
                    source: 'http',
                    sender: body.sessionKey ?? 'anonymous',
                    messagePreview: chatMessage.slice(0, 120),
                    responsePreview: replyText.slice(0, 120),
                    durationMs: durationMs ?? Date.now() - chatStartMs,
                    costUsd,
                });
            }
            activeConnections.delete(res);
            res.end();
            return;
        }
        // POST /reset
        if (path === '/reset' && req.method === 'POST') {
            let body = {};
            try {
                const raw = await readBody(req);
                if (raw.trim())
                    body = JSON.parse(raw);
            }
            catch {
                json(res, 400, { error: 'Invalid JSON body' });
                return;
            }
            await assistant.resetSession(body.sessionKey);
            json(res, 200, { ok: true });
            return;
        }
        // POST /abort
        if (path === '/abort' && req.method === 'POST') {
            let body = {};
            try {
                const raw = await readBody(req);
                if (raw.trim())
                    body = JSON.parse(raw);
            }
            catch {
                json(res, 400, { error: 'Invalid JSON body' });
                return;
            }
            const aborted = await assistant.cancel(body.sessionKey);
            json(res, 200, { ok: true, aborted });
            return;
        }
        // GET /api/status — dashboard data as JSON
        if (path === '/api/status' && req.method === 'GET') {
            if (dashboard) {
                json(res, 200, await buildDashboardData(dashboard));
            }
            else {
                json(res, 200, { hint: 'Dashboard not available (gateway mode only)' });
            }
            return;
        }
        // ── PATCH /api/config — update golem.yaml ──────────────
        if (path === '/api/config' && req.method === 'PATCH') {
            if (!dir) {
                json(res, 503, { error: 'Config editing not available (no working directory)' });
                return;
            }
            const raw = await readBody(req);
            let patch;
            try {
                patch = JSON.parse(raw);
            }
            catch {
                json(res, 400, { error: 'Invalid JSON body' });
                return;
            }
            if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
                json(res, 400, { error: 'Body must be a JSON object' });
                return;
            }
            try {
                const result = await patchConfigFull(dir, patch);
                // Update in-memory config so dashboard reflects changes immediately
                if (dashboard)
                    dashboard.config = result.config;
                json(res, 200, { ok: true, config: result.config, needsRestart: result.needsRestart });
            }
            catch (e) {
                json(res, 400, { error: e.message });
            }
            return;
        }
        // ── Task REST API ──────────────────────────────────────
        // GET /api/tasks — list all tasks
        if (path === '/api/tasks' && req.method === 'GET') {
            const cronCtx = getCronCtx?.();
            if (!cronCtx) {
                json(res, 503, { error: 'Task scheduler not available' });
                return;
            }
            json(res, 200, await cronCtx.taskStore.listTasks());
            return;
        }
        // POST /api/tasks — create a new task
        if (path === '/api/tasks' && req.method === 'POST') {
            const cronCtx = getCronCtx?.();
            if (!cronCtx) {
                json(res, 503, { error: 'Task scheduler not available' });
                return;
            }
            let body;
            try {
                body = JSON.parse(await readBody(req));
            }
            catch {
                json(res, 400, { error: 'Invalid JSON body' });
                return;
            }
            if (!body.name || !body.schedule || !body.prompt) {
                json(res, 400, { error: 'Missing required fields: name, schedule, prompt' });
                return;
            }
            const task = {
                id: body.id || '',
                name: body.name,
                schedule: body.schedule,
                prompt: body.prompt,
                target: body.target,
                enabled: typeof body.enabled === 'boolean' ? body.enabled : true,
                createdAt: new Date().toISOString(),
                createdBy: 'api',
            };
            await cronCtx.taskStore.addTask(task);
            refreshScheduler(cronCtx);
            json(res, 201, task);
            return;
        }
        // Routes with task ID: /api/tasks/:id
        const taskMatch = path.match(/^\/api\/tasks\/([\w-]+)(?:\/(run))?$/);
        if (taskMatch) {
            const cronCtx = getCronCtx?.();
            if (!cronCtx) {
                json(res, 503, { error: 'Task scheduler not available' });
                return;
            }
            const taskId = taskMatch[1];
            const subAction = taskMatch[2]; // "run" or undefined
            // POST /api/tasks/:id/run — execute immediately
            if (subAction === 'run' && req.method === 'POST') {
                try {
                    const reply = await cronCtx.runTask(taskId);
                    json(res, 200, { ok: true, reply });
                }
                catch (e) {
                    json(res, 404, { error: e.message });
                }
                return;
            }
            // PATCH /api/tasks/:id — update a task
            if (!subAction && req.method === 'PATCH') {
                let body;
                try {
                    body = JSON.parse(await readBody(req));
                }
                catch {
                    json(res, 400, { error: 'Invalid JSON body' });
                    return;
                }
                const ok = await cronCtx.taskStore.updateTask(taskId, body);
                if (!ok) {
                    json(res, 404, { error: `Task not found: ${taskId}` });
                    return;
                }
                refreshScheduler(cronCtx);
                json(res, 200, { ok: true });
                return;
            }
            // DELETE /api/tasks/:id — remove a task
            if (!subAction && req.method === 'DELETE') {
                const ok = await cronCtx.taskStore.removeTask(taskId);
                if (!ok) {
                    json(res, 404, { error: `Task not found: ${taskId}` });
                    return;
                }
                cronCtx.scheduler.removeTask(taskId);
                json(res, 200, { ok: true });
                return;
            }
        }
        // ── Send API ──────────────────────────────────────────
        // POST /api/send — send a proactive message to a channel chat
        if (path === '/api/send' && req.method === 'POST') {
            const adapters = getAdapters?.();
            if (!adapters || adapters.size === 0) {
                json(res, 503, { error: 'No channel adapters available' });
                return;
            }
            let body;
            try {
                body = JSON.parse(await readBody(req));
            }
            catch {
                json(res, 400, { error: 'Invalid JSON body' });
                return;
            }
            if (!body.channel || !body.chatId || !body.text) {
                json(res, 400, { error: 'Missing required fields: channel, chatId, text' });
                return;
            }
            const adapter = adapters.get(body.channel);
            if (!adapter) {
                const available = [...adapters.keys()];
                json(res, 404, { error: `Channel "${body.channel}" not found. Available: ${available.join(', ')}` });
                return;
            }
            if (!adapter.send) {
                json(res, 501, { error: `Channel "${body.channel}" does not support proactive send` });
                return;
            }
            try {
                await adapter.send(body.chatId, body.text);
                json(res, 200, { ok: true });
            }
            catch (e) {
                json(res, 500, { error: `Send failed: ${e.message}` });
            }
            return;
        }
        // GET /api/channels — list available channels (for agent discovery)
        if (path === '/api/channels' && req.method === 'GET') {
            const adapters = getAdapters?.();
            if (!adapters || adapters.size === 0) {
                json(res, 200, { channels: [] });
                return;
            }
            const channels = [...adapters.entries()].map(([name, a]) => ({
                name,
                canSend: typeof a.send === 'function',
            }));
            json(res, 200, { channels });
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
                Connection: 'keep-alive',
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
                setTimeout(() => {
                    opts.onShutdown();
                }, 200);
            }
            else {
                json(res, 404, { error: 'Shutdown not available' });
            }
            return;
        }
        // 404
        json(res, 404, { error: 'Not found' });
    });
    server.forceClose = () => {
        for (const res of activeConnections) {
            try {
                res.write(`data: ${JSON.stringify({ type: 'error', message: 'Server shutting down' })}\n\n`);
                res.end();
            }
            catch {
                /* best effort */
            }
        }
        activeConnections.clear();
        server.close();
    };
    return server;
}
export async function startServer(assistant, opts = {}, dir) {
    const port = opts.port || Number(process.env.GOLEM_PORT) || 3000;
    const hostname = opts.hostname || '127.0.0.1';
    const server = createGolemServer(assistant, opts, undefined, dir);
    return new Promise((resolve) => {
        server.listen(port, hostname, () => {
            const tokenStatus = opts.token || process.env.GOLEM_TOKEN ? 'enabled' : 'disabled (set --token or GOLEM_TOKEN)';
            console.log(`🤖 Golem server listening on http://${hostname}:${port}`);
            console.log(`   POST /chat    — SSE streaming chat`);
            console.log(`   POST /abort   — stop current task`);
            console.log(`   POST /reset   — reset session`);
            console.log(`   GET  /health  — health check`);
            console.log(`   Auth: ${tokenStatus}`);
            resolve();
        });
    });
}
//# sourceMappingURL=server.js.map