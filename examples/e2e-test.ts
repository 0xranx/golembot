/**
 * GolemBot E2E Test — Cursor engine full real-world scenario verification
 *
 * Core narrative: Your Coding Agent is no longer just a code-writing tool —
 * The same createAssistant() API can directly become an IM bot,
 * CI/CD code review pipeline, data processing backend... any form you want.
 *
 * Run: pnpm run build && pnpm run e2e
 *
 * Prerequisites:
 *   - ~/.local/bin/agent available (Cursor Agent CLI)
 *   - python3 available (for Skill script tests)
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
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
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

async function collectChat(
  assistant: ReturnType<typeof createAssistant>,
  message: string,
  chatOpts?: { sessionKey?: string },
): Promise<{ events: StreamEvent[]; fullText: string; durationMs?: number }> {
  const events: StreamEvent[] = [];
  let fullText = '';
  let durationMs: number | undefined;
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
        const durStr = durationMs != null ? ` ${(durationMs / 1000).toFixed(1)}s` : '';
        console.log(`\n  ${DIM}── done (session: ${event.sessionId?.slice(0, 8) ?? 'none'}...${durStr}) ──${RESET}`);
        break;
    }
  }
  console.log();
  return { events, fullText, durationMs };
}

async function fileExists(p: string): Promise<boolean> {
  return stat(p).then(() => true).catch(() => false);
}

async function httpChat(
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

async function httpPost(
  port: number,
  path: string,
  body?: unknown,
  token?: string,
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const req = http.request(
      { hostname: '127.0.0.1', port, path, method: 'POST', headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString();
          try { resolve({ status: res.statusCode!, body: JSON.parse(raw) }); }
          catch { resolve({ status: res.statusCode!, body: raw }); }
        });
      },
    );
    req.on('error', reject);
    if (body !== undefined) req.write(JSON.stringify(body));
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

## Analysis Report Format Requirements

When users ask you to analyze data, **must** output in the following fixed format:

\`\`\`
📊 Data Analysis Report
━━━━━━━━━━━━━━
Overview: [row count, column count, time range]
Key Findings: [3 most important findings, with numbers]
Recommendations: [1-2 action items based on data]
\`\`\`

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

The script outputs JSON format statistics including total quantity, total revenue, per-product details.

## Notes

- Confirm CSV file exists before invoking the script
- Script output is JSON, you can reference the numbers directly
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

1. User message format is \`[username] message content\`, you need to identify user and remember context
2. Replies should be concise and friendly, like a real customer service agent
3. If user mentions needing to query data, proactively read relevant data files in current directory
4. Append key info from each conversation to chat-log.md (for team traceability)

## Working Conventions

- Always address users in second person (e.g. "you")
- Chat log format: \`| time | user | issue summary | outcome |\`
`;

const CODE_REVIEWER_SKILL = `---
name: code-reviewer
description: Code review assistant — reviews code changes in CI/CD pipeline
---

# Code Review Assistant

You are a code review bot embedded in a CI/CD pipeline.

## Review Process

1. Read the specified source files
2. Check the following dimensions:
   - 🐛 Potential bugs
   - ⚡ Performance issues
   - 📐 Code style
   - 🔒 Security risks
3. Output structured review report to review-report.md

## Report Format

\`\`\`markdown
# Code Review Report

## Summary
- Files reviewed: [file list]
- Issues found: [N]

## Issue List
### [Severity] Issue title
- File: xxx
- Line: xxx
- Description: xxx
- Suggestion: xxx
\`\`\`

## Conventions

- Severity levels: 🔴 Critical / 🟡 Warning / 🔵 Suggestion
- Output report even when no issues (state "No issues found")
`;

const BUGGY_CODE = `// user-service.ts
import { db } from './database';

export async function getUser(id: string) {
  const query = "SELECT * FROM users WHERE id = '" + id + "'";
  const result = await db.query(query);
  return result[0];
}

export async function listUsers(page: number) {
  const offset = page * 100;
  const users = await db.query("SELECT * FROM users LIMIT 100 OFFSET " + offset);
  return users;
}

export function formatUserName(user: any) {
  return user.firstName + ' ' + user.lastName;
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
- Refund within 3 business days

## Shipping Info
- Default express shipping
- 3-5 days for remote areas
- Next-day delivery for major cities

## After-Sales Service
- Smart Watch: 1 year warranty
- Bluetooth Earphones: 6 months warranty
- Phone Case: no warranty
`;

// ── Main ────────────────────────────────────────────────

async function main() {
  console.log(`${CYAN}${BOLD}`);
  console.log(`╔════════════════════════════════════════════════════════════════╗`);
  console.log(`║  GolemBot E2E — Your Coding Agent, Everywhere                   ║`);
  console.log(`║  Same createAssistant() → IM bot / CI review / data pipeline ║`);
  console.log(`╚════════════════════════════════════════════════════════════════╝${RESET}`);

  const baseDir = await mkdtemp(join(tmpdir(), 'golem-e2e-'));
  console.log(`\n  Base dir: ${DIM}${baseDir}${RESET}`);

  const results: { step: string; passed: boolean }[] = [];
  function record(name: string, passed: boolean) {
    results.push({ step: name, passed });
    if (passed) ok(name); else fail(name);
  }

  const dirsToClean: string[] = [baseDir];

  try {

    // ╔════════════════════════════════════════════════════════╗
    // ║  PART 1: Core engine capability verification         ║
    // ║  Prove GolemBot fully exposes Coding Agent capabilities  ║
    // ╚════════════════════════════════════════════════════════╝

    console.log(`\n${MAGENTA}${BOLD}  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
    console.log(`${MAGENTA}${BOLD}  PART 1: Core engine — chat, file I/O, Skill, script, memory${RESET}`);
    console.log(`${MAGENTA}${BOLD}  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);

    const coreDir = join(baseDir, 'core');
    await mkdir(coreDir, { recursive: true });
    const coreBot = createAssistant({ dir: coreDir });

    // ── 1.1 Init ────────────────────────────────────

    step('Init — one-click setup');

    try {
      await coreBot.init({ engine: 'cursor', name: 'golem-core' });
      const files = await readdir(coreDir);
      record('golem.yaml ready', files.includes('golem.yaml'));
      record('skills/ ready', await fileExists(join(coreDir, 'skills', 'general', 'SKILL.md')));
      record('AGENTS.md auto-generated', files.includes('AGENTS.md'));
    } catch (e) {
      record('Init', false);
      console.error(e);
    }

    // ── 1.2 Chat + multi-turn ─────────────────────────────

    step('Chat + multi-turn context');

    try {
      const { fullText: t1, durationMs: d1 } = await collectChat(coreBot, 'Introduce yourself in one sentence, under 20 words');
      record('Basic chat success', t1.trim().length > 0);
      record('done event has durationMs', d1 != null && d1 >= 0);
      info(`durationMs: ${d1}`);

      const sessRaw = await readFile(join(coreDir, '.golem', 'sessions.json'), 'utf-8');
      const sessData = JSON.parse(sessRaw);
      const firstSessionId = sessData.default?.engineSessionId;
      record('Session persisted', !!firstSessionId);
      info(`session: ${firstSessionId}`);

      const { fullText: t2 } = await collectChat(coreBot, 'Please say your last sentence in reverse');
      record('Multi-turn resume works', t2.trim().length > 0);
    } catch (e) {
      record('Chat', false);
      console.error(e);
    }

    // ── 1.3 File I/O ────────────────────────────────

    step('File I/O — Agent reads existing data + writes analysis');

    try {
      await writeFile(join(coreDir, 'sales.csv'), SALES_CSV, 'utf-8');
      info('Seeded sales.csv');

      const { fullText } = await collectChat(
        coreBot, 'Read sales.csv, tell me which product has the highest total quantity over 3 days and write the conclusion to summary.txt',
      );
      record('Identified Phone Case as top', fullText.includes('Phone Case') || fullText.includes('Case'));
      record('summary.txt generated', await fileExists(join(coreDir, 'summary.txt')));
    } catch (e) {
      record('File I/O', false);
      console.error(e);
    }

    // ── 1.4 Skill hot-swap ────────────────────────────

    step('Skill hot-swap — inject data-analyst');

    try {
      await coreBot.resetSession();
      const skillDir = join(coreDir, 'skills', 'data-analyst');
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, 'SKILL.md'), DATA_ANALYST_SKILL, 'utf-8');

      const { fullText } = await collectChat(coreBot, 'Analyze the data in sales.csv');
      const agentsMd = await readFile(join(coreDir, 'AGENTS.md'), 'utf-8');
      record('AGENTS.md auto-includes new Skill', agentsMd.includes('data-analyst'));
      // Check for substantial response rather than specific keywords (agent may phrase differently)
      record('Agent outputs analysis', fullText.trim().length > 100);
    } catch (e) {
      record('Skill hot-swap', false);
      console.error(e);
    }

    // ── 1.5 Skill script invocation ──────────────────────────

    step('Skill script — Agent invokes Python script');

    try {
      await coreBot.resetSession();
      const calcDir = join(coreDir, 'skills', 'calc-tool');
      await mkdir(calcDir, { recursive: true });
      await writeFile(join(calcDir, 'SKILL.md'), CALC_SKILL_MD, 'utf-8');
      await writeFile(join(calcDir, 'calc.py'), CALC_PY, 'utf-8');

      const { events, fullText } = await collectChat(
        coreBot, 'Calculate the total revenue of all products in sales.csv',
      );
      record('Agent ran script', events.some(e => e.type === 'tool_call'));
      record('Total revenue correct (~177850)', fullText.includes('177') || fullText.includes('17.7'));
    } catch (e) {
      record('Skill script', false);
      console.error(e);
    }

    // ── 1.6 Persistent memory ────────────────────────────────

    step('Persistent memory — cross-Session file memory');

    try {
      await coreBot.resetSession();
      await collectChat(coreBot, 'Remember: project code name is Phoenix, deadline is March 15');
      record('notes.md created', await fileExists(join(coreDir, 'notes.md')));

      await coreBot.resetSession();
      const { fullText } = await collectChat(coreBot, 'What was the project code name I asked you to remember? What was the deadline?');
      record('Cross-Session recall success', fullText.includes('Phoenix'));
    } catch (e) {
      record('Persistent memory', false);
      console.error(e);
    }

    // ── 1.7 apiKey passthrough (conditional) ──────────────────

    if (process.env.CURSOR_API_KEY) {
      step('apiKey passthrough — create assistant with CURSOR_API_KEY and chat');

      try {
        const apiKeyDir = join(baseDir, 'apikey-test');
        await mkdir(apiKeyDir, { recursive: true });
        const apiKeyBot = createAssistant({ dir: apiKeyDir, apiKey: process.env.CURSOR_API_KEY });
        await apiKeyBot.init({ engine: 'cursor', name: 'apikey-bot' });

        const { fullText } = await collectChat(apiKeyBot, 'Reply OK');
        record('apiKey passthrough chat success', fullText.trim().length > 0);
      } catch (e) {
        record('apiKey passthrough chat', false);
        console.error(e);
      }
    } else {
      info('Skipping apiKey passthrough e2e (CURSOR_API_KEY not set)');
    }

    // ╔════════════════════════════════════════════════════════╗
    // ║  PART 2: Embedded scenarios — Coding Agent everywhere ║
    // ║  Same API, completely different product forms          ║
    // ╚════════════════════════════════════════════════════════╝

    console.log(`\n${MAGENTA}${BOLD}  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
    console.log(`${MAGENTA}${BOLD}  PART 2: Embedded scenarios — same API, IM / CI / data pipeline${RESET}`);
    console.log(`${MAGENTA}${BOLD}  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);

    // ── Scenario A: IM bot backend ────────────────────────

    console.log(`\n${BOLD}${CYAN}  ▸ Scenario A: Feishu/Slack customer service bot${RESET}`);
    console.log(`${DIM}    Simulate: webhook receives IM message → createAssistant().chat() → reply${RESET}`);

    const imDir = await mkdtemp(join(tmpdir(), 'golem-im-bot-'));
    dirsToClean.push(imDir);
    const imBot = createAssistant({ dir: imDir });

    step('IM Bot — init customer service bot');

    try {
      await imBot.init({ engine: 'cursor', name: 'im-support-bot' });

      const skillDir = join(imDir, 'skills', 'im-bot');
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, 'SKILL.md'), IM_BOT_SKILL, 'utf-8');
      await writeFile(join(imDir, 'faq.md'), PRODUCT_FAQ, 'utf-8');
      info('Configured IM customer service Skill + FAQ');

      const files = await readdir(imDir);
      record('IM Bot workspace ready', files.includes('golem.yaml') && files.includes('faq.md'));
    } catch (e) {
      record('IM Bot init', false);
      console.error(e);
    }

    step('IM Bot — handle user inquiry (simulate Feishu webhook)');

    try {
      // Simulate first user message — JSON from Feishu webhook already parsed to text
      const { fullText: r1 } = await collectChat(
        imBot,
        '[User:XiaoMing] Hi, my Bluetooth earphones are broken, how long is the warranty?',
      );
      record('IM: correct warranty reply', r1.includes('6') || r1.toLowerCase().includes('month'));

      // Same session second user
      const { fullText: r2, events } = await collectChat(
        imBot,
        '[User:XiaoHong] I want to return, what is the process?',
      );
      record('IM: correct return policy reply', r2.includes('7') || r2.includes('return'));

      // Verify bot wrote chat log
      const chatLogExists = await fileExists(join(imDir, 'chat-log.md'));
      record('IM: auto-generated chat-log.md', chatLogExists);

      if (chatLogExists) {
        const log = await readFile(join(imDir, 'chat-log.md'), 'utf-8');
        info(`chat-log.md first 100 chars: "${log.trim().slice(0, 100)}..."`);
      }
    } catch (e) {
      record('IM Bot chat', false);
      console.error(e);
    }

    // ── Scenario B: CI/CD code review ──────────────────────

    console.log(`\n${BOLD}${CYAN}  ▸ Scenario B: CI/CD code review pipeline${RESET}`);
    console.log(`${DIM}    Simulate: git push → CI triggers → createAssistant().chat() → review report${RESET}`);

    const ciDir = await mkdtemp(join(tmpdir(), 'golem-ci-review-'));
    dirsToClean.push(ciDir);
    const reviewBot = createAssistant({ dir: ciDir });

    step('Code Review — init review bot');

    try {
      await reviewBot.init({ engine: 'cursor', name: 'ci-review-bot' });

      const skillDir = join(ciDir, 'skills', 'code-reviewer');
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, 'SKILL.md'), CODE_REVIEWER_SKILL, 'utf-8');

      await writeFile(join(ciDir, 'user-service.ts'), BUGGY_CODE, 'utf-8');
      info('Seeded user-service.ts (contains SQL injection etc)');

      record('CI Bot workspace ready', await fileExists(join(ciDir, 'user-service.ts')));
    } catch (e) {
      record('CI Bot init', false);
      console.error(e);
    }

    step('Code Review — review code and output report');

    try {
      const { events, fullText } = await collectChat(
        reviewBot,
        'Review user-service.ts for security or code quality issues and write a report',
      );

      record('CI: Agent used tools to read code', events.some(e => e.type === 'tool_call'));

      const foundSqlInjection =
        fullText.toLowerCase().includes('sql') ||
        fullText.toLowerCase().includes('inject') ||
        fullText.includes('injection') ||
        fullText.includes('concatenat');
      record('CI: found SQL injection', foundSqlInjection);

      // Agent should write review report per Skill (filename may be review-report.md or other)
      const ciFiles = await readdir(ciDir);
      const reportFile = ciFiles.find(f => f.endsWith('.md') && f !== 'AGENTS.md' && f !== 'golem.yaml');
      const reportExists = !!reportFile;
      record('CI: generated review report file', reportExists);

      if (reportExists) {
        const report = await readFile(join(ciDir, reportFile!), 'utf-8');
        info(`${reportFile} first 150 chars:\n    "${report.trim().slice(0, 150)}..."`);
        record('CI: report has structured content', report.includes('#') || report.includes('issue') || report.includes('Review') || report.includes('SQL'));
      }
    } catch (e) {
      record('Code Review', false);
      console.error(e);
    }

    // ── Scenario C: Data processing pipeline ──────────────────────

    console.log(`\n${BOLD}${CYAN}  ▸ Scenario C: Scheduled data processing pipeline${RESET}`);
    console.log(`${DIM}    Simulate: cron job → createAssistant().chat() → read data → run script → write report${RESET}`);

    const pipeDir = await mkdtemp(join(tmpdir(), 'golem-pipeline-'));
    dirsToClean.push(pipeDir);
    const pipeBot = createAssistant({ dir: pipeDir });

    step('Pipeline — init data processing assistant');

    try {
      await pipeBot.init({ engine: 'cursor', name: 'data-pipeline-bot' });

      const analystDir = join(pipeDir, 'skills', 'data-analyst');
      await mkdir(analystDir, { recursive: true });
      await writeFile(join(analystDir, 'SKILL.md'), DATA_ANALYST_SKILL, 'utf-8');

      const calcDir = join(pipeDir, 'skills', 'calc-tool');
      await mkdir(calcDir, { recursive: true });
      await writeFile(join(calcDir, 'SKILL.md'), CALC_SKILL_MD, 'utf-8');
      await writeFile(join(calcDir, 'calc.py'), CALC_PY, 'utf-8');

      await writeFile(join(pipeDir, 'sales.csv'), SALES_CSV, 'utf-8');
      info('Configured: data-analyst Skill + calc-tool Skill + sales.csv');

      record('Pipeline workspace ready', await fileExists(join(pipeDir, 'sales.csv')));
    } catch (e) {
      record('Pipeline init', false);
      console.error(e);
    }

    step('Pipeline — single command: read data → run script → write report');

    try {
      const { events, fullText } = await collectChat(
        pipeBot,
        'Analyze sales.csv and give me a complete analysis report',
      );

      const usedTools = events.filter(e => e.type === 'tool_call').length;
      record(`Pipeline: invoked ${usedTools} tools`, usedTools >= 2);

      // Agent may write report to file or output directly in reply
      const pipeFiles = await readdir(pipeDir);
      const reportFile = pipeFiles.find(f => f.endsWith('.md') && f !== 'AGENTS.md');
      const hasDataInReply =
        fullText.includes('177') || fullText.includes('17.7') ||
        fullText.includes('Phone Case') || fullText.includes('Smart Watch') ||
        fullText.includes('sale') || fullText.includes('revenue');
      record('Pipeline: analysis has concrete data (file or reply)', hasDataInReply || !!reportFile);

      if (reportFile) {
        const report = await readFile(join(pipeDir, reportFile!), 'utf-8');
        info(`${reportFile} first 150 chars:\n    "${report.trim().slice(0, 150)}..."`);
      } else {
        info(`Agent output report in reply (first 100 chars: "${fullText.trim().slice(0, 100)}...")`);
      }
    } catch (e) {
      record('Pipeline run', false);
      console.error(e);
    }

    // ╔════════════════════════════════════════════════════════╗
    // ║  PART 3: Multi-instance isolation verification        ║
    // ║  Prove different Agent roles can run on same machine   ║
    // ╚════════════════════════════════════════════════════════╝

    console.log(`\n${MAGENTA}${BOLD}  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
    console.log(`${MAGENTA}${BOLD}  PART 3: Multi-instance isolation — different dir = different Agent${RESET}`);
    console.log(`${MAGENTA}${BOLD}  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);

    step('Multi-instance — verify IM Bot / CI Bot / Pipeline Bot isolated');

    try {
      const imFiles = await readdir(imDir);
      const ciFiles = await readdir(ciDir);
      const pipeFiles = await readdir(pipeDir);

      info(`IM Bot dir: ${imFiles.join(', ')}`);
      info(`CI Bot dir: ${ciFiles.join(', ')}`);
      info(`Pipeline dir: ${pipeFiles.join(', ')}`);

      record('IM Bot has faq.md (CI/Pipeline do not)',
        imFiles.includes('faq.md') && !ciFiles.includes('faq.md') && !pipeFiles.includes('faq.md'));
      record('CI Bot has user-service.ts (IM/Pipeline do not)',
        ciFiles.includes('user-service.ts') && !imFiles.includes('user-service.ts'));
      record('Pipeline has sales.csv (CI does not)',
        pipeFiles.includes('sales.csv') && !ciFiles.includes('sales.csv'));

      const imAgents = await readFile(join(imDir, 'AGENTS.md'), 'utf-8');
      const ciAgents = await readFile(join(ciDir, 'AGENTS.md'), 'utf-8');
      const pipeAgents = await readFile(join(pipeDir, 'AGENTS.md'), 'utf-8');
      record('Each instance AGENTS.md has its Skill',
        imAgents.includes('im-bot') &&
        ciAgents.includes('code-reviewer') &&
        pipeAgents.includes('data-analyst'));
    } catch (e) {
      record('Multi-instance isolation', false);
      console.error(e);
    }

    // ╔════════════════════════════════════════════════════════╗
    // ║  PART 4: HTTP service — golembot serve end-to-end     ║
    // ║  Verify IM webhook can hit GolemBot HTTP service       ║
    // ╚════════════════════════════════════════════════════════╝

    console.log(`\n${MAGENTA}${BOLD}  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
    console.log(`${MAGENTA}${BOLD}  PART 4: HTTP service — golembot serve + multi-user sessionKey${RESET}`);
    console.log(`${MAGENTA}${BOLD}  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);

    const httpDir = await mkdtemp(join(tmpdir(), 'golem-http-'));
    dirsToClean.push(httpDir);
    let httpServer: http.Server | undefined;

    try {
      step('HTTP — init assistant + start service');

      const httpBot = createAssistant({ dir: httpDir });
      await httpBot.init({ engine: 'cursor', name: 'http-bot' });
      await writeFile(join(httpDir, 'sales.csv'), SALES_CSV, 'utf-8');
      info('Initialized http-bot + seeded sales.csv');

      const token = 'test-secret-token';
      httpServer = createGolemServer(httpBot, { token });
      const port = await new Promise<number>((resolve) => {
        httpServer!.listen(0, '127.0.0.1', () => {
          const addr = httpServer!.address() as { port: number };
          resolve(addr.port);
        });
      });
      info(`HTTP service at http://127.0.0.1:${port}`);
      record('HTTP service started', true);

      // ── Health check ─────────────────────────────

      step('HTTP — Health check (no auth)');

      try {
        const healthRes = await new Promise<{ status: number; body: string }>((resolve, reject) => {
          http.get(`http://127.0.0.1:${port}/health`, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (c: Buffer) => chunks.push(c));
            res.on('end', () => resolve({ status: res.statusCode!, body: Buffer.concat(chunks).toString() }));
          }).on('error', reject);
        });
        record('GET /health returns 200', healthRes.status === 200);
        record('/health contains status:ok', healthRes.body.includes('"ok"'));
      } catch (e) {
        record('Health check', false);
        console.error(e);
      }

      // ── Auth ──────────────────────────────────────

      step('HTTP — Bearer token auth');

      try {
        const noAuth = await httpChat(port, 'hello');
        record('No token → 401', noAuth.status === 401);

        const wrongAuth = await httpChat(port, 'hello', undefined, 'wrong-token');
        record('Wrong token → 401', wrongAuth.status === 401);

        const goodAuth = await httpChat(port, 'Reply OK', undefined, token);
        record('Correct token → 200 + SSE stream', goodAuth.status === 200 && goodAuth.events.length > 0);
      } catch (e) {
        record('Auth verification', false);
        console.error(e);
      }

      // ── Multi-user via sessionKey ────────────────

      step('HTTP — multi-user sessionKey (simulate IM)');

      try {
        console.log(`  ${YELLOW}Simulate: Feishu users A and B send messages to same bot${RESET}\n`);

        const resA = await httpChat(port, 'Read sales.csv, how many rows? Reply with number only', 'feishu:userA', token);
        info(`UserA reply: "${resA.fullText.trim().slice(0, 80)}"`);
        record('UserA: got reply', resA.events.some(e => e.type === 'text'));

        const resB = await httpChat(port, '1+1=? Reply with number only', 'feishu:userB', token);
        info(`UserB reply: "${resB.fullText.trim().slice(0, 80)}"`);
        record('UserB: got reply', resB.events.some(e => e.type === 'text'));

        // Verify sessions are isolated
        const sessRaw = await readFile(join(httpDir, '.golem', 'sessions.json'), 'utf-8');
        const sessions = JSON.parse(sessRaw);
        record('UserA has own session', !!sessions['feishu:userA']?.engineSessionId);
        record('UserB has own session', !!sessions['feishu:userB']?.engineSessionId);
        record('Two sessions differ',
          sessions['feishu:userA']?.engineSessionId !== sessions['feishu:userB']?.engineSessionId);
        info(`sessions.json keys: ${Object.keys(sessions).join(', ')}`);
      } catch (e) {
        record('Multi-user sessionKey', false);
        console.error(e);
      }

      // ── Reset via HTTP ────────────────────────────

      step('HTTP — POST /reset clears specified user session');

      try {
        const resetRes = await httpPost(port, '/reset', { sessionKey: 'feishu:userA' }, token);
        record('POST /reset returns 200', resetRes.status === 200);

        const sessRaw = await readFile(join(httpDir, '.golem', 'sessions.json'), 'utf-8');
        const sessions = JSON.parse(sessRaw);
        record('UserA session cleared', !sessions['feishu:userA']);
        record('UserB session unaffected', !!sessions['feishu:userB']?.engineSessionId);
      } catch (e) {
        record('HTTP reset', false);
        console.error(e);
      }

    } catch (e) {
      record('HTTP service scenario', false);
      console.error(e);
    } finally {
      if (httpServer?.listening) {
        await new Promise<void>(r => httpServer!.close(() => r()));
        info('HTTP service closed');
      }
    }

    // ╔════════════════════════════════════════════════════════╗
    // ║  PART 5: systemPrompt injection                         ║
    // ╚════════════════════════════════════════════════════════╝

    console.log(`\n${MAGENTA}${BOLD}  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
    console.log(`${MAGENTA}${BOLD}  PART 5: systemPrompt — injected into AGENTS.md, not prepended to message${RESET}`);
    console.log(`${MAGENTA}${BOLD}  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);

    const spDir = await mkdtemp(join(tmpdir(), 'golem-cur-sp-'));
    dirsToClean.push(spDir);

    step('systemPrompt — injected into AGENTS.md as System Instructions section');

    try {
      const spBot = createAssistant({ dir: spDir });
      await spBot.init({ engine: 'cursor', name: 'sp-test-bot' });

      await writeFile(
        join(spDir, 'golem.yaml'),
        'name: sp-test-bot\nengine: cursor\nsystemPrompt: "You are a specialized bot named GolemTest."\n',
      );

      await collectChat(spBot, 'Reply OK in one word');

      const agentsMd = await readFile(join(spDir, 'AGENTS.md'), 'utf-8');
      record('AGENTS.md contains System Instructions section', agentsMd.includes('## System Instructions'));
      record('AGENTS.md contains systemPrompt content', agentsMd.includes('GolemTest'));
    } catch (e) {
      record('systemPrompt injection', false);
      console.error(e);
    }

  } finally {
    // ── Cleanup ────────────────────────────────────

    step('Cleanup — remove all temp directories');

    for (const d of dirsToClean) {
      try {
        await rm(d, { recursive: true, force: true });
        ok(`Deleted ${d}`);
      } catch (e) {
        fail(`Cleanup failed ${d}: ${e}`);
      }
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
    console.log(`\n${DIM}  Core narrative verified:`);
    console.log(`    createAssistant({ dir })              → library import, embed in any scenario`);
    console.log(`    golembot serve --port 3000            → HTTP service, any webhook direct`);
    console.log(`    chat(msg, { sessionKey: "user:X" })   → multi-user isolation, no extra config`);
    console.log(`    Same engine × different Skills × different integrations = infinite possibilities.${RESET}\n`);

    if (passed < total) {
      process.exit(1);
    }
  }
}

main().catch((e) => {
  console.error(`\n${RED}Fatal error:${RESET}`, e);
  process.exit(1);
});
