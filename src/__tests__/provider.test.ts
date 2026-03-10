import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProviderBroker, ProviderStore } from '../provider.js';

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

describe('ProviderStore availability checks', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'golem-provider-availability-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('treats healthy providers as available', () => {
    const store = new ProviderStore(dir);
    const available = store.isProviderAvailable(
      { id: 'p1', engine: 'claude-code', health: 'healthy' },
      { providers: {}, circuitBreakerCooldownMs: 60_000 },
    );
    expect(available).toBe(true);
  });

  it('treats unhealthy providers as unavailable during cooldown', () => {
    const store = new ProviderStore(dir);
    const available = store.isProviderAvailable(
      {
        id: 'p1',
        engine: 'claude-code',
        health: 'unhealthy',
        lastFailureAt: Date.now(),
      },
      { providers: {}, circuitBreakerCooldownMs: 60_000 },
    );
    expect(available).toBe(false);
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
    const broker = new ProviderBroker(store, { engine: 'claude-code', model: 'claude-sonnet-4', apiKey: undefined });
    expect(await broker.resolve()).toBeNull();
  });

  it('resolves single provider and sets engine-specific env var', async () => {
    const store = new ProviderStore(dir);
    await store.write({
      currentProviderId: 'main',
      strategy: 'single',
      providers: { main: { id: 'main', engine: 'claude-code', model: 'claude-sonnet-4', apiKey: 'sk-ant-test' } },
    });
    const broker = new ProviderBroker(store, { engine: 'claude-code' });
    const ctx = await broker.resolve();
    expect(ctx).not.toBeNull();
    expect(ctx!.providerId).toBe('main');
    expect(ctx!.engine).toBe('claude-code');
    expect(ctx!.env.ANTHROPIC_API_KEY).toBe('sk-ant-test');
    expect(ctx!.env.OPENAI_API_KEY).toBeUndefined(); // no blast
  });

  it('sets CODEX_API_KEY and OPENAI_API_KEY for codex engine', async () => {
    const store = new ProviderStore(dir);
    await store.write({
      currentProviderId: 'c',
      strategy: 'single',
      providers: { c: { id: 'c', engine: 'codex', apiKey: 'sk-openai-test' } },
    });
    const ctx = await new ProviderBroker(store, { engine: 'codex' }).resolve();
    expect(ctx!.env.CODEX_API_KEY).toBe('sk-openai-test');
    expect(ctx!.env.OPENAI_API_KEY).toBe('sk-openai-test');
    expect(ctx!.env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('priority_failover picks lowest priority number', async () => {
    const store = new ProviderStore(dir);
    await store.write({
      strategy: 'priority_failover',
      providers: {
        backup: { id: 'backup', engine: 'opencode', priority: 10 },
        primary: { id: 'primary', engine: 'claude-code', priority: 0 },
      },
    });
    const ctx = await new ProviderBroker(store, { engine: 'claude-code' }).resolve();
    expect(ctx!.providerId).toBe('primary');
  });

  it('priority_failover skips unhealthy providers', async () => {
    const store = new ProviderStore(dir);
    await store.write({
      strategy: 'priority_failover',
      circuitBreakerCooldownMs: 60_000,
      providers: {
        primary: { id: 'primary', engine: 'claude-code', priority: 0, health: 'unhealthy', lastFailureAt: Date.now() },
        backup: { id: 'backup', engine: 'opencode', priority: 10 },
      },
    });
    const ctx = await new ProviderBroker(store, { engine: 'claude-code' }).resolve();
    expect(ctx!.providerId).toBe('backup');
  });
});
