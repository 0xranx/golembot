import type { ProviderConfig } from './workspace.js';
export interface CodexProviderCompatibility {
    detail: string;
    likelyIncompatible: boolean;
    warning: string;
}
export declare function assessCodexProviderCompatibility(provider?: ProviderConfig): CodexProviderCompatibility | undefined;
export declare function codexProviderWarningFingerprint(provider?: ProviderConfig): string | undefined;
//# sourceMappingURL=codex-provider-compat.d.ts.map