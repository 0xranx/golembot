import type { ProviderConfig } from '../workspace.js';

export interface ProviderEnv {
  [key: string]: string;
}

/**
 * Map provider config to Claude Code env vars.
 *
 * When routing Claude Code to a third-party provider (e.g. MiniMax), we set
 * ANTHROPIC_API_KEY directly (Claude Code recognizes it as `apiKeySource`).
 * The caller (claude-code.ts) is responsible for deleting any pre-existing
 * ANTHROPIC_API_KEY from process.env before applying these overrides.
 *
 * We also set:
 * - ANTHROPIC_BASE_URL to route requests to the custom provider
 * - ANTHROPIC_MODEL (+ small/fast/sonnet/opus/haiku variants) so the model
 *   is resolved via env vars rather than the --model flag (which triggers
 *   client-side validation against Anthropic's known model list)
 * - CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 to prevent the CLI from
 *   calling Anthropic endpoints for telemetry/model listing
 */
export function claudeProviderEnv(provider: ProviderConfig): ProviderEnv {
  const env: ProviderEnv = {};
  if (provider.apiKey) env.ANTHROPIC_API_KEY = provider.apiKey;
  if (provider.baseUrl) env.ANTHROPIC_BASE_URL = provider.baseUrl;
  if (provider.model) {
    env.ANTHROPIC_MODEL = provider.model;
    env.ANTHROPIC_SMALL_FAST_MODEL = provider.model;
    env.ANTHROPIC_DEFAULT_SONNET_MODEL = provider.model;
    env.ANTHROPIC_DEFAULT_OPUS_MODEL = provider.model;
    env.ANTHROPIC_DEFAULT_HAIKU_MODEL = provider.model;
  }
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';
  return env;
}

/** Map provider config to Codex env vars */
export function codexProviderEnv(provider: ProviderConfig): ProviderEnv {
  const env: ProviderEnv = {};
  if (provider.apiKey) {
    env.CODEX_API_KEY = provider.apiKey;
    env.OPENAI_API_KEY = provider.apiKey;
  }
  if (provider.baseUrl) env.OPENAI_BASE_URL = provider.baseUrl;
  return env;
}

/** Map provider config to Cursor env vars */
export function cursorProviderEnv(provider: ProviderConfig): ProviderEnv {
  const env: ProviderEnv = {};
  if (provider.apiKey) env.CURSOR_API_KEY = provider.apiKey;
  if (provider.baseUrl) env.CURSOR_API_BASE_URL = provider.baseUrl;
  return env;
}

/** Provider-prefix → env-var mapping for OpenCode */
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

/** Map provider config to OpenCode env vars */
export function openCodeProviderEnv(provider: ProviderConfig, model?: string): ProviderEnv {
  const env: ProviderEnv = {};
  if (provider.apiKey) {
    const providerPrefix = model?.split('/')[0] || 'openrouter';
    const envVar =
      OPENCODE_PROVIDER_ENV[providerPrefix] || `${providerPrefix.toUpperCase().replace(/-/g, '_')}_API_KEY`;
    env[envVar] = provider.apiKey;
  }
  if (provider.baseUrl) env.OPENAI_BASE_URL = provider.baseUrl;
  return env;
}
