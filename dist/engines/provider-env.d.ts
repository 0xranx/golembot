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
export declare function claudeProviderEnv(provider: ProviderConfig): ProviderEnv;
/** Map provider config to Codex env vars */
export declare function codexProviderEnv(provider: ProviderConfig): ProviderEnv;
/** Map provider config to Cursor env vars */
export declare function cursorProviderEnv(provider: ProviderConfig): ProviderEnv;
/** Map provider config to OpenCode env vars */
export declare function openCodeProviderEnv(provider: ProviderConfig, model?: string): ProviderEnv;
//# sourceMappingURL=provider-env.d.ts.map