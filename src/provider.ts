/**
 * Provider Control Plane — SSOT for provider configuration and runtime resolution.
 *
 * - ProviderStore: persist/read .golem/providers.json, health tracking
 * - ProviderContext: resolved env/model/apiKey passed to engine.invoke()
 * - ProviderBroker: selects provider per chat() call, builds ProviderContext
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

// ── Provider env resolution ──────────────────────────────

/** Resolve ${ENV_VAR} placeholders in a string */
function resolveEnvRef(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, name) => process.env[name] ?? '');
}

/**
 * Map OpenCode model prefix (e.g. "openrouter/anthropic/...") to its env var.
 * Mirrors the logic in engines/opencode.ts so provider.ts stays self-contained.
 */
const OPENCODE_PROVIDER_ENV: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  google: 'GOOGLE_GENERATIVE_AI_API_KEY',
  'amazon-bedrock': 'AWS_ACCESS_KEY_ID',
  mistral: 'MISTRAL_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  groq: 'GROQ_API_KEY',
};

function openCodeEnvVar(model?: string): string {
  const provider = model?.split('/')[0] ?? 'openrouter';
  return OPENCODE_PROVIDER_ENV[provider] ?? `${provider.toUpperCase().replace(/-/g, '_')}_API_KEY`;
}

// ── ProviderContext ──────────────────────────────────────

/** Resolved provider context passed to engine.invoke() via InvokeOpts. */
export interface ProviderContext {
  providerId: string;
  engine: string;
  model?: string;
  apiKey?: string;
  endpoint?: string;
  /** Engine-specific env vars to merge into the subprocess environment. */
  env: Record<string, string>;
}

// ── ProviderBroker ───────────────────────────────────────

/**
 * ProviderBroker — selects a provider before each assistant.chat() call.
 * Engines receive a ProviderContext and use it instead of raw opts.apiKey.
 */
export class ProviderBroker {
  constructor(
    private readonly store: ProviderStore,
    /** Fallback values from golem.yaml, used when no providers are configured. */
    private readonly fallback: { engine: string; model?: string; apiKey?: string },
  ) {}

  /**
   * Resolve a provider for this invocation.
   * Returns null when no providers are configured (legacy golem.yaml-only mode).
   */
  async resolve(): Promise<ProviderContext | null> {
    const data = await this.store.read();
    const ids = Object.keys(data.providers);
    if (ids.length === 0) return null;

    const strategy = data.strategy ?? 'single';

    if (strategy === 'priority_failover') {
      const sorted = ids
        .map((id) => data.providers[id])
        .filter((p) => p && this.store.isProviderAvailable(p, data))
        .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
      const winner = sorted[0] ?? data.providers[ids[0]];
      return winner ? this.buildContext(winner) : null;
    }

    // single strategy
    const id = data.currentProviderId ?? ids[0];
    const p = data.providers[id];
    if (!p || !this.store.isProviderAvailable(p, data)) {
      // Fall back to first available
      const available = ids.map((i) => data.providers[i]).find((q) => q && this.store.isProviderAvailable(q, data));
      return available ? this.buildContext(available) : (p ? this.buildContext(p) : null);
    }
    return this.buildContext(p);
  }

  /**
   * Build a ProviderContext from a ProviderDef.
   * Sets only the env var relevant to the provider's engine — not all of them.
   */
  private buildContext(p: ProviderDef): ProviderContext {
    const raw = p.apiKey ?? '';
    const resolved = resolveEnvRef(raw);
    const apiKey = resolved.length > 0 && !resolved.startsWith('${') ? resolved : undefined;

    const env: Record<string, string> = { ...(p.env ?? {}) };
    if (apiKey) {
      switch (p.engine) {
        case 'claude-code':
          env.ANTHROPIC_API_KEY = apiKey;
          break;
        case 'codex':
          env.CODEX_API_KEY = apiKey;
          env.OPENAI_API_KEY = apiKey; // backward compat per codex CLI docs
          break;
        case 'cursor':
          env.CURSOR_API_KEY = apiKey;
          break;
        case 'opencode':
          env[openCodeEnvVar(p.model)] = apiKey;
          break;
        default:
          env.ANTHROPIC_API_KEY = apiKey;
      }
    }

    return { providerId: p.id, engine: p.engine, model: p.model, apiKey, endpoint: p.endpoint, env };
  }
}
