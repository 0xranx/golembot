/**
 * Slack message format utilities.
 *
 * Converts standard Markdown to Slack mrkdwn format.
 * Reference: https://api.slack.com/reference/surfaces/formatting
 */
/**
 * Convert standard Markdown text to Slack mrkdwn format.
 *
 * Key conversions (outside code blocks):
 * - `**bold**` → `*bold*`
 * - `*italic*` → `_italic_`
 * - `~~strike~~` → `~strike~`
 * - `[text](url)` → `<url|text>`
 * - `# Heading` → `*Heading*`
 * - Escapes `&`, `<`, `>` in regular text
 * - Preserves Slack tokens like `<@U123>`, `<#C123>`, `<!here>`
 */
export declare function markdownToMrkdwn(markdown: string): string;
//# sourceMappingURL=slack-format.d.ts.map