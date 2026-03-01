/**
 * GolemBot E2E — Cursor engine headless deployment verification
 *
 * Simulates: On cloud servers (Alibaba ECS / AWS EC2 etc),
 * no Cursor IDE, no `agent login`, fully API Key auth,
 * exposing AI capabilities as HTTP service.
 *
 * This is GolemBot's typical production deployment:
 *   CURSOR_API_KEY=xxx GOLEM_TOKEN=secret golembot serve --port 3000
 *
 * Prerequisites:
 *   - CURSOR_API_KEY configured (.env or env var, skip if missing)
 *   - ~/.local/bin/agent available (Cursor Agent CLI installed)
 *
 * Run:
 *   pnpm run e2e:headless          # auto-load CURSOR_API_KEY from .env
 *   CURSOR_API_KEY=xxx pnpm run e2e:headless  # or specify manually
 *
 * Note: Claude Code engine has dedicated e2e → pnpm run e2e:claude-code
 */

import { readFileSync } from 'node:fs';
import { createAssistant, createGolemServer } from '../dist/index.js';
import { mkdtemp, rm, readdir, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { join, resolve as resolvePath } from 'node:path';
import { tmpdir } from 'node:os';
import http from 'node:http';
import type { StreamEvent } from '../dist/index.js';

// ── .env auto-load (does not overwrite existing env vars) ──────────────────
try {
  const envPath = resolvePath(new URL('.', import.meta.url).pathname, '..', '.env');
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (val && !process.env[key]) process.env[key] = val;
  }
} catch { /* .env not found, rely on env vars */ }

// ── Helpers ─────────────────────────────────────────────

const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const MAGENTA = '\x1b[35m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

let stepNum = 0;
function step(title: string) {
  stepNum++;
  console.log(`\n${CYAN}${BOLD}═══ Step ${stepNum}: ${title} ═══${RESET}\n`);
}

function ok(msg: string) { console.log(`${GREEN}  ✓ ${msg}${RESET}`); }
function fail(msg: string) { console.log(`${RED}  ✗ ${msg}${RESET}`); }
function info(msg: string) { console.log(`${DIM}  ${msg}${RESET}`); }

const results: { step: string; passed: boolean }[] = [];
function record(name: string, passed: boolean) {
  results.push({ step: name, passed });
  if (passed) ok(name); else fail(name);
}

async function fileExists(p: string): Promise<boolean> {
  return stat(p).then(() => true).catch(() => false);
}

function httpRequest(
  port: number,
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; raw: string }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const req = http.request(
      { hostname: '127.0.0.1', port, path, method, headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode!,
            headers: res.headers,
            raw: Buffer.concat(chunks).toString(),
          });
        });
      },
    );
    req.on('error', reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

function parseSSE(raw: string): { events: StreamEvent[]; fullText: string; durationMs?: number } {
  const events: StreamEvent[] = [];
  let fullText = '';
  let durationMs: number | undefined;
  for (const chunk of raw.split('\n\n')) {
    if (!chunk.startsWith('data: ')) continue;
    try {
      const evt: StreamEvent = JSON.parse(chunk.slice(6));
      events.push(evt);
      if (evt.type === 'text') fullText += evt.content;
      if (evt.type === 'done') durationMs = evt.durationMs;
    } catch { /* skip */ }
  }
  return { events, fullText, durationMs };
}

async function httpChat(
  port: number,
  message: string,
  opts: { sessionKey?: string; token?: string } = {},
): Promise<{ events: StreamEvent[]; fullText: string; durationMs?: number; status: number }> {
  const res = await httpRequest(port, 'POST', '/chat', { message, sessionKey: opts.sessionKey }, opts.token);
  const parsed = parseSSE(res.raw);
  return { ...parsed, status: res.status };
}

// ── Skill Fixtures ──────────────────────────────────────

const DEVOPS_SKILL = `---
name: devops-assistant
description: DevOps assistant — analyzes logs, monitoring data, executes ops tasks
---

# DevOps Assistant

You are a DevOps assistant deployed on cloud servers, receiving requests via HTTP API from monitoring systems and ops staff.

## Capabilities

1. Analyze application logs, identify error patterns
2. Read CSV/JSON monitoring data, produce analysis reports
3. Execute file operations per natural language instructions

## Conventions

- Replies should be concise and professional, suitable for webhook responses
- Analysis conclusions must be backed by concrete data
- When saving reports, write to current directory
`;

const MONITOR_CSV = `timestamp,service,cpu_pct,memory_mb,error_count,latency_ms
2025-01-01T00:00:00Z,api-gateway,45,1024,0,23
2025-01-01T00:05:00Z,api-gateway,78,1280,3,156
2025-01-01T00:10:00Z,api-gateway,92,1536,12,890
2025-01-01T00:15:00Z,api-gateway,85,1400,5,340
2025-01-01T00:00:00Z,user-service,30,512,0,15
2025-01-01T00:05:00Z,user-service,35,520,1,18
2025-01-01T00:10:00Z,user-service,40,530,0,20
2025-01-01T00:15:00Z,user-service,32,515,0,16
2025-01-01T00:00:00Z,order-service,55,768,0,45
2025-01-01T00:05:00Z,order-service,60,790,2,67
2025-01-01T00:10:00Z,order-service,65,810,1,55
2025-01-01T00:15:00Z,order-service,58,780,0,48`;

const APP_LOG = `[2025-01-01T00:05:12Z] ERROR api-gateway - Connection refused to upstream user-service:8080
[2025-01-01T00:05:13Z] ERROR api-gateway - Timeout after 5000ms on POST /api/orders
[2025-01-01T00:05:14Z] WARN  api-gateway - Circuit breaker triggered for user-service
[2025-01-01T00:10:01Z] ERROR api-gateway - OOM: heap usage 1.5GB exceeds limit 1.2GB
[2025-01-01T00:10:02Z] ERROR api-gateway - Worker process crashed, restarting...
[2025-01-01T00:10:05Z] ERROR api-gateway - 12 requests failed during restart
[2025-01-01T00:10:30Z] INFO  api-gateway - Worker process recovered
[2025-01-01T00:15:00Z] WARN  api-gateway - Memory usage 1.4GB approaching limit
[2025-01-01T00:05:15Z] ERROR order-service - Failed to process order #12345: inventory lock timeout
[2025-01-01T00:05:16Z] ERROR order-service - Failed to process order #12346: inventory lock timeout`;

// ── Main ────────────────────────────────────────────────

async function main() {
  const apiKey = process.env.CURSOR_API_KEY;

  if (!apiKey) {
    console.log(`\n${YELLOW}${BOLD}⚠ Skipping headless E2E test${RESET}`);
    console.log(`${DIM}  CURSOR_API_KEY not detected.`);
    console.log(`  To run in headless env (cloud server/CI):`);
    console.log(`    CURSOR_API_KEY=your-key pnpm run e2e:headless${RESET}\n`);
    process.exit(0);
  }

  console.log(`${CYAN}${BOLD}`);
  console.log(`╔══════════════════════════════════════════════════════════════╗`);
  console.log(`║  GolemBot E2E — Headless deployment verification               ║`);
  console.log(`║  Simulate: GolemBot deployed via API Key on cloud server       ║`);
  console.log(`╚══════════════════════════════════════════════════════════════╝${RESET}`);

  info(`CURSOR_API_KEY: ${apiKey.slice(0, 8)}...(hidden)`);

  const workDir = await mkdtemp(join(tmpdir(), 'golem-headless-'));
  info(`Work dir: ${workDir}`);

  let server: http.Server | undefined;
  const SERVER_TOKEN = 'headless-test-token-' + Date.now();
  let port = 0;

  try {

    // ╔═══════════════════════════════════════════════════════╗
    // ║  PART 1: Init — simulate first deploy after ssh       ║
    // ╚═══════════════════════════════════════════════════════╝

    console.log(`\n${MAGENTA}${BOLD}  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
    console.log(`${MAGENTA}${BOLD}  PART 1: Init deployment — apiKey auth + Skill config${RESET}`);
    console.log(`${MAGENTA}${BOLD}  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);

    step('Init — deploy GolemBot with createAssistant({ apiKey })');

    const assistant = createAssistant({ dir: workDir, apiKey });

    try {
      await assistant.init({ engine: 'cursor', name: 'cloud-ops-bot' });
      record('golem.yaml created', await fileExists(join(workDir, 'golem.yaml')));
      record('AGENTS.md auto-generated', await fileExists(join(workDir, 'AGENTS.md')));

      const skillDir = join(workDir, 'skills', 'devops-assistant');
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, 'SKILL.md'), DEVOPS_SKILL, 'utf-8');
      await writeFile(join(workDir, 'monitor.csv'), MONITOR_CSV, 'utf-8');
      await writeFile(join(workDir, 'app.log'), APP_LOG, 'utf-8');
      info('Deployed: devops-assistant Skill + monitor data + log file');
      record('Ops data ready', await fileExists(join(workDir, 'monitor.csv')));
    } catch (e) {
      record('Init deployment', false);
      console.error(e);
    }

    // ╔═══════════════════════════════════════════════════════╗
    // ║  PART 2: apiKey direct chat — verify auth chain      ║
    // ╚═══════════════════════════════════════════════════════╝

    console.log(`\n${MAGENTA}${BOLD}  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
    console.log(`${MAGENTA}${BOLD}  PART 2: apiKey direct chat — CURSOR_API_KEY → Agent auth chain${RESET}`);
    console.log(`${MAGENTA}${BOLD}  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);

    step('apiKey chat — invoke Agent directly via API Key');

    try {
      const events: StreamEvent[] = [];
      let fullText = '';
      let durationMs: number | undefined;
      console.log(`  ${YELLOW}> Reply OK${RESET}\n`);

      for await (const event of assistant.chat('Reply OK')) {
        events.push(event);
        if (event.type === 'text') {
          process.stdout.write(`${DIM}${event.content}${RESET}`);
          fullText += event.content;
        } else if (event.type === 'done') {
          durationMs = event.durationMs;
          const durStr = durationMs != null ? ` ${(durationMs / 1000).toFixed(1)}s` : '';
          console.log(`\n  ${DIM}── done (session: ${event.sessionId?.slice(0, 8) ?? 'none'}...${durStr}) ──${RESET}`);
        } else if (event.type === 'error') {
          console.log(`\n  ${RED}❌ ${event.message}${RESET}`);
        }
      }
      console.log();

      record('apiKey chat success', fullText.trim().length > 0);
      record('apiKey chat: done has durationMs', durationMs != null && durationMs >= 0);
      record('apiKey chat: session persisted',
        await fileExists(join(workDir, '.golem', 'sessions.json')));
      info(`durationMs: ${durationMs}`);
    } catch (e) {
      record('apiKey chat', false);
      console.error(e);
    }

    // ╔═══════════════════════════════════════════════════════╗
    // ║  PART 3: HTTP service — simulate golembot serve prod   ║
    // ╚═══════════════════════════════════════════════════════╝

    console.log(`\n${MAGENTA}${BOLD}  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
    console.log(`${MAGENTA}${BOLD}  PART 3: HTTP service — simulate golembot serve production${RESET}`);
    console.log(`${MAGENTA}${BOLD}  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);

    step('Start HTTP service (Bearer token protected)');

    await assistant.resetSession();

    server = createGolemServer(assistant, { token: SERVER_TOKEN });
    port = await new Promise<number>((resolve) => {
      server!.listen(0, '127.0.0.1', () => {
        const addr = server!.address() as { port: number };
        resolve(addr.port);
      });
    });
    info(`HTTP service at http://127.0.0.1:${port}`);
    info(`Bearer Token: ${SERVER_TOKEN.slice(0, 20)}...`);
    record('HTTP service started', true);

    // ── 3.1 Health check ──

    step('Health — external probe (no auth)');

    try {
      const res = await httpRequest(port, 'GET', '/health');
      record('GET /health → 200', res.status === 200);
      const body = JSON.parse(res.raw);
      record('/health returns status:ok', body.status === 'ok');
      record('/health has timestamp', typeof body.timestamp === 'string');
    } catch (e) {
      record('Health check', false);
      console.error(e);
    }

    // ── 3.2 Auth ──

    step('Auth — simulate unauthorized / wrong token / correct token');

    try {
      const noToken = await httpRequest(port, 'POST', '/chat', { message: 'hi' });
      record('No token → 401', noToken.status === 401);

      const badToken = await httpRequest(port, 'POST', '/chat', { message: 'hi' }, 'wrong-token');
      record('Wrong token → 401', badToken.status === 401);

      const badBody = await httpRequest(port, 'POST', '/chat', {}, SERVER_TOKEN);
      record('Missing message → 400', badBody.status === 400);

      const goodRes = await httpChat(port, 'Reply OK', { token: SERVER_TOKEN });
      record('Correct token → 200 + text reply', goodRes.status === 200 && goodRes.fullText.trim().length > 0);
    } catch (e) {
      record('Auth verification', false);
      console.error(e);
    }

    // ── 3.3 Ops scenario: log analysis ──

    step('Ops scenario — analyze app log via HTTP');

    try {
      console.log(`  ${YELLOW}Simulate: monitoring alert → call GolemBot HTTP API to analyze log${RESET}\n`);

      const res = await httpChat(
        port,
        'Analyze app.log for anomalies and summarize the most critical issues and recommendations',
        { token: SERVER_TOKEN, sessionKey: 'alert:cpu-spike-001' },
      );
      info(`Reply first 120 chars: "${res.fullText.trim().slice(0, 120)}..."`);

      const mentionsOOM = res.fullText.includes('OOM') || res.fullText.includes('memory') || res.fullText.includes('heap');
      const mentionsError = res.fullText.includes('error') || res.fullText.includes('ERROR') ||
        res.fullText.includes('fail') || res.fullText.includes('exception');
      record('HTTP log analysis: identified OOM or memory issue', mentionsOOM);
      record('HTTP log analysis: mentions error/exception', mentionsError);
      record('HTTP log analysis: done has durationMs', res.durationMs != null && res.durationMs >= 0);
      info(`durationMs: ${res.durationMs}`);
    } catch (e) {
      record('Log analysis', false);
      console.error(e);
    }

    // ── 3.4 Ops scenario: monitoring data analysis ──

    step('Ops scenario — analyze CSV monitor data and identify bottlenecks');

    try {
      console.log(`  ${YELLOW}Simulate: cron hourly check calls GolemBot for inspection${RESET}\n`);

      const res = await httpChat(
        port,
        'Read monitor.csv, tell me which service has highest CPU and latency, any anomalies',
        { token: SERVER_TOKEN, sessionKey: 'cron:hourly-check' },
      );
      info(`Reply first 120 chars: "${res.fullText.trim().slice(0, 120)}..."`);

      const mentionsGateway = res.fullText.includes('api-gateway') || res.fullText.includes('gateway');
      const hasNumbers = /\d{2,}/.test(res.fullText);
      record('HTTP monitor analysis: api-gateway as bottleneck', mentionsGateway);
      record('HTTP monitor analysis: contains concrete data', hasNumbers);
    } catch (e) {
      record('Monitor data analysis', false);
      console.error(e);
    }

    // ── 3.5 Multi-tenant — alert source isolation ──

    step('Multi-tenant isolation — alert source / cron have own session');

    try {
      const sessRaw = await readFile(join(workDir, '.golem', 'sessions.json'), 'utf-8');
      const sessions = JSON.parse(sessRaw);
      const keys = Object.keys(sessions);
      info(`sessions.json keys: ${keys.join(', ')}`);

      record('Alert session created', !!sessions['alert:cpu-spike-001']?.engineSessionId);
      record('Cron session created', !!sessions['cron:hourly-check']?.engineSessionId);
      record('Two sessions independent',
        sessions['alert:cpu-spike-001']?.engineSessionId !==
        sessions['cron:hourly-check']?.engineSessionId);
    } catch (e) {
      record('Multi-tenant isolation', false);
      console.error(e);
    }

    // ── 3.6 Session Reset — cleanup after alert recovery ──

    step('Session cleanup — reset session after alert resolved');

    try {
      const resetRes = await httpRequest(port, 'POST', '/reset',
        { sessionKey: 'alert:cpu-spike-001' }, SERVER_TOKEN);
      record('POST /reset → 200', resetRes.status === 200);

      const sessRaw = await readFile(join(workDir, '.golem', 'sessions.json'), 'utf-8');
      const sessions = JSON.parse(sessRaw);
      record('Alert session cleared', !sessions['alert:cpu-spike-001']);
      record('Cron session unaffected', !!sessions['cron:hourly-check']?.engineSessionId);
    } catch (e) {
      record('Session cleanup', false);
      console.error(e);
    }

    // ╔═══════════════════════════════════════════════════════╗
    // ║  PART 4: Service restart — session persists across   ║
    // ╚═══════════════════════════════════════════════════════╝

    console.log(`\n${MAGENTA}${BOLD}  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
    console.log(`${MAGENTA}${BOLD}  PART 4: Service restart — session persists (simulate systemd restart)${RESET}`);
    console.log(`${MAGENTA}${BOLD}  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);

    step('Restart service — close old server, recreate assistant + server');

    try {
      // Remember cron session ID
      const sessBeforeRestart = JSON.parse(
        await readFile(join(workDir, '.golem', 'sessions.json'), 'utf-8'),
      );
      const cronSessionBefore = sessBeforeRestart['cron:hourly-check']?.engineSessionId;
      info(`Cron session before restart: ${cronSessionBefore}`);

      // Close old server
      await new Promise<void>(r => server!.close(() => r()));
      info('Old HTTP service closed');

      // Recreate assistant (simulate process restart, same dir + apiKey)
      const assistant2 = createAssistant({ dir: workDir, apiKey });
      server = createGolemServer(assistant2, { token: SERVER_TOKEN });
      port = await new Promise<number>((resolve) => {
        server!.listen(0, '127.0.0.1', () => {
          const addr = server!.address() as { port: number };
          resolve(addr.port);
        });
      });
      info(`New HTTP service at http://127.0.0.1:${port}`);
      record('Service restart success', true);

      // Verify session file still exists
      const sessAfterRestart = JSON.parse(
        await readFile(join(workDir, '.golem', 'sessions.json'), 'utf-8'),
      );
      record('Cron session persisted after restart',
        sessAfterRestart['cron:hourly-check']?.engineSessionId === cronSessionBefore);

      // Continue chat with cron session after restart
      const res = await httpChat(
        port,
        'From the monitor.csv we analyzed, what was api-gateway max CPU?',
        { token: SERVER_TOKEN, sessionKey: 'cron:hourly-check' },
      );
      record('Multi-turn chat after restart ok', res.fullText.trim().length > 0);
      info(`Reply after restart first 80 chars: "${res.fullText.trim().slice(0, 80)}..."`);
    } catch (e) {
      record('Service restart', false);
      console.error(e);
    }

  } finally {
    // ── Cleanup ────────────────────────────────────

    step('Cleanup — close service + remove temp dir');

    if (server?.listening) {
      await new Promise<void>(r => server!.close(() => r()));
      ok('HTTP service closed');
    }

    try {
      await rm(workDir, { recursive: true, force: true });
      ok(`Deleted ${workDir}`);
    } catch (e) {
      fail(`Cleanup failed: ${e}`);
    }

    // ── Summary ────────────────────────────────────

    console.log(`\n${CYAN}${BOLD}════════════════════════ Test Summary ════════════════════════${RESET}\n`);

    for (const r of results) {
      console.log(`  ${r.passed ? GREEN + '✓' : RED + '✗'} ${r.step}${RESET}`);
    }

    const passed = results.filter(r => r.passed).length;
    const total = results.length;
    const pct = Math.round(passed / total * 100);
    const color = pct === 100 ? GREEN : pct >= 80 ? YELLOW : RED;

    console.log(`\n  ${color}${BOLD}Result: ${passed}/${total} passed (${pct}%)${RESET}`);
    console.log(`\n${DIM}  Headless deployment core chain verified:`);
    console.log(`    CURSOR_API_KEY=xxx                      → Agent headless auth`);
    console.log(`    createAssistant({ dir, apiKey })         → programmatic create, no IDE`);
    console.log(`    createGolemServer(assistant, { token })  → HTTP service exposed`);
    console.log(`    POST /chat { sessionKey: "alert:xxx" }   → multi-source isolation`);
    console.log(`    systemd restart → session restored       → seamless restart${RESET}\n`);

    if (passed < total) {
      process.exit(1);
    }
  }
}

main().catch((e) => {
  console.error(`\n${RED}Fatal error:${RESET}`, e);
  process.exit(1);
});
