import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { assessCodexProviderCompatibility } from './codex-provider-compat.js';
import { isOnPath } from './engine.js';
import { daysUntilExpiry, loadTokenMeta } from './token-meta.js';
import { loadConfig, scanSkills } from './workspace.js';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';
export async function runDoctor(dir) {
    const results = [];
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
    let providerConfig;
    let oauthToken;
    try {
        const config = await loadConfig(dir);
        engine = config.engine;
        providerConfig = config.provider;
        oauthToken = config.oauthToken;
        results.push({
            name: 'golem.yaml',
            ok: true,
            detail: `engine=${config.engine}, name=${config.name}`,
        });
    }
    catch {
        results.push({
            name: 'golem.yaml',
            ok: false,
            detail: 'not found or invalid — run golembot init',
        });
    }
    // 3. Engine CLI installed
    const engineBins = {
        cursor: 'agent',
        'claude-code': 'claude',
        opencode: 'opencode',
        codex: 'codex',
        grok: 'grok',
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
    // 4. API key / auth credentials
    let authOk = false;
    let authDetail = '';
    if (engine === 'codex') {
        const apiKeyVars = ['OPENAI_API_KEY', 'CODEX_API_KEY'];
        const foundVars = apiKeyVars.filter((k) => !!process.env[k]);
        const oauthFile = join(homedir(), '.codex', 'auth.json');
        const hasOAuth = existsSync(oauthFile);
        if (foundVars.length > 0) {
            authOk = true;
            authDetail = foundVars.join(', ');
        }
        else if (hasOAuth) {
            authOk = true;
            authDetail = 'ChatGPT OAuth (~/.codex/auth.json)';
        }
        else {
            authDetail = 'none — run `codex login` or set CODEX_API_KEY';
        }
    }
    else if (engine === 'grok') {
        if (process.env.XAI_API_KEY) {
            authOk = true;
            authDetail = 'XAI_API_KEY';
        }
        else {
            const oauthFile = join(homedir(), '.grok', 'auth.json');
            if (existsSync(oauthFile)) {
                authOk = true;
                authDetail = 'Grok OAuth (~/.grok/auth.json)';
            }
            else {
                authDetail = 'none — run `grok login` or set XAI_API_KEY';
            }
        }
    }
    else {
        const keyVars = ['ANTHROPIC_API_KEY', 'CURSOR_API_KEY', 'OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'XAI_API_KEY'];
        const foundVars = keyVars.filter((k) => !!process.env[k]);
        authOk = foundVars.length > 0;
        authDetail = authOk
            ? foundVars.join(', ')
            : 'none set (set ANTHROPIC_API_KEY, CURSOR_API_KEY, OPENROUTER_API_KEY, or XAI_API_KEY)';
    }
    results.push({ name: 'API key / auth', ok: authOk, detail: authDetail });
    // 5. Skills
    try {
        const skills = await scanSkills(dir);
        results.push({
            name: 'Skills',
            ok: skills.length > 0,
            detail: skills.length > 0 ? skills.map((s) => s.name).join(', ') : 'none — run golembot init or add skills',
        });
    }
    catch {
        results.push({
            name: 'Skills',
            ok: false,
            detail: 'could not scan skills directory',
        });
    }
    // 6. Provider config (if set in golem.yaml)
    if (providerConfig) {
        const apiKey = providerConfig.apiKey;
        const keyResolved = apiKey && !apiKey.includes('${');
        results.push({
            name: 'Provider apiKey',
            ok: !!keyResolved,
            detail: keyResolved
                ? 'set'
                : apiKey
                    ? `unresolved placeholder — set the env var (${apiKey})`
                    : 'not set — add apiKey to provider block in golem.yaml',
        });
        if (providerConfig.fallback) {
            const fbKey = providerConfig.fallback.apiKey;
            const fbResolved = fbKey && !fbKey.includes('${');
            results.push({
                name: 'Provider fallback apiKey',
                ok: !!fbResolved,
                detail: fbResolved
                    ? 'set'
                    : fbKey
                        ? `unresolved placeholder — set the env var (${fbKey})`
                        : 'not set — add apiKey to provider.fallback block in golem.yaml',
            });
        }
        if (engine === 'codex') {
            const compatibility = assessCodexProviderCompatibility(providerConfig);
            if (compatibility) {
                results.push({
                    name: 'Codex provider compatibility',
                    ok: !compatibility.likelyIncompatible,
                    detail: compatibility.detail,
                });
            }
        }
    }
    // 7. Claude Max OAuth token (setup-token)
    if (engine === 'claude-code' && oauthToken) {
        const resolved = !oauthToken.includes('${');
        results.push({
            name: 'Claude Max OAuth token',
            ok: resolved,
            detail: resolved ? 'set' : `unresolved placeholder (${oauthToken})`,
        });
        if (resolved) {
            const meta = await loadTokenMeta(join(dir, '.golem'));
            if (meta) {
                const days = daysUntilExpiry(meta);
                results.push({
                    name: 'OAuth token expiry',
                    ok: days > 30,
                    detail: days > 30 ? `~${days} days remaining` : `expires in ~${days} days — run \`claude setup-token\` to renew`,
                });
            }
        }
    }
    // Output
    console.log('\nGolemBot Doctor\n');
    let allOk = true;
    for (const r of results) {
        const icon = r.ok ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
        console.log(`  ${icon} ${r.name}: ${r.detail}`);
        if (!r.ok)
            allOk = false;
    }
    console.log();
    process.exit(allOk ? 0 : 1);
}
//# sourceMappingURL=doctor.js.map