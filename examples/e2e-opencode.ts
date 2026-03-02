/**
 * GolemBot E2E Test — OpenCode engine full real-world scenario verification
 *
 * Verifies OpenCode engine in real user scenarios:
 *   PART 1: Core engine (chat, file I/O, Skill script, memory, metadata)
 *   PART 2: Embedded scenarios (IM Bot, CI/CD code review)
 *   PART 3: HTTP serve (health / auth / multi-user session / reset)
 *
 * Run: pnpm run build && pnpm run e2e:opencode
 *
 * Prerequisites:
 *   - opencode available (npm install -g opencode-ai)
 *   - Provider API Key set (e.g. OPENROUTER_API_KEY)
 *   - python3 available (for Skill script tests)
 */

import { readFileSync } from 'node:fs';
import { createAssistant, createGolemServer } from '../dist/index.js';
import { mkdtemp, rm, readdir, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { join, resolve as resolvePath } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import http from 'node:http';
import type { StreamEvent } from '../dist/index.js';

// ── .env auto-load ────────────────────────────────────────
try {
  const envPath = resolvePath(new URL('.', import.meta.url).pathname, '..', '.env');
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (val && !process.env[key]) process.env[key] = val;
  }
} catch { /* .env not found */ }

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

const results: Array<{ name: string; pass: boolean }> = [];
function record(name: string, pass: boolean) {
  results.push({ name, pass });
  if (pass) ok(name); else fail(name);
}

async function fileExists(p: string): Promise<boolean> {
  return stat(p).then(() => true).catch(() => false);
}

async function collectChat(
  assistant: ReturnType<typeof createAssistant>,
  message: string,
  chatOpts?: { sessionKey?: string },
): Promise<{ events: StreamEvent[]; fullText: string; durationMs?: number; costUsd?: number }> {
  const events: StreamEvent[] = [];
  let fullText = '';
  let durationMs: number | undefined;
  let costUsd: number | undefined;
  console.log(`  ${YELLOW}> ${message}${RESET}\n`);

  for await (const event of assistant.chat(message, chatOpts)) {
    events.push(event);
    switch (event.type) {
      case 'text':
        process.stdout.write(`${DIM}${event.content}${RESET}`);
        fullText += event.content;
        break;
      case 'tool_call':
        console.log(`\n  ${DIM}🔧 [${event.name}]${RESET}`);
        break;
      case 'tool_result':
        console.log(`  ${DIM}   ↳ result${RESET}`);
        break;
      case 'warning':
        console.log(`\n  ${YELLOW}⚠ ${event.message}${RESET}`);
        break;
      case 'error':
        console.log(`\n  ${RED}❌ ${event.message}${RESET}`);
        break;
      case 'done':
        durationMs = event.durationMs;
        costUsd = event.costUsd;
        const parts: string[] = [];
        if (event.sessionId) parts.push(`session: ${event.sessionId.slice(0, 12)}...`);
        if (durationMs != null) parts.push(`${(durationMs / 1000).toFixed(1)}s`);
        if (costUsd != null) parts.push(`$${costUsd.toFixed(4)}`);
        console.log(`\n  ${DIM}── done (${parts.join(' | ')}) ──${RESET}`);
        break;
    }
  }
  console.log();
  return { events, fullText, durationMs, costUsd };
}

function httpChat(
  port: number,
  message: string,
  sessionKey?: string,
  token?: string,
): Promise<{ events: StreamEvent[]; fullText: string; status: number }> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ message, sessionKey });
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const req = http.request(
      { hostname: '127.0.0.1', port, path: '/chat', method: 'POST', headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString();
          const events: StreamEvent[] = [];
          let fullText = '';
          for (const line of raw.split('\n\n')) {
            if (!line.startsWith('data: ')) continue;
            try {
              const evt: StreamEvent = JSON.parse(line.slice(6));
              events.push(evt);
              if (evt.type === 'text') fullText += evt.content;
            } catch { /* skip */ }
          }
          resolve({ events, fullText, status: res.statusCode! });
        });
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function httpRequest(
  port: number,
  path: string,
  method = 'GET',
  body?: string,
  token?: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const req = http.request(
      { hostname: '127.0.0.1', port, path, method, headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode!, body: Buffer.concat(chunks).toString() }));
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ── Skill & Data Fixtures ───────────────────────────────

const SALES_CSV = `date,product,quantity,price
2025-01-01,Smart Watch,120,299
2025-01-01,Bluetooth Earphones,85,159
2025-01-01,Phone Case,200,39
2025-01-02,Smart Watch,95,299
2025-01-02,Bluetooth Earphones,110,159
2025-01-02,Phone Case,180,39
2025-01-03,Smart Watch,150,299
2025-01-03,Bluetooth Earphones,90,159
2025-01-03,Phone Case,220,39`;

const DATA_ANALYST_SKILL = `---
name: data-analyst
description: Data analyst assistant — reads data files, outputs structured analysis reports
---

# Data Analyst Assistant

You are a professional data analyst.

## Working Conventions

- Prefer reading CSV/JSON data files in the current directory
- Analysis conclusions must be backed by concrete numbers
- If user requests to save report, write to report.md
`;

const CALC_SKILL_MD = `---
name: calc-tool
description: Data calculation tool — provides calc.py script for data statistics
---

# Data Calculation Tool

You can use the \`calc.py\` script in this skill directory to process CSV data.

## Usage

\`\`\`bash
python3 skills/calc-tool/calc.py <csv_file_path>
\`\`\`

The script outputs JSON format statistics including total quantity, revenue, per-product details.
`;

const CALC_PY = `#!/usr/bin/env python3
"""CSV sales data statistics script"""
import csv, json, sys
from collections import defaultdict

def analyze(path):
    products = defaultdict(lambda: {"qty": 0, "revenue": 0})
    total_qty = 0
    total_revenue = 0
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            qty = int(row["quantity"])
            price = float(row["price"])
            rev = qty * price
            products[row["product"]]["qty"] += qty
            products[row["product"]]["revenue"] += rev
            total_qty += qty
            total_revenue += rev
    return {
        "total_qty": total_qty,
        "total_revenue": total_revenue,
        "products": dict(products),
    }

if __name__ == "__main__":
    result = analyze(sys.argv[1])
    print(json.dumps(result, ensure_ascii=False, indent=2))
`;

const IM_BOT_SKILL = `---
name: im-bot
description: IM customer service bot — handles user messages from instant messaging channels
---

# IM Customer Service Bot

You are an intelligent customer service bot connected to IM tools (Feishu/Slack/Discord).

## Behavior Requirements

1. User message format is \`[username] message content\`, you need to identify user
2. Replies should be concise and friendly, like a real agent
3. If user mentions querying data, proactively read relevant data files in current directory
4. Append key info from each conversation to chat-log.md (for team traceability)

## Working Conventions

- Always address users in second person (e.g. "you")
- Chat log format: \`| time | user | issue summary | outcome |\`
`;

const CODE_REVIEWER_SKILL = `---
name: code-reviewer
description: Code review assistant — reviews code changes, outputs structured review report
---

# Code Review Assistant

You are a code review bot.

## Review Process

1. Read the specified source files
2. Check: security risks, potential bugs, performance, code style
3. Output structured review report to review-report.md
`;

const BUGGY_CODE = `// user-service.ts
import { db } from './database';

export async function getUser(id: string) {
  const query = "SELECT * FROM users WHERE id = '" + id + "'";
  const result = await db.query(query);
  return result[0];
}

export async function deleteUser(id: string) {
  await db.query("DELETE FROM users WHERE id = '" + id + "'");
  return { success: true };
}

export async function updatePassword(id: string, newPassword: string) {
  await db.query("UPDATE users SET password = '" + newPassword + "' WHERE id = '" + id + "'");
}
`;

const PRODUCT_FAQ = `# Product FAQ

## Return Policy
- 7-day no-questions-asked returns
- Item must be in original packaging

## After-Sales Service
- Smart Watch: 1 year warranty
- Bluetooth Earphones: 6 months warranty
- Phone Case: no warranty
`;

// ═══════════════════════════════════════════════════════
// Preflight checks
// ═══════════════════════════════════════════════════════

let opencodeBin = '';
try {
  opencodeBin = execSync('which opencode', { encoding: 'utf-8', timeout: 5000 }).trim();
} catch { /* not found */ }

if (!opencodeBin) {
  console.log(`${YELLOW}⏭  OpenCode CLI not found (npm i -g opencode-ai), skipping e2e tests.${RESET}`);
  process.exit(0);
}

const hasApiKey =
  process.env.OPENROUTER_API_KEY ||
  process.env.ANTHROPIC_API_KEY ||
  process.env.OPENAI_API_KEY;

if (!hasApiKey) {
  console.log(`${YELLOW}⏭  No API key found (OPENROUTER_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY), skipping.${RESET}`);
  process.exit(0);
}

const defaultModel = process.env.OPENCODE_MODEL || (
  process.env.OPENROUTER_API_KEY ? 'openrouter/anthropic/claude-sonnet-4' :
  process.env.ANTHROPIC_API_KEY ? 'anthropic/claude-sonnet-4' :
  'openai/gpt-4o'
);

const defaultApiKey = process.env.OPENROUTER_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || '';

console.log(`${CYAN}${BOLD}`);
console.log(`╔══════════════════════════════════════════════════════════════╗`);
console.log(`║  GolemBot E2E — OpenCode engine full real scenario verification        ║`);
console.log(`╚══════════════════════════════════════════════════════════════╝${RESET}`);

info(`OpenCode CLI: ${opencodeBin}`);
info(`Model: ${defaultModel}`);
info(`API Key: ${defaultApiKey ? defaultApiKey.slice(0, 10) + '...' : '(none)'}`);

// ═══════════════════════════════════════════════════════
// Main test
// ═══════════════════════════════════════════════════════

const dirsToClean: string[] = [];

try {
  const baseDir = await mkdtemp(join(tmpdir(), 'golem-e2e-oc-'));
  dirsToClean.push(baseDir);
  info(`base dir: ${baseDir}`);

  function makeAssistant(dir: string) {
    return createAssistant({
      dir,
      engine: 'opencode',
      model: defaultModel,
      apiKey: defaultApiKey,
    });
  }

  // ╔════════════════════════════════════════════════════════╗
  // ║  PART 1: Core engine capability                          ║
  // ╚════════════════════════════════════════════════════════╝

  console.log(`\n${MAGENTA}${BOLD}  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
  console.log(`${MAGENTA}${BOLD}  PART 1: Core engine — chat, file, Skill, script, memory${RESET}`);
  console.log(`${MAGENTA}${BOLD}  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);

  const coreDir = join(baseDir, 'core');
  await mkdir(coreDir, { recursive: true });
  const coreBot = makeAssistant(coreDir);

  // ── 1.1 Init ────────────────────────────────────

  step('Init — one-click init OpenCode assistant');

  try {
    await coreBot.init({ engine: 'opencode', name: 'golem-opencode' });
    const files = await readdir(coreDir);
    record('golem.yaml ready', files.includes('golem.yaml'));
    record('skills/ ready', await fileExists(join(coreDir, 'skills', 'general', 'SKILL.md')));
    record('AGENTS.md auto-generated', files.includes('AGENTS.md'));
    record('.gitignore has .opencode/', (await readFile(join(coreDir, '.gitignore'), 'utf-8')).includes('.opencode/'));
  } catch (e) {
    record('Init failed', false);
    console.error(e);
  }

  // ── 1.2 Basic chat + multi-turn ───────────────────────

  step('Chat + multi-turn');

  try {
    const { fullText: t1, costUsd: c1 } = await collectChat(
      coreBot, 'Introduce yourself in one sentence, under 20 words',
    );
    record('Basic chat success', t1.trim().length > 0);
    info(`costUsd: ${c1}`);

    const sessRaw = await readFile(join(coreDir, '.golem', 'sessions.json'), 'utf-8');
    const sessData = JSON.parse(sessRaw);
    const firstSessionId = sessData.default?.engineSessionId;
    record('Session persisted', !!firstSessionId);
    if (firstSessionId) {
      record('session ID format (ses_xxx)', firstSessionId.startsWith('ses_'));
    }

    const { fullText: t2 } = await collectChat(coreBot, 'Say your last sentence in reverse');
    record('Multi-turn resume works', t2.trim().length > 0);
  } catch (e) {
    record('Chat test failed', false);
    console.error(e);
  }

  // ── 1.3 File I/O ────────────────────────────────

  step('File I/O — Agent reads CSV + writes analysis');

  try {
    await coreBot.resetSession();
    await writeFile(join(coreDir, 'sales.csv'), SALES_CSV, 'utf-8');
    info('Seeded sales.csv');

    const { fullText, events } = await collectChat(
      coreBot, 'Read sales.csv, tell me which product has highest total quantity over 3 days and write conclusion to summary.txt',
    );

    record('Agent used tools', events.some(e => e.type === 'tool_call'));
    record('Identified Phone Case (highest quantity)', fullText.includes('Phone Case') || fullText.includes('Case'));
    record('summary.txt generated', await fileExists(join(coreDir, 'summary.txt')));
  } catch (e) {
    record('File I/O failed', false);
    console.error(e);
  }

  // ── 1.4 Skill injection verification ─────────────────────────

  step('Skill injection — .opencode/skills/ symlink + opencode.json');

  try {
    await coreBot.resetSession();
    const skillDir = join(coreDir, 'skills', 'data-analyst');
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), DATA_ANALYST_SKILL, 'utf-8');

    const { fullText } = await collectChat(coreBot, 'Analyze the data in sales.csv');

    const ocSkillsDir = join(coreDir, '.opencode', 'skills');
    const hasOcSkills = await fileExists(ocSkillsDir);
    record('.opencode/skills/ dir created', hasOcSkills);

    if (hasOcSkills) {
      const entries = await readdir(ocSkillsDir);
      record('.opencode/skills/ has general', entries.includes('general'));
      record('.opencode/skills/ has data-analyst', entries.includes('data-analyst'));
    }

    record('opencode.json generated', await fileExists(join(coreDir, 'opencode.json')));

    if (await fileExists(join(coreDir, 'opencode.json'))) {
      const ocConfig = JSON.parse(await readFile(join(coreDir, 'opencode.json'), 'utf-8'));
      record('opencode.json permission config correct', ocConfig.permission?.['*'] === 'allow');
    }

    record('Agent output analysis', fullText.includes('data') || fullText.includes('analysis') || fullText.includes('sale'));
  } catch (e) {
    record('Skill injection failed', false);
    console.error(e);
  }

  // ── 1.5 Skill script invocation ─────────────────────────

  step('Skill script — Agent invokes Python script');

  try {
    await coreBot.resetSession();
    const calcDir = join(coreDir, 'skills', 'calc-tool');
    await mkdir(calcDir, { recursive: true });
    await writeFile(join(calcDir, 'SKILL.md'), CALC_SKILL_MD, 'utf-8');
    await writeFile(join(calcDir, 'calc.py'), CALC_PY, 'utf-8');

    const { events, fullText } = await collectChat(
      coreBot, 'Calculate total revenue of all products in sales.csv',
    );
    record('Agent ran tools', events.some(e => e.type === 'tool_call'));
    record('Total revenue correct (~177850)', fullText.includes('177') || fullText.includes('17.7'));
  } catch (e) {
    record('Skill script failed', false);
    console.error(e);
  }

  // ── 1.6 Persistent memory ────────────────────────────────

  step('Persistent memory — cross-Session file memory');

  try {
    await coreBot.resetSession();
    await collectChat(coreBot, 'Remember: project code name is Phoenix, deadline is March 15');
    // Agent may use different file name or internal storage mechanism — file creation is informational
    if (await fileExists(join(coreDir, 'notes.md'))) info('notes.md created (file-based memory)');
    else info('notes.md not created (agent may use different storage)');

    await coreBot.resetSession();
    const { fullText } = await collectChat(coreBot, 'What was the project code name I asked you to remember?');
    record('Cross-Session recall success', fullText.includes('Phoenix') || fullText.includes('phoenix'));
  } catch (e) {
    record('Persistent memory failed', false);
    console.error(e);
  }

  // ╔════════════════════════════════════════════════════════╗
  // ║  PART 2: Embedded scenarios — same API, different forms   ║
  // ╚════════════════════════════════════════════════════════╝

  console.log(`\n${MAGENTA}${BOLD}  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
  console.log(`${MAGENTA}${BOLD}  PART 2: Embedded scenarios — IM service + CI/CD code review${RESET}`);
  console.log(`${MAGENTA}${BOLD}  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);

  // ── Scenario A: IM customer service bot ──────────────────────

  console.log(`\n${BOLD}${CYAN}  ▸ Scenario A: Feishu/Slack customer service bot${RESET}`);
  console.log(`${DIM}    Simulate: webhook receives IM → createAssistant().chat() → reply${RESET}`);

  const imDir = await mkdtemp(join(tmpdir(), 'golem-oc-im-'));
  dirsToClean.push(imDir);
  const imBot = makeAssistant(imDir);

  step('IM Bot — init customer service bot');

  try {
    await imBot.init({ engine: 'opencode', name: 'im-support-bot' });

    const skillDir = join(imDir, 'skills', 'im-bot');
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), IM_BOT_SKILL, 'utf-8');
    await writeFile(join(imDir, 'faq.md'), PRODUCT_FAQ, 'utf-8');
    info('Configured IM service Skill + FAQ');

    record('IM Bot workspace ready', await fileExists(join(imDir, 'faq.md')));
  } catch (e) {
    record('IM Bot init failed', false);
    console.error(e);
  }

  step('IM Bot — handle user inquiry (simulate Feishu webhook)');

  try {
    const { fullText: r1 } = await collectChat(
      imBot, '[User:XiaoMing] Hi, my Bluetooth earphones broke, how long is the warranty?',
    );
    record('IM: correct warranty reply (6 months)',
      r1.includes('6') || r1.toLowerCase().includes('month') ||
      r1.toLowerCase().includes('six') || r1.toLowerCase().includes('half'));
  } catch (e) {
    record('IM Bot chat failed', false);
    console.error(e);
  }

  // ── Scenario B: CI/CD code review ─────────────────────

  console.log(`\n${BOLD}${CYAN}  ▸ Scenario B: CI/CD code review pipeline${RESET}`);
  console.log(`${DIM}    Simulate: git push → CI triggers → createAssistant().chat() → review report${RESET}`);

  const ciDir = await mkdtemp(join(tmpdir(), 'golem-oc-ci-'));
  dirsToClean.push(ciDir);
  const reviewBot = makeAssistant(ciDir);

  step('Code Review — init review bot');

  try {
    await reviewBot.init({ engine: 'opencode', name: 'ci-review-bot' });

    const skillDir = join(ciDir, 'skills', 'code-reviewer');
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), CODE_REVIEWER_SKILL, 'utf-8');
    await writeFile(join(ciDir, 'user-service.ts'), BUGGY_CODE, 'utf-8');
    info('Seeded user-service.ts (contains SQL injection etc)');

    record('CI Bot workspace ready', await fileExists(join(ciDir, 'user-service.ts')));
  } catch (e) {
    record('CI Bot init failed', false);
    console.error(e);
  }

  step('Code Review — review code and output report');

  try {
    const { events, fullText } = await collectChat(
      reviewBot, 'Review user-service.ts for security or code quality issues',
    );

    record('CI: Agent used tools to read code', events.some(e => e.type === 'tool_call'));
    const foundSqlIssue =
      fullText.toLowerCase().includes('sql') ||
      fullText.includes('injection') ||
      fullText.includes('concatenat') ||
      fullText.toLowerCase().includes('inject');
    record('CI: found SQL injection', foundSqlIssue);
  } catch (e) {
    record('Code Review failed', false);
    console.error(e);
  }

  // ╔════════════════════════════════════════════════════════╗
  // ║  PART 3: HTTP service — golembot serve end-to-end      ║
  // ╚════════════════════════════════════════════════════════╝

  console.log(`\n${MAGENTA}${BOLD}  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
  console.log(`${MAGENTA}${BOLD}  PART 3: HTTP service — health / auth / multi-user session / reset${RESET}`);
  console.log(`${MAGENTA}${BOLD}  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);

  const httpDir = await mkdtemp(join(tmpdir(), 'golem-oc-http-'));
  dirsToClean.push(httpDir);
  let httpServer: http.Server | undefined;

  try {
    step('HTTP — init + start service');

    const httpBot = makeAssistant(httpDir);
    await httpBot.init({ engine: 'opencode', name: 'http-bot' });
    info('Initialized http-bot');

    const token = 'e2e-oc-token-' + Date.now();
    httpServer = createGolemServer(httpBot, { token });
    const port = await new Promise<number>((resolve) => {
      httpServer!.listen(0, '127.0.0.1', () => {
        const addr = httpServer!.address() as { port: number };
        resolve(addr.port);
      });
    });
    info(`HTTP service at http://127.0.0.1:${port}`);
    record('HTTP service started', true);

    step('HTTP — Health + Auth');

    const health = await httpRequest(port, '/health');
    record('GET /health → 200', health.status === 200);

    const noAuth = await httpRequest(port, '/chat', 'POST', JSON.stringify({ message: 'hi' }));
    record('No token → 401', noAuth.status === 401);

    const wrongAuth = await httpRequest(port, '/chat', 'POST', JSON.stringify({ message: 'hi' }), 'wrong');
    record('Wrong token → 401', wrongAuth.status === 401);

    step('HTTP — multi-user sessionKey isolation');

    const resA = await httpChat(port, 'Hi, remember my name is Alice', 'user:alice', token);
    info(`Alice reply: "${resA.fullText.trim().slice(0, 80)}"`);
    record('Alice: got reply', resA.events.some(e => e.type === 'text'));

    const resB = await httpChat(port, 'Hi, remember my name is Bob', 'user:bob', token);
    info(`Bob reply: "${resB.fullText.trim().slice(0, 80)}"`);
    record('Bob: got reply', resB.events.some(e => e.type === 'text'));

    const sessRaw = await readFile(join(httpDir, '.golem', 'sessions.json'), 'utf-8');
    const sessions = JSON.parse(sessRaw);
    record('Alice has own session', !!sessions['user:alice']?.engineSessionId);
    record('Bob has own session', !!sessions['user:bob']?.engineSessionId);
    record('Two sessions differ', sessions['user:alice']?.engineSessionId !== sessions['user:bob']?.engineSessionId);

    step('HTTP — Reset specified user session');

    const resetRes = await httpRequest(port, '/reset', 'POST', JSON.stringify({ sessionKey: 'user:alice' }), token);
    record('POST /reset → 200', resetRes.status === 200);

    const sessAfter = JSON.parse(await readFile(join(httpDir, '.golem', 'sessions.json'), 'utf-8'));
    record('Alice session cleared', !sessAfter['user:alice']);
    record('Bob session unaffected', !!sessAfter['user:bob']?.engineSessionId);

  } catch (e) {
    record('HTTP service scenario failed', false);
    console.error(e);
  } finally {
    if (httpServer?.listening) {
      await new Promise<void>(r => httpServer!.close(() => r()));
      info('HTTP service closed');
    }
  }

  // ╔════════════════════════════════════════════════════════╗
  // ║  PART 4: systemPrompt injection                         ║
  // ╚════════════════════════════════════════════════════════╝

  console.log(`\n${MAGENTA}${BOLD}  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
  console.log(`${MAGENTA}${BOLD}  PART 4: systemPrompt — injected into AGENTS.md, not prepended to message${RESET}`);
  console.log(`${MAGENTA}${BOLD}  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);

  const spDir = await mkdtemp(join(tmpdir(), 'golem-oc-sp-'));
  dirsToClean.push(spDir);

  step('systemPrompt — injected into AGENTS.md as System Instructions section');

  try {
    const spBot = makeAssistant(spDir);
    await spBot.init({ engine: 'opencode', name: 'sp-test-bot' });

    // Write golem.yaml with systemPrompt
    await writeFile(
      join(spDir, 'golem.yaml'),
      'name: sp-test-bot\nengine: opencode\nsystemPrompt: "You are a specialized bot named GolemTest."\n',
    );

    // One chat call triggers ensureReady() which regenerates AGENTS.md
    await collectChat(spBot, 'Reply OK in one word');

    const agentsMd = await readFile(join(spDir, 'AGENTS.md'), 'utf-8');
    record('AGENTS.md contains System Instructions section', agentsMd.includes('## System Instructions'));
    record('AGENTS.md contains systemPrompt content', agentsMd.includes('GolemTest'));
  } catch (e) {
    record('systemPrompt injection', false);
    console.error(e);
  }

  // ═══════════════════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════════════════

  console.log(`\n${CYAN}${BOLD}════════════════════════ Test Summary ════════════════════════${RESET}\n`);

  for (const r of results) {
    console.log(`  ${r.pass ? GREEN + '✓' : RED + '✗'} ${r.name}${RESET}`);
  }

  const passed = results.filter(r => r.pass).length;
  const total = results.length;
  const pct = Math.round(passed / total * 100);
  const color = pct === 100 ? GREEN : pct >= 80 ? YELLOW : RED;

  console.log(`\n  ${color}${BOLD}Result: ${passed}/${total} passed (${pct}%)${RESET}`);
  console.log(`\n${DIM}  Core verified:`);
  console.log(`    OpenCode engine × GolemBot framework = full Agent experience`);
  console.log(`    File I/O + Skill script + memory + IM Bot + CI/CD + HTTP service + systemPrompt${RESET}\n`);

  process.exit(passed === total ? 0 : 1);

} catch (e) {
  console.error(`\n${RED}${BOLD}E2E test exited with error:${RESET}`, e);
  process.exit(1);
} finally {
  for (const d of dirsToClean) {
    await rm(d, { recursive: true, force: true }).catch(() => {});
  }
}
