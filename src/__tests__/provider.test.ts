import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProviderStore, ProviderBroker } from '../provider.js';

describe('ProviderStore', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'golem-provider-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns empty when providers.json does not exist', async () => {
    const store = new ProviderStore(dir);
    const data = await store.read();
    expect(data.providers).toEqual({});
    expect(data.strategy).toBeUndefined();
  });

  it('reads and writes providers', async () => {
    const store = new ProviderStore(dir);
    const data = {
      currentProviderId: 'primary',
      strategy: 'single' as const,
      providers: {
        primary: {
          id: 'primary',
          engine: 'claude-code',
          model: 'claude-sonnet-4',
          apiKey: '${ANTHROPIC_API_KEY}',
          priority: 0,
        },
      },
    };
    await store.write(data);
    const read = await store.read();
    expect(read.currentProviderId).toBe('primary');
    expect(read.strategy).toBe('single');
    expect(read.providers.primary.engine).toBe('claude-code');
    expect(read.providers.primary.model).toBe('claude-sonnet-4');
  });

  it('recordSuccess resets consecutive failures', async () => {
    const store = new ProviderStore(dir);
    await store.write({
      providers: {
        p1: {
          id: 'p1',
          engine: 'opencode',
          consecutiveFailures: 2,
          health: 'degraded',
        },
      },
    });
    await store.recordSuccess('p1');
    const data = await store.read();
    expect(data.providers.p1.consecutiveFailures).toBe(0);
    expect(data.providers.p1.health).toBe('healthy');
  });

  it('recordFailure increments consecutive failures and marks unhealthy at threshold', async () => {
    const store = new ProviderStore(dir);
    await store.write({
      circuitBreakerThreshold: 2,
      providers: {
        p1: { id: 'p1', engine: 'codex' },
      },
    });
    await store.recordFailure('p1');
    let data = await store.read();
    expect(data.providers.p1.consecutiveFailures).toBe(1);
    expect(data.providers.p1.health).toBeUndefined();

    await store.recordFailure('p1');
    data = await store.read();
    expect(data.providers.p1.consecutiveFailures).toBe(2);
    expect(data.providers.p1.health).toBe('unhealthy');
  });
});

describe('ProviderBroker', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'golem-broker-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns null when no providers configured (legacy mode)', async () => {
    const store = new ProviderStore(dir);
    const broker = new ProviderBroker(dir, store, {
      engine: 'claude-code',
      model: 'claude-sonnet-4',
      apiKey: undefined,
    });
    const ctx = await broker.resolve();
    expect(ctx).toBeNull();
  });

  it('returns providerContext when providers exist', async () => {
    const store = new ProviderStore(dir);
    await store.write({
      currentProviderId: 'main',
      strategy: 'single',
      providers: {
        main: {
          id: 'main',
          engine: 'opencode',
          model: 'openrouter/anthropic/claude-sonnet-4',
          apiKey: 'sk-test-key',
          priority: 0,
        },
      },
    });
    const broker = new ProviderBroker(dir, store, {
      engine: 'claude-code',
      model: undefined,
      apiKey: undefined,
    });
    const ctx = await broker.resolve();
    expect(ctx).not.toBeNull();
    expect(ctx!.providerId).toBe('main');
    expect(ctx!.engine).toBe('opencode');
    expect(ctx!.model).toBe('openrouter/anthropic/claude-sonnet-4');
    expect(ctx!.apiKey).toBe('sk-test-key');
    expect(ctx!.env.OPENROUTER_API_KEY).toBe('sk-test-key');
  });

  it('getFallbackContext returns fallback when no providers', () => {
    const store = new ProviderStore(dir);
    const broker = new ProviderBroker(dir, store, {
      engine: 'codex',
      model: 'gpt-4',
      apiKey: 'fallback-key',
    });
    const ctx = broker.getFallbackContext();
    expect(ctx.providerId).toBe('fallback');
    expect(ctx.engine).toBe('codex');
    expect(ctx.model).toBe('gpt-4');
    expect(ctx.apiKey).toBe('fallback-key');
  });

  it('priority_failover returns provider by priority', async () => {
    const store = new ProviderStore(dir);
    await store.write({
      strategy: 'priority_failover',
      providers: {
        backup: { id: 'backup', engine: 'opencode', priority: 10 },
        primary: { id: 'primary', engine: 'claude-code', priority: 0 },
      },
    });
    const broker = new ProviderBroker(dir, store, {
      engine: 'claude-code',
      model: undefined,
      apiKey: undefined,
    });
    const ctx = await broker.resolve();
    expect(ctx!.providerId).toBe('primary');
  });
});
