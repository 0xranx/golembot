#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import type { CommandContext } from './commands.js';
import { createAssistant } from './index.js';

// Read version from package.json at runtime
const __filename_cli = fileURLToPath(import.meta.url);
const __dirname_cli = dirname(__filename_cli);
const pkgVersion: string = JSON.parse(readFileSync(join(__dirname_cli, '..', 'package.json'), 'utf-8')).version;

// Auto-load .env from cwd (no dependencies, does not overwrite existing vars)
try {
  for (const line of readFileSync(resolve('.', '.env'), 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes: "value" → value, 'value' → value
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (val && !process.env[key]) process.env[key] = val;
  }
} catch {
  /* .env not found — rely on existing env vars */
}

const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

// ── Welcome box renderer ──────────────────────
const BOX_WIDTH = 52;

function boxLine(content: string, rawLen?: number): string {
  const len = rawLen ?? stripAnsiLen(content);
  const pad = BOX_WIDTH - 2 - len; // 2 for "  " left margin
  return `  │  ${content}${' '.repeat(Math.max(0, pad))}│`;
}

function stripAnsiLen(s: string): number {
  return s.replace(/\x1b\[[^a-zA-Z]*[a-zA-Z]/g, '').length;
}

function renderBox(lines: string[]): string {
  const top = `  ╭${'─'.repeat(BOX_WIDTH)}╮`;
  const bot = `  ╰${'─'.repeat(BOX_WIDTH)}╯`;
  const empty = boxLine('', 0);
  const body = lines.map((l) => (l === '' ? empty : boxLine(l)));
  return [top, empty, ...body, empty, bot].join('\n');
}

function renderTitleLine(version: string): string {
  const left = `${BOLD}${CYAN}◈ GolemBot${RESET}`;
  const right = `${DIM}v${version}${RESET}`;
  const leftRaw = '◈ GolemBot';
  const rightRaw = `v${version}`;
  const gap = BOX_WIDTH - 2 - leftRaw.length - rightRaw.length;
  return `${left}${' '.repeat(Math.max(1, gap))}${right}`;
}

function centerArt(line: string, rawLen: number): string {
  const pad = Math.floor((BOX_WIDTH - 2 - rawLen) / 2);
  const content = ' '.repeat(pad) + line;
  return content;
}

function golemArt(): string[] {
  const y = YELLOW,
    c = CYAN,
    d = DIM,
    b = BOLD,
    r = RESET;
  // 13 chars wide — blocky stone golem face matching the GolemBot icon
  return [
    centerArt(`${y}▄███████████▄${r}`, 13),
    centerArt(`${y}█${r} ${d}╲╱${r}    ${d}╳╲${r}  ${y}█${r}`, 13),
    centerArt(`${y}█${r}  ${c}${b}▐█▌${r} ${c}${b}▐█▌${r}  ${y}█${r}`, 13),
    centerArt(`${y}█${r}    ${d}─────${r}  ${y}█${r}`, 13),
    centerArt(`${y}▀███████████▀${r}`, 13),
  ];
}

// ── Spinner (zero-dependency, stderr-only) ──────────────
class Spinner {
  private frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  private idx = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  start(label = 'Thinking') {
    if (this.timer) return;
    this.idx = 0;
    this.timer = setInterval(() => {
      const frame = this.frames[this.idx % this.frames.length];
      process.stderr.write(`\r${DIM}${frame} ${label}${RESET}  `);
      this.idx++;
    }, 80);
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    process.stderr.write('\r\x1b[K'); // clear line
  }
}

const program = new Command();

program
  .name('golembot')
  .description('Local-first AI assistant powered by Coding Agent engines')
  .version(pkgVersion)
  .action(() => {
    const art = golemArt();
    const title = renderTitleLine(pkgVersion);
    const tagline = `${DIM}Your Coding Agent, Everywhere${RESET}`;
    const cmds = [
      [`${BOLD}golembot onboard${RESET}`, 'Setup wizard'],
      [`${BOLD}golembot run${RESET}`, 'Start chatting'],
      [`${BOLD}golembot gateway${RESET}`, 'IM + HTTP service'],
      [`${BOLD}golembot fleet ls${RESET}`, 'List running bots'],
      [`${BOLD}golembot doctor${RESET}`, 'Check system setup'],
      [`${BOLD}golembot --help${RESET}`, 'All commands'],
    ];
    const cmdLines = cmds.map(([cmd, desc]) => {
      const cmdRaw = cmd.replace(/\x1b\[[^a-zA-Z]*[a-zA-Z]/g, '');
      const gap = 20 - cmdRaw.length;
      return `${cmd}${' '.repeat(Math.max(1, gap))}${DIM}${desc}${RESET}`;
    });
    console.log(`\n${renderBox([...art, '', title, tagline, '', ...cmdLines])}\n`);
  });

program
  .command('init')
  .description('Initialize a new GolemBot assistant in the current directory')
  .option('-e, --engine <engine>', 'engine type (cursor | claude-code | opencode | codex)', 'cursor')
  .option('-n, --name <name>', 'assistant name')
  .action(async (opts) => {
    const dir = resolve('.');
    let engine: string = opts.engine;
    let name: string = opts.name;

    if (!name) {
      const inquirer = await import('inquirer');
      const answers = await inquirer.default.prompt([
        {
          type: 'list',
          name: 'engine',
          message: 'Select AI engine:',
          choices: [
            { name: 'Cursor', value: 'cursor' },
            { name: 'Claude Code', value: 'claude-code' },
            { name: 'OpenCode', value: 'opencode' },
            { name: 'Codex', value: 'codex' },
          ],
          default: engine,
        },
        {
          type: 'input',
          name: 'name',
          message: 'Name your assistant:',
          default: 'my-assistant',
        },
      ]);
      engine = answers.engine;
      name = answers.name;
    }

    const assistant = createAssistant({ dir });
    try {
      await assistant.init({ engine, name });
      console.log(`\n✅ GolemBot assistant created!`);
      console.log(`   Directory: ${dir}`);
      console.log(`   Engine: ${engine}`);
      console.log(`   Name: ${name}`);
      console.log(`\nRun golembot run to start chatting.`);
    } catch (e: unknown) {
      console.error(`❌ Initialization failed: ${(e as Error).message}`);
      process.exit(1);
    }
  });

program
  .command('run')
  .description('Start a REPL conversation with the assistant')
  .option('-d, --dir <dir>', 'assistant directory', '.')
  .option('--api-key <key>', 'Agent API key (CURSOR_API_KEY / ANTHROPIC_API_KEY / OPENROUTER_API_KEY etc.)')
  .action(async (opts) => {
    const { formatToolCall } = await import('./cli-utils.js');
    const dir = resolve(opts.dir);
    const assistant = createAssistant({ dir, apiKey: opts.apiKey });

    // ── Welcome banner ──
    {
      const { loadConfig, scanSkills } = await import('./workspace.js');
      try {
        const config = await loadConfig(dir);
        const skills = await scanSkills(dir);
        const art = golemArt();
        const title = renderTitleLine(pkgVersion);
        const infoLines: string[] = [];

        const label = (k: string, v: string) => {
          const gap = 12 - k.length;
          return `${DIM}${k}${RESET}${' '.repeat(Math.max(1, gap))}${v}`;
        };
        infoLines.push(label('Name', `${BOLD}${config.name}${RESET}`));
        infoLines.push(label('Engine', config.engine + (config.model ? ` ${DIM}(${config.model})${RESET}` : '')));
        if (skills.length > 0) {
          const maxValLen = BOX_WIDTH - 2 - 12 - 2; // box - margin - label - padding
          let skillStr = skills.map((s) => s.name).join(', ');
          if (skillStr.length > maxValLen) skillStr = `${skillStr.slice(0, maxValLen - 1)}\u2026`;
          infoLines.push(label('Skills', skillStr));
        }
        const shortDir = dir.replace(process.env.HOME ?? '', '~');
        infoLines.push(label('cwd', `${DIM}${shortDir}${RESET}`));

        const hint = `${DIM}/help${RESET} for commands`;
        console.log(`\n${renderBox([...art, '', title, '', ...infoLines, '', hint])}\n`);
      } catch {
        console.log('GolemBot assistant started (type /help for commands)\n');
      }
    }

    const { parseCommand, executeCommand } = await import('./commands.js');

    const SLASH_CMDS = ['/help', '/status', '/engine', '/model', '/skill', '/reset', '/quit', '/exit'];
    const completer = (line: string): [string[], string] => {
      const hits = SLASH_CMDS.filter((c) => c.startsWith(line));
      return [hits.length ? hits : SLASH_CMDS, line];
    };

    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      historySize: 200,
      completer,
    });
    let isClosing = false;
    rl.on('close', () => {
      isClosing = true;
    });

    const spinner = new Spinner();

    const cmdCtx: CommandContext = {
      dir,
      getStatus: () => assistant.getStatus(),
      setEngine: (e, c) => assistant.setEngine(e, c),
      setModel: (m) => assistant.setModel(m),
      resetSession: (k) => assistant.resetSession(k),
      listModels: () => assistant.listModels(),
    };

    const doPrompt = () => {
      if (isClosing) return;
      rl.question('> ', async (input) => {
        if (isClosing) return;
        const trimmed = input.trim();
        if (!trimmed) return doPrompt();

        if (trimmed === '/quit' || trimmed === '/exit') {
          isClosing = true;
          console.log('Bye!');
          rl.close();
          process.exit(0);
        }

        // Slash command handling via shared commands module
        const parsed = parseCommand(trimmed);
        if (parsed) {
          const result = await executeCommand(parsed, cmdCtx);
          if (result) {
            console.log(`\n${result.text}\n`);
            return doPrompt();
          }
        }

        // Multi-line input mode
        let userMessage = trimmed;
        if (trimmed === '"""') {
          const lines: string[] = [];
          const collectLine = (): Promise<string> => new Promise((r) => rl.question('... ', r));
          while (true) {
            const line = await collectLine();
            if (line.trim() === '"""') break;
            lines.push(line);
          }
          userMessage = lines.join('\n');
          if (!userMessage.trim()) return doPrompt();
        }

        try {
          spinner.start();
          for await (const event of assistant.chat(userMessage)) {
            switch (event.type) {
              case 'text':
                spinner.stop();
                process.stdout.write(event.content);
                break;
              case 'tool_call':
                spinner.stop();
                process.stdout.write(`\n${DIM}🔧 ${formatToolCall(event.name, event.args)}${RESET}\n`);
                spinner.start();
                break;
              case 'tool_result':
                spinner.stop();
                process.stdout.write(`${DIM}  ✓ done${RESET}\n`);
                spinner.start();
                break;
              case 'warning':
                spinner.stop();
                process.stdout.write(`${YELLOW}⚠ ${event.message}${RESET}\n`);
                break;
              case 'error':
                spinner.stop();
                console.error(`\n❌ ${event.message}`);
                break;
              case 'done': {
                spinner.stop();
                const parts: string[] = [];
                if (event.durationMs) parts.push(`${(event.durationMs / 1000).toFixed(1)}s`);
                if (event.costUsd != null) parts.push(`$${event.costUsd.toFixed(4)}`);
                if (parts.length > 0) {
                  process.stdout.write(`\n${DIM}(${parts.join(' | ')})${RESET}\n`);
                } else {
                  process.stdout.write('\n');
                }
                break;
              }
            }
          }
        } catch (e: unknown) {
          spinner.stop();
          console.error(`\n❌ Error: ${(e as Error).message}`);
        }

        console.log();
        if (!isClosing) doPrompt();
      });
    };

    doPrompt();
  });

program
  .command('serve')
  .description('Start an HTTP server for the assistant (SSE streaming)')
  .option('-d, --dir <dir>', 'assistant directory', '.')
  .option('-p, --port <port>', 'port number', '3000')
  .option('-t, --token <token>', 'bearer token for authentication')
  .option('--host <host>', 'hostname to bind', '127.0.0.1')
  .option('--api-key <key>', 'Agent API key (CURSOR_API_KEY / ANTHROPIC_API_KEY / OPENROUTER_API_KEY etc.)')
  .action(async (opts) => {
    const dir = resolve(opts.dir);
    const assistant = createAssistant({ dir, apiKey: opts.apiKey });
    const { startServer } = await import('./server.js');
    await startServer(
      assistant,
      {
        port: Number(opts.port),
        token: opts.token,
        hostname: opts.host,
      },
      dir,
    );
  });

program
  .command('gateway')
  .description('Start the Gateway service (HTTP API + IM channels)')
  .option('-d, --dir <dir>', 'assistant directory', '.')
  .option('-p, --port <port>', 'port number')
  .option('-t, --token <token>', 'bearer token for authentication')
  .option('--host <host>', 'hostname to bind')
  .option('--api-key <key>', 'Agent API key')
  .option('--verbose', 'enable verbose logging')
  .action(async (opts) => {
    const { startGateway } = await import('./gateway.js');
    await startGateway({
      dir: resolve(opts.dir),
      port: opts.port ? Number(opts.port) : undefined,
      host: opts.host,
      token: opts.token,
      apiKey: opts.apiKey,
      verbose: opts.verbose ?? false,
    });
  });

program
  .command('onboard')
  .description('Interactive onboarding wizard to configure a new assistant')
  .option('-d, --dir <dir>', 'assistant directory', '.')
  .option(
    '--template <name>',
    'pre-select a template (customer-support, data-analyst, code-reviewer, ops-assistant, meeting-notes, research)',
  )
  .action(async (opts) => {
    const { runOnboard } = await import('./onboard.js');
    await runOnboard({ dir: resolve(opts.dir), template: opts.template });
  });

program
  .command('status')
  .description('Show the current assistant status')
  .option('-d, --dir <dir>', 'assistant directory', '.')
  .option('--json', 'output JSON (agent-friendly)')
  .action(async (opts: { dir: string; json?: boolean }) => {
    const dir = resolve(opts.dir);
    const { loadConfig, scanSkills } = await import('./workspace.js');
    const { countSessions } = await import('./session.js');
    try {
      const config = await loadConfig(dir);
      const skills = await scanSkills(dir);
      const sessionCount = await countSessions(dir);
      const channelNames = config.channels
        ? Object.keys(config.channels).filter((k) => !!(config.channels as any)[k])
        : [];

      if (opts.json) {
        console.log(
          JSON.stringify({
            name: config.name,
            engine: config.engine,
            model: config.model ?? null,
            skills: skills.map((s) => ({ name: s.name, description: s.description })),
            sessions: sessionCount,
            channels: channelNames,
            gateway: config.gateway ? { port: config.gateway.port ?? 3000, authEnabled: !!config.gateway.token } : null,
            directory: dir,
          }),
        );
        return;
      }

      console.log(`\n🤖 GolemBot Assistant Status\n`);
      console.log(`   Name:       ${config.name}`);
      console.log(`   Engine:     ${config.engine}`);
      if (config.model) console.log(`   Model:      ${config.model}`);
      console.log(`   Skills:     ${skills.length > 0 ? skills.map((s) => s.name).join(', ') : '(none)'}`);
      console.log(`   Sessions:   ${sessionCount}`);
      console.log(`   Channels:   ${channelNames.length > 0 ? channelNames.join(', ') : '(none)'}`);
      if (config.gateway) {
        const gw = config.gateway;
        console.log(`   Gateway:    port ${gw.port ?? 3000}${gw.token ? ', auth enabled' : ''}`);
      }
      console.log(`   Directory:  ${dir}`);
      console.log();
    } catch (e: unknown) {
      if (opts.json) {
        console.log(JSON.stringify({ error: (e as Error).message }));
        process.exit(1);
      }
      console.error(`❌ Failed to read assistant status: ${(e as Error).message}`);
      console.error(
        `   Make sure the current directory contains golem.yaml, or use -d to specify the assistant directory.`,
      );
      process.exit(1);
    }
  });

const skill = program.command('skill').description('Manage skills in the assistant directory');

skill
  .command('list')
  .description('List installed skills')
  .option('-d, --dir <dir>', 'assistant directory', '.')
  .option('--json', 'output JSON (agent-friendly)')
  .action(async (opts: { dir: string; json?: boolean }) => {
    const dir = resolve(opts.dir);
    const { scanSkills } = await import('./workspace.js');
    const skills = await scanSkills(dir);
    if (opts.json) {
      console.log(JSON.stringify(skills.map((s) => ({ name: s.name, description: s.description }))));
      return;
    }
    if (skills.length === 0) {
      console.log('(no skills installed)');
      return;
    }
    console.log(`\nInstalled skills (${skills.length}):\n`);
    for (const s of skills) {
      console.log(`  ${s.name.padEnd(20)} ${DIM}${s.description}${RESET}`);
    }
    console.log();
  });

skill
  .command('search <query...>')
  .description('Search for skills on ClawHub')
  .option('-l, --limit <n>', 'max results', '10')
  .option('--json', 'output JSON (agent-friendly)')
  .action(async (queryWords: string[], opts: { limit: string; json?: boolean }) => {
    const { getRegistry } = await import('./registry.js');
    const registry = getRegistry('clawhub');
    if (!registry) {
      console.error('No registry available');
      process.exit(1);
    }

    if (!registry.isAvailable()) {
      console.error('clawhub CLI not found. Install it: npm i -g clawhub');
      process.exit(1);
    }

    const query = queryWords.join(' ');
    const results = await registry.search(query, Number(opts.limit));

    if (opts.json) {
      console.log(JSON.stringify(results));
      return;
    }

    if (!results.length) {
      console.log(`No skills found for "${query}"`);
      return;
    }

    console.log(`\nClawHub results for "${query}" (${results.length}):\n`);
    for (const s of results) {
      const meta = [
        s.version ? `v${s.version}` : '',
        s.author ?? '',
        s.downloads != null ? `${s.downloads} installs` : '',
      ]
        .filter(Boolean)
        .join(' | ');
      console.log(`  ${s.slug.padEnd(30)} ${s.description ? s.description.slice(0, 60) : ''}`);
      if (meta) console.log(`  ${' '.repeat(30)} ${DIM}${meta}${RESET}`);
    }
    console.log(`\nInstall: golembot skill add clawhub:<slug>\n`);
  });

skill
  .command('add <source>')
  .description('Add a skill from a local path or registry (clawhub:<slug>)')
  .option('-d, --dir <dir>', 'assistant directory', '.')
  .option('--json', 'output JSON (agent-friendly)')
  .action(async (source: string, opts: { dir: string; json?: boolean }) => {
    const { stat: fsStat, cp } = await import('node:fs/promises');
    const { join, basename } = await import('node:path');
    const dir = resolve(opts.dir);

    // ── Registry remote install (prefix:slug) ──
    const registryMatch = source.match(/^(\w+):(.+)$/);
    if (registryMatch) {
      const [, registryName, slug] = registryMatch;
      const { getRegistry, listRegistries } = await import('./registry.js');
      const registry = getRegistry(registryName);

      if (!registry) {
        const msg = `Unknown registry: ${registryName}. Available: ${listRegistries().join(', ')}`;
        if (opts.json) {
          console.log(JSON.stringify({ ok: false, error: msg }));
        } else {
          console.error(`❌ ${msg}`);
        }
        process.exit(1);
      }

      if (!registry.isAvailable()) {
        const msg = `${registryName} CLI not found. Install it: npm i -g ${registryName}`;
        if (opts.json) {
          console.log(JSON.stringify({ ok: false, error: msg }));
        } else {
          console.error(`❌ ${msg}`);
        }
        process.exit(1);
      }

      const skillName = slug.includes('/') ? slug.split('/').pop()! : slug;
      const destPath = join(dir, 'skills', skillName);

      try {
        await fsStat(destPath);
        const msg = `Skill ${skillName} already exists. Run: golembot skill remove ${skillName}`;
        if (opts.json) {
          console.log(JSON.stringify({ ok: false, error: msg }));
        } else {
          console.error(`❌ ${msg}`);
        }
        process.exit(1);
      } catch {
        // doesn't exist — good
      }

      try {
        const meta = await registry.install(slug, destPath);
        if (opts.json) {
          console.log(JSON.stringify({ ok: true, name: meta.name, version: meta.version }));
        } else {
          console.log(`✅ Installed from ${registryName}: ${meta.name} (v${meta.version})`);
        }
      } catch (e: unknown) {
        const msg = (e as Error).message;
        if (opts.json) {
          console.log(JSON.stringify({ ok: false, error: msg }));
        } else {
          console.error(`❌ ${msg}`);
        }
        process.exit(1);
      }

      const { scanSkills, generateAgentsMd } = await import('./workspace.js');
      const skills = await scanSkills(dir);
      await generateAgentsMd(dir, skills);
      return;
    }

    // ── Local path install (existing logic) ──
    const srcPath = resolve(source);

    try {
      const s = await fsStat(srcPath);
      if (!s.isDirectory()) {
        console.error('❌ Source path must be a directory (containing SKILL.md)');
        process.exit(1);
      }
      const skillMd = join(srcPath, 'SKILL.md');
      await fsStat(skillMd);
    } catch {
      console.error(`❌ ${srcPath} does not exist or does not contain SKILL.md`);
      process.exit(1);
    }

    const skillName = basename(srcPath);
    const destPath = join(dir, 'skills', skillName);

    try {
      await fsStat(destPath);
      console.error(`❌ Skill ${skillName} already exists. Run golembot skill remove ${skillName} first.`);
      process.exit(1);
    } catch {
      // dest doesn't exist — good
    }

    await cp(srcPath, destPath, { recursive: true });
    if (opts.json) {
      console.log(JSON.stringify({ ok: true, name: skillName }));
    } else {
      console.log(`✅ Skill added: ${skillName}`);
    }

    const { scanSkills, generateAgentsMd } = await import('./workspace.js');
    const skills = await scanSkills(dir);
    await generateAgentsMd(dir, skills);
  });

skill
  .command('remove <name>')
  .description('Remove an installed skill')
  .option('-d, --dir <dir>', 'assistant directory', '.')
  .action(async (name: string, opts: { dir: string }) => {
    const { rm, stat: fsStat } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const dir = resolve(opts.dir);
    const skillPath = join(dir, 'skills', name);

    try {
      await fsStat(skillPath);
    } catch {
      console.error(`❌ Skill ${name} not found`);
      process.exit(1);
    }

    await rm(skillPath, { recursive: true, force: true });
    console.log(`✅ Skill removed: ${name}`);

    const { scanSkills, generateAgentsMd } = await import('./workspace.js');
    const skills = await scanSkills(dir);
    await generateAgentsMd(dir, skills);
  });

const fleet = program.command('fleet').description('Manage and view all running GolemBot instances');

fleet
  .command('serve')
  .description('Start the Fleet Dashboard web server')
  .option('-p, --port <port>', 'port number', '4000')
  .option('--host <host>', 'hostname to bind', '127.0.0.1')
  .action(async (opts) => {
    const { startFleetServer } = await import('./fleet.js');
    await startFleetServer({ port: Number(opts.port), hostname: opts.host });
  });

fleet
  .command('ls')
  .description('List all running bot instances')
  .option('--json', 'output JSON (agent-friendly)')
  .action(async (opts: { json?: boolean }) => {
    const { listInstances, listStoppedInstances, fetchInstanceMetrics } = await import('./fleet.js');
    const instances = await listInstances();
    const enriched = await Promise.all(instances.map(fetchInstanceMetrics));
    const stopped = await listStoppedInstances();

    if (opts.json) {
      console.log(JSON.stringify({ running: enriched, stopped }));
      return;
    }

    if (enriched.length === 0 && stopped.length === 0) {
      console.log('No running bots found. Start one with: golembot gateway');
      return;
    }

    if (enriched.length > 0) {
      console.log(`\n  ${BOLD}Running GolemBot Instances${RESET} (${enriched.length})\n`);
      for (const inst of enriched) {
        const engine = `${DIM}(${inst.engine})${RESET}`;
        const model = inst.model ? ` ${DIM}${inst.model}${RESET}` : '';
        const msgs = inst.metrics
          ? `${inst.metrics.totalMessages} msgs`
          : inst.authEnabled
            ? 'auth required'
            : 'unreachable';
        const port = new URL(inst.url).port || '3000';
        console.log(`  ${CYAN}●${RESET}  ${BOLD}${inst.name}${RESET} ${engine}${model}`);
        console.log(`     ${DIM}Port ${port} · PID ${inst.pid} · ${msgs}${RESET}`);
      }
    }

    if (stopped.length > 0) {
      console.log(`\n  ${BOLD}Stopped Instances${RESET} (${stopped.length})\n`);
      for (const inst of stopped) {
        const engine = `${DIM}(${inst.engine})${RESET}`;
        const port = new URL(inst.url).port || '3000';
        console.log(`  ${DIM}○${RESET}  ${BOLD}${inst.name}${RESET} ${engine}`);
        console.log(`     ${DIM}Port ${port} · ${inst.dir}${RESET}`);
      }
    }
    console.log();
  });

fleet
  .command('stop <name>')
  .description('Stop a running bot instance')
  .option('--json', 'output JSON (agent-friendly)')
  .action(async (name: string, opts: { json?: boolean }) => {
    const { findInstance, stopInstance } = await import('./fleet.js');
    try {
      const inst = await findInstance(name);
      if (!inst) {
        const msg = `Bot "${name}" not found. Run "golembot fleet ls" to see running bots.`;
        if (opts.json) {
          console.log(JSON.stringify({ ok: false, error: msg }));
        } else {
          console.error(`\u274c ${msg}`);
        }
        process.exit(1);
      }
      await stopInstance(inst);
      if (opts.json) {
        console.log(JSON.stringify({ ok: true, name: inst.name, pid: inst.pid }));
      } else {
        console.log(`\u2705 Stopped ${inst.name} (PID ${inst.pid})`);
      }
    } catch (e: unknown) {
      const msg = (e as Error).message;
      if (opts.json) {
        console.log(JSON.stringify({ ok: false, error: msg }));
      } else {
        console.error(`\u274c ${msg}`);
      }
      process.exit(1);
    }
  });

fleet
  .command('start <name>')
  .description('Start a previously stopped bot instance')
  .option('--json', 'output JSON (agent-friendly)')
  .action(async (name: string, opts: { json?: boolean }) => {
    const { findStoppedInstance, startInstance } = await import('./fleet.js');
    try {
      const entry = await findStoppedInstance(name);
      if (!entry) {
        const msg = `Stopped bot "${name}" not found. Run "golembot fleet ls" to see stopped bots.`;
        if (opts.json) {
          console.log(JSON.stringify({ ok: false, error: msg }));
        } else {
          console.error(`\u274c ${msg}`);
        }
        process.exit(1);
      }
      const result = await startInstance(entry);
      if (opts.json) {
        console.log(JSON.stringify({ ok: true, name: entry.name, pid: result.pid }));
      } else {
        console.log(`\u2705 Started ${entry.name} (PID ${result.pid})`);
      }
    } catch (e: unknown) {
      const msg = (e as Error).message;
      if (opts.json) {
        console.log(JSON.stringify({ ok: false, error: msg }));
      } else {
        console.error(`\u274c ${msg}`);
      }
      process.exit(1);
    }
  });

program
  .command('doctor')
  .description('Check system prerequisites for running GolemBot')
  .option('-d, --dir <dir>', 'assistant directory', '.')
  .action(async (opts) => {
    const { runDoctor } = await import('./doctor.js');
    await runDoctor(resolve(opts.dir));
  });

program.parse();
