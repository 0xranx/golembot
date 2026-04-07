function normalizeBaseUrl(baseUrl) {
    return (baseUrl || '').trim().toLowerCase();
}
export function assessCodexProviderCompatibility(provider) {
    if (!provider)
        return undefined;
    const baseUrl = normalizeBaseUrl(provider.baseUrl);
    const customProvider = provider.codexProfile || provider.codexProviderId || provider.baseUrl;
    if (!customProvider)
        return undefined;
    if (baseUrl.includes('/chat/completions')) {
        return {
            likelyIncompatible: true,
            detail: `baseUrl=${provider.baseUrl} targets /chat/completions; Codex needs the OpenAI Responses API (/responses)`,
            warning: 'Codex requires a provider with OpenAI Responses API support. The configured baseUrl points at /chat/completions, so this setup will likely fail.',
        };
    }
    if (baseUrl.includes('/messages') || baseUrl.includes('api.anthropic.com')) {
        return {
            likelyIncompatible: true,
            detail: `baseUrl=${provider.baseUrl} looks Anthropic-compatible; Codex needs the OpenAI Responses API (/responses)`,
            warning: 'Codex requires a provider with OpenAI Responses API support. The configured baseUrl looks Anthropic-compatible, so this setup will likely fail.',
        };
    }
    if (provider.codexWireApi === 'responses') {
        return {
            likelyIncompatible: false,
            detail: 'custom Codex provider is configured with codexWireApi=responses',
            warning: 'Codex requires a provider with OpenAI Responses API support. This provider is configured for Responses mode, but the upstream gateway still needs to support /responses end to end.',
        };
    }
    return {
        likelyIncompatible: false,
        detail: 'custom Codex provider detected — verify that it supports the OpenAI Responses API (/responses)',
        warning: 'Codex requires a provider with OpenAI Responses API support. Providers that only expose /chat/completions or Anthropic-style /messages endpoints will fail.',
    };
}
export function codexProviderWarningFingerprint(provider) {
    if (!provider)
        return undefined;
    return JSON.stringify({
        baseUrl: provider.baseUrl || '',
        codexProfile: provider.codexProfile || '',
        codexProviderId: provider.codexProviderId || '',
        codexWireApi: provider.codexWireApi || '',
    });
}
//# sourceMappingURL=codex-provider-compat.js.map