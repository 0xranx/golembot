/**
 * ProviderStore — SSOT for provider configuration.
 *
 * PR A scope: provider persistence and CLI management only.
 * Runtime integration (ProviderBroker, engine env resolution) is in PR B.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const GOLEM_DIR = '.golem';
const PROVIDERS_FILE = 'providers.json';

/** Strategy for selecting provider: single or failover by priority */
export type ProviderStrategy = 'single' | 'priority_failover';

/** Health status of a provider */
export type ProviderHealth = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

export interface ProviderDef {
  id: string;
  /** Engine type: cursor, claude-code, opencode, codex */
  engine: string;
  /** Model string (e.g. claude-sonnet-4-20250514, openrouter/anthropic/...) */
  model?: string;
  /** API key or ${ENV_VAR} reference */
  apiKey?: string;
  /** Custom endpoint URL (for some engines) */
  endpoint?: string;
  /** Priority for failover (lower = higher priority). Default: 0 */
  priority?: number;
  /** Current health. Managed by ProviderStore. */
  health?: ProviderHealth;
  /** Last failure timestamp (unix ms). Used for circuit breaker. */
  lastFailureAt?: number;
  /** Consecutive failure count. Reset on success. */
  consecutiveFailures?: number;
  /** Extra env vars for this provider (e.g. OPENROUTER_API_KEY) */
  env?: Record<string, string>;
}

export interface ProviderStoreData {
  /** Current active provider id (for single strategy) */
  currentProviderId?: string;
  /** Strategy: single = use currentProviderId; priority_failover = try by priority */
  strategy?: ProviderStrategy;
  /** Provider definitions, keyed by id */
  providers: Record<string, ProviderDef>;
  /** Optional: circuit breaker — min failures before marking unhealthy */
  circuitBreakerThreshold?: number;
  /** Optional: cooldown ms before retrying unhealthy provider */
  circuitBreakerCooldownMs?: number;
}

function providersPath(dir: string): string {
  return join(dir, GOLEM_DIR, PROVIDERS_FILE);
}

/**
 * ProviderStore — Single Source of Truth for provider configuration.
 * Persists to .golem/providers.json.
 */
export class ProviderStore {
  constructor(private readonly dir: string) {}

  async read(): Promise<ProviderStoreData> {
    try {
      const raw = await readFile(providersPath(this.dir), 'utf-8');
      const data = JSON.parse(raw) as ProviderStoreData;
      if (!data.providers || typeof data.providers !== 'object') {
        return { providers: {} };
      }
      return {
        currentProviderId: data.currentProviderId,
        strategy: data.strategy ?? 'single',
        providers: data.providers,
        circuitBreakerThreshold: data.circuitBreakerThreshold,
        circuitBreakerCooldownMs: data.circuitBreakerCooldownMs,
      };
    } catch {
      return { providers: {} };
    }
  }

  async write(data: ProviderStoreData): Promise<void> {
    const golemDir = join(this.dir, GOLEM_DIR);
    await mkdir(golemDir, { recursive: true });
    await writeFile(
      providersPath(this.dir),
      JSON.stringify(data, null, 2) + '\n',
      'utf-8',
    );
  }

  /** Record a successful invocation — reset consecutive failures for this provider */
  async recordSuccess(providerId: string): Promise<void> {
    const data = await this.read();
    const p = data.providers[providerId];
    if (p) {
      p.consecutiveFailures = 0;
      p.health = 'healthy';
      await this.write(data);
    }
  }

  /** Record a failure — increment consecutive failures, optionally mark unhealthy */
  async recordFailure(providerId: string): Promise<void> {
    const data = await this.read();
    const p = data.providers[providerId];
    if (!p) return;

    p.lastFailureAt = Date.now();
    p.consecutiveFailures = (p.consecutiveFailures ?? 0) + 1;

    const threshold = data.circuitBreakerThreshold ?? 3;
    if (p.consecutiveFailures >= threshold) {
      p.health = 'unhealthy';
    }

    await this.write(data);
  }

  /** Check if provider is available (not in cooldown, not unhealthy) */
  isProviderAvailable(p: ProviderDef, data: ProviderStoreData): boolean {
    if (p.health === 'unhealthy') {
      const cooldown = data.circuitBreakerCooldownMs ?? 60_000; // 1 min default
      const elapsed = Date.now() - (p.lastFailureAt ?? 0);
      return elapsed >= cooldown;
    }
    return true;
  }
}
