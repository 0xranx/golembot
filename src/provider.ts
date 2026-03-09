/**
 * Provider Control Plane — SSOT for provider configuration and runtime resolution.
 *
 * Implements the design from https://github.com/0xranx/golembot/issues/4
 * - ProviderStore: unified storage for providers, priority, health, strategy
 * - ProviderBroker: resolves provider before each assistant.chat()
 * - providerContext: env/args/model/endpoint for engine adapters
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveEnvPlaceholders } from './workspace.js';

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
  /** Current health. Managed by ProviderStore/Health. */
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

/** Resolved context passed to engine.invoke() — engines consume this, not select provider */
export interface ProviderContext {
  providerId: string;
  engine: string;
  model?: string;
  apiKey?: string;
  endpoint?: string;
  /** Env vars to merge into process env for the engine subprocess */
  env: Record<string, string>;
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

    const now = Date.now();
    p.lastFailureAt = now;
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

/**
 * ProviderBroker — Resolves provider before each assistant.chat().
 * Outputs providerContext (env/args/model/endpoint) for engine adapters.
 * Engines only execute protocol; they do not select provider.
 */
export class ProviderBroker {
  constructor(
    private readonly dir: string,
    private readonly store: ProviderStore,
    /** Fallback: config from golem.yaml when no providers configured */
    private readonly fallback: { engine: string; model?: string; apiKey?: string },
  ) {}

  /**
   * Resolve provider for this invocation.
   * Returns providerContext for the engine, or null if using legacy (config-only) mode.
   */
  async resolve(): Promise<ProviderContext | null> {
    const data = await this.store.read();
    const providerIds = Object.keys(data.providers);
    if (providerIds.length === 0) {
      return null;
    }

    const strategy = data.strategy ?? 'single';

    if (strategy === 'single') {
      const id = data.currentProviderId ?? providerIds[0];
      const p = data.providers[id];
      if (!p || !this.store.isProviderAvailable(p, data)) {
        // Fallback to first available
        for (const pid of providerIds) {
          const prov = data.providers[pid];
          if (prov && this.store.isProviderAvailable(prov, data)) {
            return this.buildContext(prov);
          }
        }
        // All unhealthy — still return first, let engine fail
        return p ? this.buildContext(p) : null;
      }
      return this.buildContext(p);
    }

    // priority_failover: try by priority (lower number first)
    const sorted = providerIds
      .map(id => ({ id, def: data.providers[id] }))
      .filter(({ def }) => def && this.store.isProviderAvailable(def, data))
      .sort((a, b) => (a.def.priority ?? 0) - (b.def.priority ?? 0));

    if (sorted.length === 0) {
      const first = data.providers[providerIds[0]];
      return first ? this.buildContext(first) : null;
    }
    return this.buildContext(sorted[0].def);
  }

  /** Get fallback context when no providers configured (legacy mode) */
  getFallbackContext(): ProviderContext {
    const env: Record<string, string> = {};
    if (this.fallback.apiKey) {
      env.ANTHROPIC_API_KEY = this.fallback.apiKey;
      env.OPENAI_API_KEY = this.fallback.apiKey;
    }
    return {
      providerId: 'fallback',
      engine: this.fallback.engine,
      model: this.fallback.model,
      apiKey: this.fallback.apiKey,
      env,
    };
  }

  private buildContext(p: ProviderDef): ProviderContext {
    const rawApiKey = p.apiKey ?? '';
    const resolvedApiKey =
      typeof rawApiKey === 'string'
        ? (resolveEnvPlaceholders(rawApiKey) as string)
        : '';
    const hasRealKey =
      typeof resolvedApiKey === 'string' &&
      resolvedApiKey.length > 0 &&
      !resolvedApiKey.startsWith('${');

    const env: Record<string, string> = { ...(p.env ?? {}) };
    if (hasRealKey) {
      // Set engine-specific env vars so engines find the key
      env.ANTHROPIC_API_KEY = resolvedApiKey;
      env.OPENAI_API_KEY = resolvedApiKey;
      env.OPENROUTER_API_KEY = resolvedApiKey;
      env.CODEX_API_KEY = resolvedApiKey;
    }

    return {
      providerId: p.id,
      engine: p.engine,
      model: p.model,
      apiKey: hasRealKey ? resolvedApiKey : undefined,
      endpoint: p.endpoint,
      env,
    };
  }
}
