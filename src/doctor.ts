import { isOnPath } from './engine.js';
import { loadConfig, scanSkills } from './workspace.js';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

export async function runDoctor(dir: string): Promise<void> {
  const results: CheckResult[] = [];

  // 1. Node.js version >= 18
  const nodeVer = process.versions.node;
  const major = parseInt(nodeVer.split('.')[0], 10);
  results.push({
    name: 'Node.js >= 18',
    ok: major >= 18,
    detail: `v${nodeVer}`,
  });

  // 2. golem.yaml exists and is valid
  let engine = '';
  try {
    const config = await loadConfig(dir);
    engine = config.engine;
    results.push({
      name: 'golem.yaml',
      ok: true,
      detail: `engine=${config.engine}, name=${config.name}`,
    });
  } catch {
    results.push({
      name: 'golem.yaml',
      ok: false,
      detail: 'not found or invalid — run golembot init',
    });
  }

  // 3. Engine CLI installed
  const engineBins: Record<string, string> = {
    cursor: 'agent',
    'claude-code': 'claude',
    opencode: 'opencode',
  };
  if (engine && engineBins[engine]) {
    const bin = engineBins[engine];
    const found = isOnPath(bin);
    results.push({
      name: `Engine CLI (${bin})`,
      ok: found,
      detail: found ? 'found on PATH' : `not found — install ${bin}`,
    });
  }

  // 4. API key set
  const keyVars = ['ANTHROPIC_API_KEY', 'CURSOR_API_KEY', 'OPENROUTER_API_KEY'];
  const hasKey = keyVars.some(k => !!process.env[k]);
  results.push({
    name: 'API key',
    ok: hasKey,
    detail: hasKey
      ? keyVars.filter(k => !!process.env[k]).join(', ')
      : 'none set (set ANTHROPIC_API_KEY, CURSOR_API_KEY, or OPENROUTER_API_KEY)',
  });

  // 5. Skills
  try {
    const skills = await scanSkills(dir);
    results.push({
      name: 'Skills',
      ok: skills.length > 0,
      detail: skills.length > 0
        ? skills.map(s => s.name).join(', ')
        : 'none — run golembot init or add skills',
    });
  } catch {
    results.push({
      name: 'Skills',
      ok: false,
      detail: 'could not scan skills directory',
    });
  }

  // Output
  console.log('\nGolemBot Doctor\n');
  let allOk = true;
  for (const r of results) {
    const icon = r.ok ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
    console.log(`  ${icon} ${r.name}: ${r.detail}`);
    if (!r.ok) allOk = false;
  }
  console.log();

  process.exit(allOk ? 0 : 1);
}
