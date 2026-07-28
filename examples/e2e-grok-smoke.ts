/**
 * Grok Build engine smoke test — real CLI invocation via createAssistant.
 *
 * Prerequisites:
 *   - `grok` on PATH
 *   - `grok login` or XAI_API_KEY
 *
 * Run:
 *   npx tsx examples/e2e-grok-smoke.ts
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAssistant, type StreamEvent } from '../dist/index.js';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

function ok(msg: string) {
  console.log(`${GREEN}  ✓ ${msg}${RESET}`);
}
function fail(msg: string) {
  console.log(`${RED}  ✗ ${msg}${RESET}`);
}
function info(msg: string) {
  console.log(`${DIM}  ${msg}${RESET}`);
}

async function collectChat(
  assistant: ReturnType<typeof createAssistant>,
  message: string,
  sessionKey = 'smoke-user',
): Promise<{ text: string; sessionId?: string; error?: string; events: StreamEvent[] }> {
  const events: StreamEvent[] = [];
  let text = '';
  let sessionId: string | undefined;
  let error: string | undefined;

  for await (const evt of assistant.chat(message, { sessionKey })) {
    events.push(evt);
    if (evt.type === 'text') text += evt.content;
    if (evt.type === 'done') sessionId = evt.sessionId;
    if (evt.type === 'error') error = evt.message;
    if (evt.type === 'tool_call') info(`tool_call: ${evt.name}`);
    if (evt.type === 'warning') info(`warning: ${evt.message}`);
  }

  return { text, sessionId, error, events };
}

async function main() {
  console.log(`\n${CYAN}${BOLD}GolemBot × Grok Build smoke test${RESET}\n`);

  const dir = await mkdtemp(join(tmpdir(), 'golem-grok-smoke-'));
  info(`workspace: ${dir}`);

  const results: Array<{ name: string; passed: boolean; detail?: string }> = [];
  const record = (name: string, passed: boolean, detail?: string) => {
    results.push({ name, passed, detail });
    if (passed) ok(detail ? `${name} — ${detail}` : name);
    else fail(detail ? `${name} — ${detail}` : name);
  };

  try {
    const assistant = createAssistant({
      dir,
      engine: 'grok',
      timeoutMs: 180_000,
    });

    await assistant.init({ engine: 'grok', name: 'grok-smoke-bot' });
    await writeFile(
      join(dir, 'golem.yaml'),
      'name: grok-smoke-bot\nengine: grok\n',
      'utf-8',
    );
    record('init', true, 'engine=grok workspace ready');

    // Turn 1: simple reply
    console.log(`\n${CYAN}── Turn 1: simple reply ──${RESET}`);
    const t0 = Date.now();
    const turn1 = await collectChat(
      assistant,
      'Reply with exactly the single word: PONG. No other text.',
    );
    const ms1 = Date.now() - t0;
    info(`duration: ${ms1}ms`);
    info(`events: ${turn1.events.map((e) => e.type).join(' → ')}`);
    if (turn1.error) info(`error: ${turn1.error}`);
    info(`text: ${JSON.stringify(turn1.text.trim().slice(0, 200))}`);
    info(`sessionId: ${turn1.sessionId ?? '(none)'}`);

    const turn1Ok =
      !turn1.error && turn1.text.trim().length > 0 && /pong/i.test(turn1.text);
    record('turn1 text reply', turn1Ok, turn1Ok ? `got "${turn1.text.trim().slice(0, 40)}"` : turn1.error || 'no PONG');
    record('turn1 sessionId', !!turn1.sessionId, turn1.sessionId);

    // Turn 2: resume multi-turn
    console.log(`\n${CYAN}── Turn 2: session resume ──${RESET}`);
    const t1 = Date.now();
    const turn2 = await collectChat(
      assistant,
      'What single word did I ask you to reply with in the previous message? Answer with that word only.',
    );
    const ms2 = Date.now() - t1;
    info(`duration: ${ms2}ms`);
    info(`events: ${turn2.events.map((e) => e.type).join(' → ')}`);
    if (turn2.error) info(`error: ${turn2.error}`);
    info(`text: ${JSON.stringify(turn2.text.trim().slice(0, 200))}`);
    info(`sessionId: ${turn2.sessionId ?? '(none)'}`);

    const turn2Ok = !turn2.error && turn2.text.trim().length > 0 && /pong/i.test(turn2.text);
    record(
      'turn2 resume memory',
      turn2Ok,
      turn2Ok ? `got "${turn2.text.trim().slice(0, 40)}"` : turn2.error || 'did not recall PONG',
    );
    if (turn1.sessionId && turn2.sessionId) {
      record('sessionId stable', turn1.sessionId === turn2.sessionId, turn2.sessionId);
    }

    // Optional: list models via engine
    console.log(`\n${CYAN}── listModels ──${RESET}`);
    try {
      const engine = (await import('../dist/engine.js')).createEngine('grok');
      if (engine.listModels) {
        const models = await engine.listModels({});
        info(`models: ${models.slice(0, 8).join(', ')}${models.length > 8 ? '…' : ''}`);
        record('listModels', models.length > 0, `${models.length} model(s)`);
      } else {
        record('listModels', false, 'not implemented');
      }
    } catch (e) {
      record('listModels', false, (e as Error).message);
    }
  } catch (e) {
    record('fatal', false, (e as Error).message);
    console.error(e);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`\n${BOLD}Summary: ${passed} passed, ${failed} failed${RESET}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
