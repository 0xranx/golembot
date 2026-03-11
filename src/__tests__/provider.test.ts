import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  claudeProviderEnv,
  codexProviderEnv,
  cursorProviderEnv,
  openCodeProviderEnv,
} from '../engines/provider-env.js';
import { discoverEngines } from '../engines/shared.js';
import { createProviderFromPreset, providerPresets } from '../provider-presets.js';
import type { ProviderConfig } from '../workspace.js';
import { loadConfig, writeConfig } from '../workspace.js';

// ── Provider env mapping ─────────────────────────────────

describe('provider-env', () => {
  describe('claudeProviderEnv', () => {
    it('maps apiKey, baseUrl, and model for custom provider', () => {
      const env = claudeProviderEnv({
        apiKey: 'sk-test',
        baseUrl: 'https://api.minimaxi.com/anthropic',
        model: 'MiniMax-M2.5',
      });
      expect(env.ANTHROPIC_API_KEY).toBe('sk-test');
      expect(env.ANTHROPIC_BASE_URL).toBe('https://api.minimaxi.com/anthropic');
      expect(env.ANTHROPIC_MODEL).toBe('MiniMax-M2.5');
      expect(env.ANTHROPIC_SMALL_FAST_MODEL).toBe('MiniMax-M2.5');
      expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('MiniMax-M2.5');
      expect(env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBe('1');
    });

    it('returns only traffic flag when no fields set', () => {
      const env = claudeProviderEnv({});
      expect(env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBe('1');
      expect(env.ANTHROPIC_API_KEY).toBeUndefined();
      expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
    });

    it('maps only apiKey when baseUrl and model are absent', () => {
      const env = claudeProviderEnv({ apiKey: 'sk-test' });
      expect(env.ANTHROPIC_API_KEY).toBe('sk-test');
      expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
      expect(env.ANTHROPIC_MODEL).toBeUndefined();
    });
  });

  describe('codexProviderEnv', () => {
    it('maps apiKey to both CODEX and OPENAI vars', () => {
      const env = codexProviderEnv({ apiKey: 'sk-test' });
      expect(env.CODEX_API_KEY).toBe('sk-test');
      expect(env.OPENAI_API_KEY).toBe('sk-test');
    });

    it('maps baseUrl to OPENAI_BASE_URL', () => {
      const env = codexProviderEnv({ baseUrl: 'https://api.example.com' });
      expect(env.OPENAI_BASE_URL).toBe('https://api.example.com');
    });

    it('returns empty object when no fields set', () => {
      expect(codexProviderEnv({})).toEqual({});
    });
  });

  describe('cursorProviderEnv', () => {
    it('maps apiKey and baseUrl', () => {
      const env = cursorProviderEnv({ apiKey: 'sk-test', baseUrl: 'https://api.example.com' });
      expect(env).toEqual({
        CURSOR_API_KEY: 'sk-test',
        CURSOR_API_BASE_URL: 'https://api.example.com',
      });
    });

    it('returns empty object when no fields set', () => {
      expect(cursorProviderEnv({})).toEqual({});
    });
  });

  describe('openCodeProviderEnv', () => {
    it('maps apiKey using model provider prefix', () => {
      const env = openCodeProviderEnv({ apiKey: 'sk-test' }, 'anthropic/claude-sonnet');
      expect(env.ANTHROPIC_API_KEY).toBe('sk-test');
    });

    it('defaults to openrouter when no model', () => {
      const env = openCodeProviderEnv({ apiKey: 'sk-test' });
      expect(env.OPENROUTER_API_KEY).toBe('sk-test');
    });

    it('maps baseUrl to OPENAI_BASE_URL', () => {
      const env = openCodeProviderEnv({ baseUrl: 'https://api.example.com' });
      expect(env.OPENAI_BASE_URL).toBe('https://api.example.com');
    });

    it('handles unknown provider prefix', () => {
      const env = openCodeProviderEnv({ apiKey: 'sk-test' }, 'custom-provider/model-x');
      expect(env.CUSTOM_PROVIDER_API_KEY).toBe('sk-test');
    });
  });
});

// ── Priority: opts.apiKey > provider.apiKey ───────────────

describe('provider env priority', () => {
  it('provider ANTHROPIC_API_KEY overrides user global key', () => {
    // 1. User's shell has ANTHROPIC_API_KEY set globally
    const env: Record<string, string> = { ANTHROPIC_API_KEY: 'user-global-key' };
    // 2. Provider overwrites it
    const provider: ProviderConfig = { apiKey: 'provider-key', baseUrl: 'https://provider.com', model: 'custom-model' };
    Object.assign(env, claudeProviderEnv(provider));

    expect(env.ANTHROPIC_API_KEY).toBe('provider-key');
    expect(env.ANTHROPIC_BASE_URL).toBe('https://provider.com');
    expect(env.ANTHROPIC_MODEL).toBe('custom-model');
  });

  it('opts.apiKey takes highest priority over provider', () => {
    const env: Record<string, string> = { ANTHROPIC_API_KEY: 'user-global-key' };
    const provider: ProviderConfig = { apiKey: 'provider-key', baseUrl: 'https://provider.com' };
    Object.assign(env, claudeProviderEnv(provider));
    // opts.apiKey overrides everything
    env.ANTHROPIC_API_KEY = 'explicit-key';
    expect(env.ANTHROPIC_API_KEY).toBe('explicit-key');
  });
});

// ── Provider config in golem.yaml ─────────────────────────

describe('provider in golem.yaml', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'golem-test-provider-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('loadConfig parses provider field', async () => {
    await writeFile(
      join(dir, 'golem.yaml'),
      [
        'name: bot',
        'engine: claude-code',
        'provider:',
        '  baseUrl: "https://api.minimax.chat/v1"',
        '  apiKey: "sk-test-key"',
        '  model: "minimax-text-01"',
        '  models:',
        '    claude-code: "minimax-text-01"',
        '    codex: "minimax-text-01"',
      ].join('\n'),
    );
    const cfg = await loadConfig(dir);
    expect(cfg.provider).toEqual({
      baseUrl: 'https://api.minimax.chat/v1',
      apiKey: 'sk-test-key',
      model: 'minimax-text-01',
      models: {
        'claude-code': 'minimax-text-01',
        codex: 'minimax-text-01',
      },
    });
  });

  it('loadConfig resolves ${ENV_VAR} in provider', async () => {
    process.env.TEST_PROVIDER_KEY = 'resolved-key-123';
    await writeFile(
      join(dir, 'golem.yaml'),
      ['name: bot', 'engine: claude-code', 'provider:', '  apiKey: "${TEST_PROVIDER_KEY}"'].join('\n'),
    );
    const cfg = await loadConfig(dir);
    expect(cfg.provider?.apiKey).toBe('resolved-key-123');
    delete process.env.TEST_PROVIDER_KEY;
  });

  it('provider is undefined when not in config', async () => {
    await writeFile(join(dir, 'golem.yaml'), 'name: bot\nengine: cursor\n');
    const cfg = await loadConfig(dir);
    expect(cfg.provider).toBeUndefined();
  });

  it('writeConfig/loadConfig round-trips provider', async () => {
    const provider: ProviderConfig = {
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'sk-deep',
      model: 'deepseek-chat',
      models: { 'claude-code': 'deepseek-coder' },
    };
    await writeConfig(dir, { name: 'test', engine: 'claude-code', provider });
    const cfg = await loadConfig(dir);
    expect(cfg.provider).toEqual(provider);
  });
});

// ── discoverEngines ───────────────────────────────────────

describe('discoverEngines', () => {
  it('returns an array', async () => {
    const engines = await discoverEngines();
    expect(Array.isArray(engines)).toBe(true);
  });

  it('each discovered engine has name and binary', async () => {
    const engines = await discoverEngines();
    for (const e of engines) {
      expect(typeof e.name).toBe('string');
      expect(typeof e.binary).toBe('string');
    }
  });
});

// ── Provider presets ──────────────────────────────────────

describe('provider-presets', () => {
  it('has at least 5 presets', () => {
    expect(providerPresets.length).toBeGreaterThanOrEqual(5);
  });

  it('all presets have required fields', () => {
    for (const p of providerPresets) {
      expect(p.name).toBeTruthy();
      expect(p.displayName).toBeTruthy();
      expect(p.baseUrl).toBeTruthy();
      expect(p.defaultModel).toBeTruthy();
      expect(p.apiKeyEnvVar).toBeTruthy();
    }
  });

  it('createProviderFromPreset returns config for known preset', () => {
    const config = createProviderFromPreset('minimax');
    expect(config).toBeDefined();
    expect(config!.baseUrl).toBe('https://api.minimax.chat/v1');
    expect(config!.model).toBe('minimax-text-01');
    expect(config!.apiKey).toBe('${MINIMAX_API_KEY}');
  });

  it('createProviderFromPreset returns undefined for unknown preset', () => {
    expect(createProviderFromPreset('nonexistent')).toBeUndefined();
  });

  it('createProviderFromPreset uses provided apiKey and model', () => {
    const config = createProviderFromPreset('deepseek', 'my-key', 'deepseek-coder');
    expect(config!.apiKey).toBe('my-key');
    expect(config!.model).toBe('deepseek-coder');
  });
});
