import type { ProviderConfig } from './workspace.js';
export interface ProviderPreset {
    /** Preset name (e.g. "minimax", "deepseek") */
    name: string;
    /** Display name */
    displayName: string;
    /** API base URL */
    baseUrl: string;
    /** Recommended default model */
    defaultModel: string;
    /** Available models */
    availableModels?: string[];
    /** Env var name for the API key (hint for the user) */
    apiKeyEnvVar: string;
    /** Description */
    description?: string;
}
export declare const providerPresets: ProviderPreset[];
/** Create a ProviderConfig from a preset name */
export declare function createProviderFromPreset(presetName: string, apiKey?: string, modelOverride?: string): ProviderConfig | undefined;
//# sourceMappingURL=provider-presets.d.ts.map