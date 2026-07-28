import { existsSync } from 'node:fs';
import { cp, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createAssistant } from './index.js';
import type { ChannelsConfig, GolemConfig } from './workspace.js';

// ── Engine auth detection ────────────────────────────────

interface EngineAuthInfo {
  envVar: string; // primary env var name
  envVarHint: string; // placeholder hint (e.g. 'sk-ant-...')
  loginCmd?: string; // CLI login command, if supported
  loginDetail?: string; // description of login auth
}

const ENGINE_AUTH: Record<string, EngineAuthInfo> = {
  'claude-code': {
    envVar: 'ANTHROPIC_API_KEY',
    envVarHint: 'sk-ant-...',
    loginCmd: 'claude auth login',
    loginDetail: 'Anthropic OAuth',
  },
  codex: {
    envVar: 'CODEX_API_KEY',
    envVarHint: 'sk-...',
    loginCmd: 'codex login',
    loginDetail: 'ChatGPT OAuth (~/.codex/auth.json)',
  },
  cursor: {
    envVar: 'CURSOR_API_KEY',
    envVarHint: 'crsr_...',
    loginCmd: 'agent login',
    loginDetail: 'Cursor CLI login',
  },
  opencode: {
    envVar: 'OPENROUTER_API_KEY',
    envVarHint: 'sk-or-...',
    loginCmd: 'opencode auth login',
    loginDetail: 'OpenCode auth (~/.local/share/opencode/auth.json)',
  },
  grok: {
    envVar: 'XAI_API_KEY',
    envVarHint: 'xai-...',
    loginCmd: 'grok login',
    loginDetail: 'Grok OAuth (~/.grok/auth.json)',
  },
};

function detectEngineAuth(engine: string): { ok: boolean; detail: string } {
  if (engine === 'codex') {
    if (process.env.CODEX_API_KEY) return { ok: true, detail: 'CODEX_API_KEY' };
    if (process.env.OPENAI_API_KEY) return { ok: true, detail: 'OPENAI_API_KEY' };
    const oauthFile = join(homedir(), '.codex', 'auth.json');
    if (existsSync(oauthFile)) return { ok: true, detail: 'ChatGPT OAuth (~/.codex/auth.json)' };
    return { ok: false, detail: '' };
  }
  if (engine === 'claude-code') {
    if (process.env.ANTHROPIC_API_KEY) return { ok: true, detail: 'ANTHROPIC_API_KEY' };
    return { ok: false, detail: '' };
  }
  if (engine === 'cursor') {
    if (process.env.CURSOR_API_KEY) return { ok: true, detail: 'CURSOR_API_KEY' };
    return { ok: false, detail: '' };
  }
  if (engine === 'opencode') {
    const keys = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY'];
    const found = keys.find((k) => !!process.env[k]);
    if (found) return { ok: true, detail: found };
    const authFile = join(homedir(), '.local', 'share', 'opencode', 'auth.json');
    if (existsSync(authFile)) return { ok: true, detail: 'OpenCode auth (~/.local/share/opencode/auth.json)' };
    return { ok: false, detail: '' };
  }
  if (engine === 'grok') {
    if (process.env.XAI_API_KEY) return { ok: true, detail: 'XAI_API_KEY' };
    const oauthFile = join(homedir(), '.grok', 'auth.json');
    if (existsSync(oauthFile)) return { ok: true, detail: 'Grok OAuth (~/.grok/auth.json)' };
    return { ok: false, detail: '' };
  }
  return { ok: false, detail: '' };
}

interface TemplateInfo {
  name: string;
  label: string;
  description: string;
}

const TEMPLATES: TemplateInfo[] = [
  { name: 'customer-support', label: 'Customer Support Bot', description: 'IM customer support with FAQ Skill' },
  { name: 'data-analyst', label: 'Data Analyst', description: 'Data analysis with analytics Skill + scripts' },
  { name: 'code-reviewer', label: 'Code Reviewer', description: 'CI/CD code review' },
  { name: 'ops-assistant', label: 'Ops Assistant', description: 'Content operations / social media management' },
  { name: 'meeting-notes', label: 'Meeting Notes', description: 'Meeting summaries / action item extraction' },
  { name: 'research', label: 'Research Assistant', description: 'Information gathering / competitive analysis' },
];

export function generateEnvExample(engine: string, channels: string[]): string {
  const lines: string[] = ['# GolemBot environment variables', ''];

  lines.push('# AI Engine API Key');
  if (engine === 'claude-code') {
    lines.push('# ANTHROPIC_API_KEY=sk-ant-...');
  } else if (engine === 'opencode') {
    lines.push('# OPENROUTER_API_KEY=sk-or-...');
  } else if (engine === 'codex') {
    lines.push('# CODEX_API_KEY=sk-...');
  } else if (engine === 'grok') {
    lines.push('# XAI_API_KEY=xai-...');
  } else {
    lines.push('# CURSOR_API_KEY=crsr_...');
  }
  lines.push('');

  if (channels.includes('feishu')) {
    lines.push('# Feishu (Lark)');
    lines.push('# FEISHU_APP_ID=cli_xxx');
    lines.push('# FEISHU_APP_SECRET=xxx');
    lines.push('# For Lark global tenants, set channels.feishu.domain: lark in golem.yaml');
    lines.push('');
  }
  if (channels.includes('dingtalk')) {
    lines.push('# DingTalk');
    lines.push('# DINGTALK_CLIENT_ID=xxx');
    lines.push('# DINGTALK_CLIENT_SECRET=xxx');
    lines.push('');
  }
  if (channels.includes('wecom')) {
    lines.push('# WeCom');
    lines.push('# WECOM_CORP_ID=xxx');
    lines.push('# WECOM_AGENT_ID=xxx');
    lines.push('# WECOM_SECRET=xxx');
    lines.push('# WECOM_TOKEN=xxx');
    lines.push('# WECOM_ENCODING_AES_KEY=xxx');
    lines.push('');
  }
  if (channels.includes('slack')) {
    lines.push('# Slack');
    lines.push('# SLACK_BOT_TOKEN=xoxb-...');
    lines.push('# SLACK_APP_TOKEN=xapp-...');
    lines.push('');
  }
  if (channels.includes('telegram')) {
    lines.push('# Telegram');
    lines.push('# TELEGRAM_BOT_TOKEN=xxx:xxx');
    lines.push('');
  }
  if (channels.includes('discord')) {
    lines.push('# Discord');
    lines.push('# DISCORD_BOT_TOKEN=xxx');
    lines.push('');
  }

  lines.push('# Gateway');
  lines.push('# GOLEM_TOKEN=your-auth-token');
  lines.push('');
  return lines.join('\n');
}

export async function installTemplate(dir: string, templateName: string, templatesBase?: string): Promise<void> {
  const templatesRoot = templatesBase
    ? join(templatesBase, templateName)
    : resolve(new URL('.', import.meta.url).pathname, '..', 'templates', templateName);

  try {
    await stat(templatesRoot);
  } catch {
    console.log(`   (template ${templateName} has no files, skipping)`);
    return;
  }

  const skillsDir = join(templatesRoot, 'skills');
  try {
    const entries = await readdir(skillsDir);
    for (const entry of entries) {
      const src = join(skillsDir, entry);
      const dest = join(dir, 'skills', entry);
      try {
        await stat(dest);
      } catch {
        await cp(src, dest, { recursive: true });
        console.log(`   + skill: ${entry}`);
      }
    }
  } catch {
    // no skills subdirectory in template
  }

  const templateFiles = ['README.md'];
  for (const file of templateFiles) {
    const src = join(templatesRoot, file);
    try {
      await stat(src);
      const content = await readFile(src, 'utf-8');
      const dest = join(dir, file);
      try {
        await stat(dest);
      } catch {
        await writeFile(dest, content, 'utf-8');
      }
    } catch {
      // file doesn't exist in template
    }
  }
}

export async function runOnboard(opts: { dir?: string; template?: string } = {}): Promise<void> {
  const inquirer = await import('inquirer');
  const dir = resolve(opts.dir || '.');

  console.log('\n🧙 GolemBot Setup Wizard\n');

  // Step 1: Choose engine
  const { engine } = await inquirer.default.prompt([
    {
      type: 'list',
      name: 'engine',
      message: '1/8 Select AI engine:',
      choices: [
        { name: 'Cursor', value: 'cursor' },
        { name: 'Claude Code', value: 'claude-code' },
        { name: 'OpenCode', value: 'opencode' },
        { name: 'Codex', value: 'codex' },
        { name: 'Grok Build', value: 'grok' },
      ],
    },
  ]);

  // Step 2: Engine authentication
  const envLines: string[] = [];
  const auth = detectEngineAuth(engine);
  const authMeta = ENGINE_AUTH[engine];

  if (auth.ok) {
    console.log(`\n   ✓ Engine authenticated: ${auth.detail}\n`);
  } else if (authMeta) {
    // Build choices: login option (if available) + API key + skip
    const authChoices: Array<{ name: string; value: string }> = [];
    if (authMeta.loginCmd) {
      authChoices.push({
        name: `Already logged in (ran \`${authMeta.loginCmd}\`)`,
        value: 'logged-in',
      });
    }
    authChoices.push({ name: `Enter ${authMeta.envVar}`, value: 'apikey' });
    authChoices.push({ name: 'Skip (configure later)', value: 'skip' });

    const { authChoice } = await inquirer.default.prompt([
      {
        type: 'list',
        name: 'authChoice',
        message: `2/8 Engine authentication:`,
        choices: authChoices,
      },
    ]);

    if (authChoice === 'apikey') {
      const { apiKey } = await inquirer.default.prompt([
        {
          type: 'password',
          name: 'apiKey',
          message: `${authMeta.envVar}:`,
          mask: '*',
        },
      ]);
      if (apiKey) {
        envLines.push(`${authMeta.envVar}=${apiKey}`);
        console.log(`   ✓ ${authMeta.envVar} saved to .env\n`);
      }
    } else if (authChoice === 'logged-in') {
      console.log(`   ✓ Using ${authMeta.loginDetail}\n`);
    } else {
      console.log(`   ⚠ Remember to authenticate before starting the gateway\n`);
      if (authMeta.loginCmd) {
        console.log(`     Run: ${authMeta.loginCmd}`);
      }
      console.log(`     Or set ${authMeta.envVar} in .env\n`);
    }
  }

  // Step 3: Name
  const { name } = await inquirer.default.prompt([
    {
      type: 'input',
      name: 'name',
      message: '3/8 Name your assistant:',
      default: 'my-assistant',
    },
  ]);

  // Step 4: IM channels
  const { channels } = await inquirer.default.prompt([
    {
      type: 'checkbox',
      name: 'channels',
      message: '4/8 Select IM channels (SPACE to select, ENTER to confirm):',
      choices: [
        { name: 'Feishu / Lark (WebSocket, no public IP needed)', value: 'feishu' },
        { name: 'DingTalk (Stream, no public IP needed)', value: 'dingtalk' },
        { name: 'WeCom (Webhook, public URL required)', value: 'wecom' },
        { name: 'Slack (Socket Mode, no public IP needed)', value: 'slack' },
        { name: 'Telegram (Polling, no public IP needed)', value: 'telegram' },
        { name: 'Discord (Gateway, no public IP needed)', value: 'discord' },
      ],
    },
  ]);

  // Step 5-6: Channel config
  const channelsConfig: ChannelsConfig = {};

  if (channels.includes('feishu')) {
    console.log('\n📱 Feishu / Lark config');
    const feishuAnswer = await inquirer.default.prompt([
      {
        type: 'list',
        name: 'domain',
        message: 'Open platform domain:',
        choices: [
          { name: 'Feishu China (open.feishu.cn)', value: 'feishu' },
          { name: 'Lark Global (open.larksuite.com)', value: 'lark' },
        ],
        default: 'feishu',
      },
      { type: 'input', name: 'appId', message: 'Feishu App ID:', default: '' },
      { type: 'password', name: 'appSecret', message: 'Feishu App Secret:', mask: '*', default: '' },
    ]);

    if (feishuAnswer.appId) {
      channelsConfig.feishu = {
        appId: '${FEISHU_APP_ID}',
        appSecret: '${FEISHU_APP_SECRET}',
        ...(feishuAnswer.domain === 'lark' ? { domain: 'lark' } : {}),
      };
      envLines.push(`FEISHU_APP_ID=${feishuAnswer.appId}`);
      envLines.push(`FEISHU_APP_SECRET=${feishuAnswer.appSecret}`);
    }
  }

  if (channels.includes('dingtalk')) {
    console.log('\n📱 DingTalk config (get credentials at: https://open-dev.dingtalk.com)');
    const dtAnswer = await inquirer.default.prompt([
      { type: 'input', name: 'clientId', message: 'DingTalk Client ID (AppKey):', default: '' },
      {
        type: 'password',
        name: 'clientSecret',
        message: 'DingTalk Client Secret (AppSecret):',
        mask: '*',
        default: '',
      },
    ]);

    if (dtAnswer.clientId) {
      channelsConfig.dingtalk = {
        clientId: '${DINGTALK_CLIENT_ID}',
        clientSecret: '${DINGTALK_CLIENT_SECRET}',
      };
      envLines.push(`DINGTALK_CLIENT_ID=${dtAnswer.clientId}`);
      envLines.push(`DINGTALK_CLIENT_SECRET=${dtAnswer.clientSecret}`);
    }
  }

  if (channels.includes('wecom')) {
    console.log('\n📱 WeCom config (get credentials at: https://work.weixin.qq.com/wework_admin/frame#apps)');
    const wcAnswer = await inquirer.default.prompt([
      { type: 'input', name: 'botId', message: 'Bot ID:', default: '' },
      { type: 'password', name: 'secret', message: 'Secret:', mask: '*', default: '' },
    ]);

    if (wcAnswer.botId) {
      channelsConfig.wecom = {
        botId: '${WECOM_BOT_ID}',
        secret: '${WECOM_SECRET}',
      };
      envLines.push(`WECOM_BOT_ID=${wcAnswer.botId}`);
      envLines.push(`WECOM_SECRET=${wcAnswer.secret}`);
    }
  }

  if (channels.includes('slack')) {
    console.log('\n📱 Slack config (get tokens at: https://api.slack.com/apps)');
    const slackAnswer = await inquirer.default.prompt([
      { type: 'password', name: 'botToken', message: 'Bot Token (xoxb-...):', mask: '*', default: '' },
      { type: 'password', name: 'appToken', message: 'App-Level Token (xapp-...):', mask: '*', default: '' },
    ]);

    if (slackAnswer.botToken) {
      channelsConfig.slack = {
        botToken: '${SLACK_BOT_TOKEN}',
        appToken: '${SLACK_APP_TOKEN}',
      };
      envLines.push(`SLACK_BOT_TOKEN=${slackAnswer.botToken}`);
      envLines.push(`SLACK_APP_TOKEN=${slackAnswer.appToken}`);
    }
  }

  if (channels.includes('telegram')) {
    console.log('\n📱 Telegram config (create a bot at: https://t.me/BotFather)');
    const tgAnswer = await inquirer.default.prompt([
      { type: 'password', name: 'botToken', message: 'Bot Token:', mask: '*', default: '' },
    ]);

    if (tgAnswer.botToken) {
      channelsConfig.telegram = {
        botToken: '${TELEGRAM_BOT_TOKEN}',
      };
      envLines.push(`TELEGRAM_BOT_TOKEN=${tgAnswer.botToken}`);
    }
  }

  if (channels.includes('discord')) {
    console.log('\n📱 Discord config (create a bot at: https://discord.com/developers/applications)');
    const dcAnswer = await inquirer.default.prompt([
      { type: 'password', name: 'botToken', message: 'Bot Token:', mask: '*', default: '' },
    ]);

    if (dcAnswer.botToken) {
      channelsConfig.discord = {
        botToken: '${DISCORD_BOT_TOKEN}',
        botName: name,
      };
      envLines.push(`DISCORD_BOT_TOKEN=${dcAnswer.botToken}`);
    }
  }

  // Step 7: Template
  let templateName: string | undefined = opts.template;
  if (!templateName) {
    const { template } = await inquirer.default.prompt([
      {
        type: 'list',
        name: 'template',
        message: '7/8 Choose a scenario template:',
        choices: [
          ...TEMPLATES.map((t) => ({ name: `${t.label} — ${t.description}`, value: t.name })),
          { name: 'None (built-in skills only)', value: '' },
        ],
      },
    ]);
    templateName = template || undefined;
  }

  // Step 8: Generate files
  console.log('\n📝 Generating config files...\n');

  const config: GolemConfig = { name, engine };
  if (Object.keys(channelsConfig).length > 0) {
    config.channels = channelsConfig;
  }
  config.gateway = { port: 3000 };

  const assistant = createAssistant({ dir });
  try {
    await assistant.init({ engine, name });
  } catch (e: unknown) {
    if (!(e as Error).message.includes('already exists')) {
      throw e;
    }
  }

  // Re-write config with channels + gateway (init only writes name + engine)
  const { writeConfig } = await import('./workspace.js');
  await writeConfig(dir, config);

  // .env file
  if (envLines.length > 0) {
    const envPath = join(dir, '.env');
    try {
      await stat(envPath);
      const existing = await readFile(envPath, 'utf-8');
      await writeFile(envPath, `${existing.trimEnd()}\n\n# GolemBot onboard\n${envLines.join('\n')}\n`, 'utf-8');
    } catch {
      await writeFile(envPath, `${envLines.join('\n')}\n`, 'utf-8');
    }
    console.log('   ✅ .env');
  }

  // .env.example
  await writeFile(join(dir, '.env.example'), generateEnvExample(engine, channels), 'utf-8');
  console.log('   ✅ .env.example');

  // .gitignore
  const gitignorePath = join(dir, '.gitignore');
  const gitignoreDefaults = ['.golem/', '.env', '.env.local', 'node_modules/'];
  if (engine === 'opencode') gitignoreDefaults.push('.opencode/');
  if (engine === 'grok') gitignoreDefaults.push('.grok/');
  try {
    await stat(gitignorePath);
  } catch {
    await writeFile(gitignorePath, `${gitignoreDefaults.join('\n')}\n`, 'utf-8');
    console.log('   ✅ .gitignore');
  }

  console.log('   ✅ golem.yaml');
  console.log('   ✅ skills/general');
  console.log('   ✅ skills/im-adapter');

  // Auto-install channel dependencies
  const CHANNEL_DEPS: Record<string, string[]> = {
    feishu: ['@larksuiteoapi/node-sdk'],
    dingtalk: ['dingtalk-stream'],
    wecom: ['@wecom/crypto', 'xml2js'],
    slack: ['@slack/bolt'],
    telegram: ['grammy'],
    discord: ['discord.js'],
  };
  const depsToInstall = channels.flatMap((ch: string) => CHANNEL_DEPS[ch] || []);
  if (depsToInstall.length > 0) {
    console.log(`\n📦 Installing channel dependencies: ${depsToInstall.join(', ')}`);
    const { execSync } = await import('node:child_process');
    try {
      execSync(`npm install ${depsToInstall.join(' ')}`, { cwd: dir, stdio: 'inherit' });
      console.log('   ✅ Dependencies installed');
    } catch {
      console.log(`   ⚠ Auto-install failed. Run manually: npm install ${depsToInstall.join(' ')}`);
    }
  }

  // Install template if selected
  if (templateName) {
    console.log(`\n📦 Installing template: ${templateName}`);
    await installTemplate(dir, templateName);
  }

  // Summary
  console.log(`\n${'─'.repeat(40)}`);
  console.log(`\n✅ GolemBot assistant '${name}' configured!\n`);
  console.log(`   Engine:    ${engine}`);
  if (channels.length > 0) {
    console.log(`   Channels:  ${channels.join(', ')}`);
  }
  if (templateName) {
    console.log(`   Template:  ${templateName}`);
  }
  console.log(`   Directory: ${dir}`);

  // Start?
  const { start } = await inquirer.default.prompt([
    {
      type: 'confirm',
      name: 'start',
      message: '8/8 Start the Gateway now?',
      default: true,
    },
  ]);

  if (start) {
    // Re-load .env that was just created during onboard (the CLI-level loader
    // ran before this file existed, so tokens are missing from process.env).
    try {
      const { readFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      for (const line of readFileSync(join(dir, '.env'), 'utf-8').split('\n')) {
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
    } catch {
      /* no .env — env vars already set externally */
    }

    console.log('');
    const { startGateway } = await import('./gateway.js');
    await startGateway({ dir, verbose: true });
  } else {
    console.log('\nRun: golembot gateway\n');
  }
}
