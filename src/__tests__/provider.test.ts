import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProviderStore } from '../provider.js';

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
