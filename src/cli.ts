#!/usr/bin/env node

import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { createAssistant } from './index.js';

// Auto-load .env from cwd (no dependencies, does not overwrite existing vars)
try {
  for (const line of readFileSync(resolve('.', '.env'), 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (val && !process.env[key]) process.env[key] = val;
  }
} catch { /* .env not found — rely on existing env vars */ }

const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

const program = new Command();

program
  .name('golembot')
  .description('Local-first AI assistant powered by Coding Agent engines')
  .version('0.1.0');

program
  .command('init')
  .description('Initialize a new GolemBot assistant in the current directory')
  .option('-e, --engine <engine>', 'engine type (cursor | claude-code | opencode)', 'cursor')
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
    const dir = resolve(opts.dir);
    const assistant = createAssistant({ dir, apiKey: opts.apiKey });

    console.log('🤖 GolemBot assistant started (type /reset to reset session, /quit to exit)\n');

    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const prompt = () => {
      rl.question('> ', async (input) => {
        const trimmed = input.trim();
        if (!trimmed) return prompt();

        if (trimmed === '/quit' || trimmed === '/exit') {
          console.log('Bye!');
          rl.close();
          process.exit(0);
        }

        if (trimmed === '/reset') {
          await assistant.resetSession();
          console.log('Session reset.\n');
          return prompt();
        }

        try {
          for await (const event of assistant.chat(trimmed)) {
            switch (event.type) {
              case 'text':
                process.stdout.write(event.content);
                break;
              case 'tool_call':
                process.stdout.write(`\n🔧 ${event.name}\n`);
                break;
              case 'error':
                console.error(`\n❌ ${event.message}`);
                break;
              case 'done': {
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
          console.error(`\n❌ Error: ${(e as Error).message}`);
        }

        console.log();
        prompt();
      });
    };

    prompt();
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
    await startServer(assistant, {
      port: Number(opts.port),
      token: opts.token,
      hostname: opts.host,
    });
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
  .option('--template <name>', 'pre-select a template (customer-support, data-analyst, code-reviewer, ops-assistant, meeting-notes, research)')
  .action(async (opts) => {
    const { runOnboard } = await import('./onboard.js');
    await runOnboard({ dir: resolve(opts.dir), template: opts.template });
  });

program
  .command('status')
  .description('Show the current assistant status')
  .option('-d, --dir <dir>', 'assistant directory', '.')
  .action(async (opts) => {
    const dir = resolve(opts.dir);
    const { loadConfig, scanSkills } = await import('./workspace.js');
    try {
      const config = await loadConfig(dir);
      const skills = await scanSkills(dir);
      console.log(`\n🤖 GolemBot Assistant Status\n`);
      console.log(`   Name:       ${config.name}`);
      console.log(`   Engine:     ${config.engine}`);
      if (config.model) console.log(`   Model:      ${config.model}`);
      console.log(`   Skills:     ${skills.length > 0 ? skills.map(s => s.name).join(', ') : '(none)'}`);
      const channelNames = config.channels ? Object.keys(config.channels).filter(k => !!(config.channels as any)[k]) : [];
      console.log(`   Channels:   ${channelNames.length > 0 ? channelNames.join(', ') : '(none)'}`);
      if (config.gateway) {
        const gw = config.gateway;
        console.log(`   Gateway:    port ${gw.port ?? 3000}${gw.token ? ', auth enabled' : ''}`);
      }
      console.log(`   Directory:  ${dir}`);
      console.log();
    } catch (e: unknown) {
      console.error(`❌ Failed to read assistant status: ${(e as Error).message}`);
      console.error(`   Make sure the current directory contains golem.yaml, or use -d to specify the assistant directory.`);
      process.exit(1);
    }
  });

const skill = program
  .command('skill')
  .description('Manage skills in the assistant directory');

skill
  .command('list')
  .description('List installed skills')
  .option('-d, --dir <dir>', 'assistant directory', '.')
  .action(async (opts) => {
    const dir = resolve(opts.dir);
    const { scanSkills } = await import('./workspace.js');
    const skills = await scanSkills(dir);
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
  .command('add <source>')
  .description('Add a skill from a local path')
  .option('-d, --dir <dir>', 'assistant directory', '.')
  .action(async (source: string, opts: { dir: string }) => {
    const { stat: fsStat, cp, readFile: fsReadFile } = await import('node:fs/promises');
    const { join, basename } = await import('node:path');
    const dir = resolve(opts.dir);
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
    console.log(`✅ Skill added: ${skillName}`);

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

program.parse();
