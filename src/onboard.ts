import { resolve, join } from 'node:path';
import { writeFile, mkdir, stat, readFile, readdir, cp } from 'node:fs/promises';
import { createAssistant } from './index.js';
import type { GolemConfig, ChannelsConfig } from './workspace.js';

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
  } else {
    lines.push('# CURSOR_API_KEY=crsr_...');
  }
  lines.push('');

  if (channels.includes('feishu')) {
    lines.push('# Feishu (Lark)');
    lines.push('# FEISHU_APP_ID=cli_xxx');
    lines.push('# FEISHU_APP_SECRET=xxx');
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

  lines.push('# Gateway');
  lines.push('# GOLEM_TOKEN=your-auth-token');
  lines.push('');
  return lines.join('\n');
}

export async function installTemplate(dir: string, templateName: string, templatesBase?: string): Promise<void> {
  const templatesRoot = templatesBase
    ? join(templatesBase, templateName)
    : resolve(
        new URL('.', import.meta.url).pathname,
        '..',
        'templates',
        templateName,
      );

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
  const { engine } = await inquirer.default.prompt([{
    type: 'list',
    name: 'engine',
    message: '1/7 Select AI engine:',
    choices: [
      { name: 'Cursor', value: 'cursor' },
      { name: 'Claude Code', value: 'claude-code' },
      { name: 'OpenCode', value: 'opencode' },
    ],
  }]);

  // Step 2: Name
  const { name } = await inquirer.default.prompt([{
    type: 'input',
    name: 'name',
    message: '2/7 Name your assistant:',
    default: 'my-assistant',
  }]);

  // Step 3: IM channels
  const { channels } = await inquirer.default.prompt([{
    type: 'checkbox',
    name: 'channels',
    message: '3/7 Select IM channels to connect (multi-select, press Enter to skip):',
    choices: [
      { name: 'Feishu / Lark (WebSocket, no public IP needed)', value: 'feishu' },
      { name: 'DingTalk (Stream, no public IP needed)', value: 'dingtalk' },
      { name: 'WeCom (Webhook, public URL required)', value: 'wecom' },
    ],
  }]);

  // Step 4-5: Channel config
  const channelsConfig: ChannelsConfig = {};
  const envLines: string[] = [];

  if (channels.includes('feishu')) {
    console.log('\n📱 Feishu config (get credentials at: https://open.feishu.cn/app)');
    const feishuAnswer = await inquirer.default.prompt([
      { type: 'input', name: 'appId', message: 'Feishu App ID:', default: '' },
      { type: 'password', name: 'appSecret', message: 'Feishu App Secret:', mask: '*', default: '' },
    ]);

    if (feishuAnswer.appId) {
      channelsConfig.feishu = {
        appId: '${FEISHU_APP_ID}',
        appSecret: '${FEISHU_APP_SECRET}',
      };
      envLines.push(`FEISHU_APP_ID=${feishuAnswer.appId}`);
      envLines.push(`FEISHU_APP_SECRET=${feishuAnswer.appSecret}`);
    }
  }

  if (channels.includes('dingtalk')) {
    console.log('\n📱 DingTalk config (get credentials at: https://open-dev.dingtalk.com)');
    const dtAnswer = await inquirer.default.prompt([
      { type: 'input', name: 'clientId', message: 'DingTalk Client ID (AppKey):', default: '' },
      { type: 'password', name: 'clientSecret', message: 'DingTalk Client Secret (AppSecret):', mask: '*', default: '' },
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
      { type: 'input', name: 'corpId', message: 'Corp ID:', default: '' },
      { type: 'input', name: 'agentId', message: 'Agent ID:', default: '' },
      { type: 'password', name: 'secret', message: 'Secret:', mask: '*', default: '' },
      { type: 'input', name: 'token', message: 'Token:', default: '' },
      { type: 'input', name: 'encodingAESKey', message: 'EncodingAESKey:', default: '' },
    ]);

    if (wcAnswer.corpId) {
      channelsConfig.wecom = {
        corpId: '${WECOM_CORP_ID}',
        agentId: '${WECOM_AGENT_ID}',
        secret: '${WECOM_SECRET}',
        token: '${WECOM_TOKEN}',
        encodingAESKey: '${WECOM_ENCODING_AES_KEY}',
      };
      envLines.push(`WECOM_CORP_ID=${wcAnswer.corpId}`);
      envLines.push(`WECOM_AGENT_ID=${wcAnswer.agentId}`);
      envLines.push(`WECOM_SECRET=${wcAnswer.secret}`);
      envLines.push(`WECOM_TOKEN=${wcAnswer.token}`);
      envLines.push(`WECOM_ENCODING_AES_KEY=${wcAnswer.encodingAESKey}`);
    }
  }

  // Step 6: Template
  let templateName: string | undefined = opts.template;
  if (!templateName) {
    const { template } = await inquirer.default.prompt([{
      type: 'list',
      name: 'template',
      message: '6/7 Choose a scenario template:',
      choices: [
        ...TEMPLATES.map(t => ({ name: `${t.label} — ${t.description}`, value: t.name })),
        { name: 'None (built-in skills only)', value: '' },
      ],
    }]);
    templateName = template || undefined;
  }

  // Step 7: Generate files
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
      await writeFile(envPath, existing.trimEnd() + '\n\n# GolemBot onboard\n' + envLines.join('\n') + '\n', 'utf-8');
    } catch {
      await writeFile(envPath, envLines.join('\n') + '\n', 'utf-8');
    }
    console.log('   ✅ .env');
  }

  // .env.example
  await writeFile(
    join(dir, '.env.example'),
    generateEnvExample(engine, channels),
    'utf-8',
  );
  console.log('   ✅ .env.example');

  // .gitignore
  const gitignorePath = join(dir, '.gitignore');
  const gitignoreDefaults = ['.golem/', '.env', '.env.local', 'node_modules/'];
  if (engine === 'opencode') gitignoreDefaults.push('.opencode/');
  try {
    await stat(gitignorePath);
  } catch {
    await writeFile(gitignorePath, gitignoreDefaults.join('\n') + '\n', 'utf-8');
    console.log('   ✅ .gitignore');
  }

  console.log('   ✅ golem.yaml');
  console.log('   ✅ skills/general');
  console.log('   ✅ skills/im-adapter');

  // Install template if selected
  if (templateName) {
    console.log(`\n📦 Installing template: ${templateName}`);
    await installTemplate(dir, templateName);
  }

  // Summary
  console.log('\n' + '─'.repeat(40));
  console.log(`\n✅ GolemBot assistant '${name}' configured!\n`);
  console.log(`   Engine:    ${engine}`);
  if (channels.length > 0) {
    console.log(`   Channels:  ${channels.join(', ')}`);
  }
  if (templateName) {
    console.log(`   Template:  ${templateName}`);
  }
  console.log(`   Directory: ${dir}`);

  // Step 8: Start?
  const { start } = await inquirer.default.prompt([{
    type: 'confirm',
    name: 'start',
    message: '7/7 Start the Gateway now?',
    default: true,
  }]);

  if (start) {
    console.log('');
    const { startGateway } = await import('./gateway.js');
    await startGateway({ dir, verbose: true });
  } else {
    console.log('\nRun: golembot gateway\n');
  }
}
