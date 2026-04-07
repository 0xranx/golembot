// ── Fleet Dashboard — multi-bot aggregate view ──────────────────────────────
//
// Each gateway auto-registers itself at ~/.golembot/fleet/<name>-<port>.json.
// The fleet server reads that directory to discover all running bots.
import { spawn } from 'node:child_process';
import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE_CSS, DOCS_BASE, ENGINE_COLORS, esc, FAVICON, formatUptime } from './ui-shared.js';
// ── Constants ────────────────────────────────────────────────────────────────
const DEFAULT_FLEET_DIR = join(homedir(), '.golembot', 'fleet');
// ── Registry I/O ─────────────────────────────────────────────────────────────
function entryFileName(name, port) {
    const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '-');
    return `${safeName}-${port}.json`;
}
export async function registerInstance(entry, fleetDir = DEFAULT_FLEET_DIR) {
    await mkdir(fleetDir, { recursive: true });
    const url = new URL(entry.url);
    const port = Number(url.port) || 3000;
    const filePath = join(fleetDir, entryFileName(entry.name, port));
    await writeFile(filePath, JSON.stringify(entry, null, 2));
}
export async function unregisterInstance(name, port, fleetDir = DEFAULT_FLEET_DIR) {
    const filePath = join(fleetDir, entryFileName(name, port));
    await unlink(filePath).catch((e) => {
        if (e.code !== 'ENOENT')
            throw e;
    });
}
export function isProcessAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
export async function listInstances(fleetDir = DEFAULT_FLEET_DIR) {
    let files;
    try {
        files = await readdir(fleetDir);
    }
    catch {
        return [];
    }
    const instances = [];
    for (const file of files) {
        if (!file.endsWith('.json'))
            continue;
        const filePath = join(fleetDir, file);
        try {
            const raw = await readFile(filePath, 'utf-8');
            const entry = JSON.parse(raw);
            // Skip stopped markers — they're managed by fleet stop/start
            if (entry.stopped === true)
                continue;
            const alive = isProcessAlive(entry.pid);
            if (!alive) {
                // Clean up stale registration
                await unlink(filePath).catch(() => { });
                continue;
            }
            instances.push({ ...entry, alive });
        }
        catch {
            // Malformed JSON — skip
        }
    }
    return instances;
}
export async function fetchInstanceMetrics(instance) {
    if (instance.authEnabled)
        return instance;
    return new Promise((resolve) => {
        const url = new URL('/api/status', instance.url);
        const req = httpRequest(url, { timeout: 2000 }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
                try {
                    const data = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
                    resolve({
                        ...instance,
                        metrics: {
                            totalMessages: data.metrics?.totalMessages ?? 0,
                            totalCostUsd: data.metrics?.totalCostUsd ?? 0,
                            avgDurationMs: data.metrics?.avgDurationMs ?? 0,
                            uptime: data.uptime ?? 0,
                        },
                    });
                }
                catch {
                    resolve(instance);
                }
            });
        });
        req.on('error', () => resolve(instance));
        req.on('timeout', () => {
            req.destroy();
            resolve(instance);
        });
        req.end();
    });
}
// ── Stop / Start ─────────────────────────────────────────────────────────────
export async function stopInstance(instance, fleetDir = DEFAULT_FLEET_DIR) {
    if (!isProcessAlive(instance.pid)) {
        throw new Error(`Bot "${instance.name}" (PID ${instance.pid}) is not running`);
    }
    // Save a stopped marker so the bot can be restarted from fleet
    const url = new URL(instance.url);
    const port = Number(url.port) || 3000;
    const stoppedEntry = {
        name: instance.name,
        url: instance.url,
        pid: instance.pid,
        engine: instance.engine,
        model: instance.model,
        version: instance.version,
        startedAt: instance.startedAt,
        channels: instance.channels,
        authEnabled: instance.authEnabled,
        dir: instance.dir,
        stopped: true,
    };
    const filePath = join(fleetDir, entryFileName(instance.name, port));
    await writeFile(filePath, JSON.stringify(stoppedEntry, null, 2));
    // Send SIGTERM — the gateway's shutdown handler will try to unregister,
    // but we've already written the stopped marker, so even if it deletes
    // the file, we re-write it below after a short delay.
    process.kill(instance.pid, 'SIGTERM');
    // Wait briefly for the process to exit, then ensure the stopped marker persists
    await new Promise((r) => setTimeout(r, 500));
    if (!isProcessAlive(instance.pid)) {
        await writeFile(filePath, JSON.stringify(stoppedEntry, null, 2));
    }
}
export async function startInstance(entry, fleetDir = DEFAULT_FLEET_DIR) {
    // Verify the bot directory still exists
    try {
        await stat(join(entry.dir, 'golem.yaml'));
    }
    catch {
        throw new Error(`Bot directory "${entry.dir}" does not contain golem.yaml`);
    }
    // Resolve the golembot binary — prefer the same installation
    const selfDir = dirname(fileURLToPath(import.meta.url));
    const cliBin = join(selfDir, '..', 'dist', 'cli.js');
    let bin;
    let args;
    try {
        await stat(cliBin);
        bin = process.execPath;
        args = [cliBin, 'gateway'];
    }
    catch {
        bin = 'golembot';
        args = ['gateway'];
    }
    // Restore port from the original URL
    const port = new URL(entry.url).port;
    if (port)
        args.push('-p', port);
    const child = spawn(bin, args, {
        cwd: entry.dir,
        detached: true,
        stdio: 'ignore',
        env: { ...process.env },
    });
    child.unref();
    if (!child.pid)
        throw new Error('Failed to spawn gateway process');
    // Remove the stopped marker — the new gateway will register itself
    const url = new URL(entry.url);
    const p = Number(url.port) || 3000;
    await unlink(join(fleetDir, entryFileName(entry.name, p))).catch(() => { });
    return { pid: child.pid };
}
/** List stopped bots (those stopped via fleet but not restarted) */
export async function listStoppedInstances(fleetDir = DEFAULT_FLEET_DIR) {
    let files;
    try {
        files = await readdir(fleetDir);
    }
    catch {
        return [];
    }
    const stopped = [];
    for (const file of files) {
        if (!file.endsWith('.json'))
            continue;
        try {
            const raw = await readFile(join(fleetDir, file), 'utf-8');
            const entry = JSON.parse(raw);
            if (entry.stopped === true && !isProcessAlive(entry.pid)) {
                stopped.push(entry);
            }
        }
        catch {
            /* skip */
        }
    }
    return stopped;
}
export async function findInstance(nameOrPort, fleetDir = DEFAULT_FLEET_DIR) {
    const instances = await listInstances(fleetDir);
    return instances.find((i) => i.name === nameOrPort || new URL(i.url).port === nameOrPort);
}
export async function findStoppedInstance(nameOrPort, fleetDir = DEFAULT_FLEET_DIR) {
    const stopped = await listStoppedInstances(fleetDir);
    return stopped.find((i) => i.name === nameOrPort || new URL(i.url).port === nameOrPort);
}
// ── Fleet Dashboard HTML ─────────────────────────────────────────────────────
const FLEET_CSS = `${BASE_CSS}

/* Fleet-specific styles */
.bot-card{position:relative;transition:border-color .2s;padding-top:14px}
.bot-card:hover{border-color:var(--accent)}
.bot-name{font-size:16px;font-weight:600;margin-bottom:8px}
.bot-meta{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
.engine-badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;color:#fff}
.model-badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:500;background:var(--border);color:var(--text)}
.stat-row{display:flex;gap:16px;flex-wrap:wrap;margin-top:8px;font-size:13px}
.stat-item{color:var(--dim)}
.stat-item strong{color:var(--text);font-weight:600}
.dot-green{width:8px;height:8px;border-radius:50%;background:var(--green);display:inline-block;margin-right:6px}
.dot-orange{width:8px;height:8px;border-radius:50%;background:var(--orange);display:inline-block;margin-right:6px}
.channels-list{font-size:12px;color:var(--dim);margin-top:6px}
.open-link{display:inline-block;margin-top:10px;font-size:13px;font-weight:500}
.empty-state{text-align:center;padding:48px 16px;color:var(--dim)}
.empty-state h2{font-size:18px;margin-bottom:8px;color:var(--text)}
.empty-state p{font-size:14px;margin-bottom:16px}
.empty-state code{font-size:13px}
.refresh-dot{width:6px;height:6px;border-radius:50%;background:var(--green);display:inline-block;margin-left:6px;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.auth-badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;background:var(--border);color:var(--dim)}
.card-actions{display:flex;align-items:center;gap:12px;margin-top:10px}
.btn-stop,.btn-start{border:none;padding:4px 14px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;transition:opacity .15s}
.btn-stop{background:#ef4444;color:#fff;position:absolute;top:14px;right:14px}
.btn-stop:hover{opacity:.85}
.btn-start{background:var(--green);color:#fff;position:absolute;top:14px;right:14px}
.btn-start:hover{opacity:.85}
.btn-stop:disabled,.btn-start:disabled{opacity:.5;cursor:not-allowed}
.stopped-card{opacity:.65;border-style:dashed}
.dot-red{width:8px;height:8px;border-radius:50%;background:#ef4444;display:inline-block;margin-right:6px}
`;
export function renderFleetDashboard(instances, version, stoppedInstances = []) {
    const allCards = [...instances.map(renderBotCard), ...stoppedInstances.map(renderStoppedCard)];
    const botCards = allCards.length > 0 ? allCards.join('\n') : renderEmptyState();
    return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>GolemBot Fleet</title>
<link rel="icon" href="${FAVICON}">
<style>${FLEET_CSS}</style>
</head><body>
<div class="container">
  ${renderFleetHeader(instances.length, version)}
  <div class="grid" id="fleet-grid">
    ${botCards}
  </div>
  ${renderFleetFooter()}
</div>
<script>${renderFleetScript()}</script>
</body></html>`;
}
function renderFleetHeader(count, version) {
    const plural = count === 1 ? 'bot' : 'bots';
    return `
  <div class="header">
    <h1><span class="product">GolemBot</span> Fleet</h1>
    <span class="badge" style="background:var(--accent)">${count} ${plural}</span>
    <span class="meta">v${esc(version)} <span class="refresh-dot" title="Auto-refreshing every 10s"></span></span>
  </div>
  <p class="subtitle">${count > 0 ? `${count} running ${plural} discovered` : 'No running bots found'}</p>`;
}
function renderBotCard(inst) {
    const engineColor = ENGINE_COLORS[inst.engine] ?? 'var(--dim)';
    const engineName = inst.engine.charAt(0).toUpperCase() + inst.engine.slice(1);
    let statsHtml;
    if (inst.authEnabled) {
        statsHtml = '<span class="auth-badge">Auth Required</span>';
    }
    else if (inst.metrics) {
        const m = inst.metrics;
        statsHtml = `
      <div class="stat-row">
        <span class="stat-item"><strong>${m.totalMessages}</strong> messages</span>
        <span class="stat-item"><strong>$${m.totalCostUsd.toFixed(4)}</strong> cost</span>
        <span class="stat-item"><strong>${m.avgDurationMs > 0 ? `${(m.avgDurationMs / 1000).toFixed(1)}s` : '—'}</strong> avg</span>
      </div>`;
    }
    else {
        statsHtml = '<span class="auth-badge">Unreachable</span>';
    }
    const channelNames = inst.channels
        .filter((c) => c.status === 'connected')
        .map((c) => c.type.charAt(0).toUpperCase() + c.type.slice(1));
    const channelsHtml = channelNames.length > 0 ? `<div class="channels-list">${channelNames.join(', ')}</div>` : '';
    const uptime = formatUptime(Date.now() - new Date(inst.startedAt).getTime());
    return `
    <div class="card bot-card">
      <div class="bot-name"><span class="dot-green"></span>${esc(inst.name)}</div>
      <div class="bot-meta">
        <span class="engine-badge" style="background:${engineColor}">${esc(engineName)}</span>
        ${inst.model ? `<span class="model-badge">${esc(inst.model)}</span>` : ''}
      </div>
      <div class="stat-row">
        <span class="stat-item">Up <strong data-started="${esc(inst.startedAt)}">${uptime}</strong></span>
        <span class="stat-item">PID <strong>${inst.pid}</strong></span>
      </div>
      ${statsHtml}
      ${channelsHtml}
      <a class="open-link" href="${esc(inst.url)}" target="_blank">Open Dashboard &rarr;</a>
      <button class="btn-stop" onclick="fleetAction('stop','${esc(inst.name)}',${new URL(inst.url).port || 3000})">Stop</button>
    </div>`;
}
function renderStoppedCard(entry) {
    const engineColor = ENGINE_COLORS[entry.engine] ?? 'var(--dim)';
    const engineName = entry.engine.charAt(0).toUpperCase() + entry.engine.slice(1);
    const port = new URL(entry.url).port || '3000';
    return `
    <div class="card bot-card stopped-card">
      <div class="bot-name"><span class="dot-red"></span>${esc(entry.name)} <span class="auth-badge">Stopped</span></div>
      <div class="bot-meta">
        <span class="engine-badge" style="background:${engineColor}">${esc(engineName)}</span>
        ${entry.model ? `<span class="model-badge">${esc(entry.model)}</span>` : ''}
      </div>
      <div class="stat-row">
        <span class="stat-item">Port <strong>${esc(port)}</strong></span>
        <span class="stat-item" style="color:var(--dim)">${esc(entry.dir)}</span>
      </div>
      <button class="btn-start" onclick="fleetAction('start','${esc(entry.name)}',${port})">Start</button>
    </div>`;
}
function renderEmptyState() {
    return `
    <div class="empty-state">
      <h2>No running bots found</h2>
      <p>Start a gateway to see it here:</p>
      <code>golembot gateway</code>
    </div>`;
}
function renderFleetFooter() {
    return `
  <p style="text-align:center;margin-top:24px;font-size:12px;color:var(--dim)">
    <a href="${DOCS_BASE}">GolemBot Docs</a>
  </p>`;
}
function renderFleetScript() {
    return `
    var _lastHash = null;
    async function refresh() {
      try {
        const res = await fetch('/api/fleet');
        const data = await res.json();
        if (_lastHash === null) { _lastHash = data._hash; return; }
        if (data._hash !== _lastHash) {
          _lastHash = data._hash;
          location.reload();
        }
      } catch { /* retry next tick */ }
    }
    async function fleetAction(action, name, port) {
      var btn = event.target;
      btn.disabled = true;
      btn.textContent = action === 'stop' ? 'Stopping...' : 'Starting...';
      try {
        var res = await fetch('/api/fleet/' + encodeURIComponent(name) + '/' + action, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ port: port }),
        });
        var data = await res.json();
        if (!data.ok) { alert(data.error || 'Action failed'); btn.disabled = false; btn.textContent = action === 'stop' ? 'Stop' : 'Start'; return; }
        // Force immediate refresh after action
        _lastHash = null;
        setTimeout(function() { location.reload(); }, 1500);
      } catch (e) {
        alert('Request failed: ' + e.message);
        btn.disabled = false;
        btn.textContent = action === 'stop' ? 'Stop' : 'Start';
      }
    }
    // Update uptimes every second
    setInterval(function() {
      document.querySelectorAll('[data-started]').forEach(function(el) {
        var ms = Date.now() - new Date(el.dataset.started).getTime();
        var s = Math.floor(ms / 1000);
        var m = Math.floor(s / 60);
        var h = Math.floor(m / 60);
        var d = Math.floor(h / 24);
        el.textContent = (d > 0 ? d + 'd ' : '') + (h % 24) + 'h ' + (m % 60) + 'm ' + (s % 60) + 's';
      });
    }, 1000);
    setInterval(refresh, 10000);
`;
}
function json(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
}
async function getFleetData(fleetDir) {
    const instances = await listInstances(fleetDir);
    return Promise.all(instances.map(fetchInstanceMetrics));
}
export async function startFleetServer(opts = {}, fleetDir) {
    const port = opts.port ?? 4000;
    const hostname = opts.hostname ?? '127.0.0.1';
    // Read version from package.json
    let version = '0.0.0';
    try {
        const selfDir = dirname(fileURLToPath(import.meta.url));
        const pkg = JSON.parse(await readFile(join(selfDir, '..', 'package.json'), 'utf-8'));
        version = pkg.version ?? version;
    }
    catch {
        /* dev mode */
    }
    const server = createServer(async (req, res) => {
        const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
        const path = url.pathname;
        if (path === '/health' && req.method === 'GET') {
            json(res, 200, { status: 'ok' });
            return;
        }
        if (path === '/api/fleet' && req.method === 'GET') {
            const instances = await getFleetData(fleetDir);
            const stopped = await listStoppedInstances(fleetDir);
            const hash = [
                ...instances.map((i) => `${i.name}:${i.pid}:${i.metrics?.totalMessages ?? 0}`),
                ...stopped.map((s) => `${s.name}:stopped`),
            ].join('|');
            json(res, 200, { instances, stopped, _hash: hash });
            return;
        }
        // POST /api/fleet/:name/stop
        const stopMatch = path.match(/^\/api\/fleet\/([^/]+)\/stop$/);
        if (stopMatch && req.method === 'POST') {
            const name = decodeURIComponent(stopMatch[1]);
            try {
                const inst = await findInstance(name, fleetDir);
                if (!inst) {
                    json(res, 404, { ok: false, error: `Bot "${name}" not found` });
                    return;
                }
                await stopInstance(inst, fleetDir);
                json(res, 200, { ok: true, name: inst.name, pid: inst.pid });
            }
            catch (e) {
                json(res, 400, { ok: false, error: e.message });
            }
            return;
        }
        // POST /api/fleet/:name/start
        const startMatch = path.match(/^\/api\/fleet\/([^/]+)\/start$/);
        if (startMatch && req.method === 'POST') {
            const name = decodeURIComponent(startMatch[1]);
            try {
                const entry = await findStoppedInstance(name, fleetDir);
                if (!entry) {
                    json(res, 404, { ok: false, error: `Stopped bot "${name}" not found` });
                    return;
                }
                const result = await startInstance(entry, fleetDir);
                json(res, 200, { ok: true, name: entry.name, pid: result.pid });
            }
            catch (e) {
                json(res, 400, { ok: false, error: e.message });
            }
            return;
        }
        if (path === '/' && req.method === 'GET') {
            const instances = await getFleetData(fleetDir);
            const stopped = await listStoppedInstances(fleetDir);
            const html = renderFleetDashboard(instances, version, stopped);
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(html);
            return;
        }
        json(res, 404, { error: 'Not found' });
    });
    return new Promise((resolve) => {
        server.listen(port, hostname, () => {
            console.log(`\n  \x1b[1mGolemBot Fleet Dashboard\x1b[0m`);
            console.log(`  \x1b[36m➜\x1b[0m  http://${hostname}:${port}/`);
            console.log(`  \x1b[2mAuto-discovers bots from ~/.golembot/fleet/\x1b[0m\n`);
            resolve();
        });
        const shutdown = () => {
            server.close();
            process.exit(0);
        };
        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);
    });
}
//# sourceMappingURL=fleet.js.map