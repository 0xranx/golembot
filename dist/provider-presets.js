export const providerPresets = [
    {
        name: 'anthropic',
        displayName: 'Anthropic (Official)',
        baseUrl: 'https://api.anthropic.com',
        defaultModel: 'claude-sonnet-4-20250514',
        apiKeyEnvVar: 'ANTHROPIC_API_KEY',
        description: 'Anthropic official API',
    },
    {
        name: 'openai',
        displayName: 'OpenAI (Official)',
        baseUrl: 'https://api.openai.com/v1',
        defaultModel: 'gpt-5.4',
        apiKeyEnvVar: 'OPENAI_API_KEY',
        description: 'OpenAI official API',
    },
    {
        name: 'minimax',
        displayName: 'MiniMax',
        baseUrl: 'https://api.minimax.chat/v1',
        defaultModel: 'minimax-text-01',
        apiKeyEnvVar: 'MINIMAX_API_KEY',
        description: 'MiniMax API (OpenAI-compatible)',
    },
    {
        name: 'deepseek',
        displayName: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com',
        defaultModel: 'deepseek-chat',
        apiKeyEnvVar: 'DEEPSEEK_API_KEY',
        description: 'DeepSeek API',
    },
    {
        name: 'openrouter',
        displayName: 'OpenRouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        defaultModel: 'anthropic/claude-sonnet-4',
        apiKeyEnvVar: 'OPENROUTER_API_KEY',
        description: 'OpenRouter unified gateway (100+ models)',
    },
    {
        name: 'siliconflow',
        displayName: 'SiliconFlow',
        baseUrl: 'https://api.siliconflow.cn/v1',
        defaultModel: 'deepseek-ai/DeepSeek-V3',
        apiKeyEnvVar: 'SILICONFLOW_API_KEY',
        description: 'SiliconFlow API',
    },
];
/** Create a ProviderConfig from a preset name */
export function createProviderFromPreset(presetName, apiKey, modelOverride) {
    const preset = providerPresets.find((p) => p.name === presetName);
    if (!preset)
        return undefined;
    return {
        baseUrl: preset.baseUrl,
        apiKey: apiKey || `\${${preset.apiKeyEnvVar}}`,
        model: modelOverride || preset.defaultModel,
    };
}
//# sourceMappingURL=provider-presets.js.map