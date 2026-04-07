/**
 * Telegram message format utilities.
 *
 * Converts standard Markdown to Telegram-compatible HTML.
 * Reference: https://core.telegram.org/bots/api#html-style
 */
/**
 * Convert standard Markdown text to Telegram-compatible HTML.
 *
 * Key conversions:
 * - `**bold**` → `<b>bold</b>`
 * - `*italic*` / `_italic_` → `<i>italic</i>`
 * - `~~strike~~` → `<s>strike</s>`
 * - `` `code` `` → `<code>code</code>`
 * - ` ```lang\n...\n``` ` → `<pre><code class="language-lang">...</code></pre>`
 * - `[text](url)` → `<a href="url">text</a>`
 * - `# Heading` → `<b>Heading</b>`
 * - Escapes `&`, `<`, `>` in text content
 */
export declare function markdownToHtml(markdown: string): string;
//# sourceMappingURL=telegram-format.d.ts.map