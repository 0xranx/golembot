/**
 * Feishu message format utilities.
 *
 * Converts Markdown text to Feishu post (rich text) or interactive card format.
 * Reference: OpenClaw feishu plugin markdown.ts
 */
export interface PostElement {
    tag: 'text' | 'a' | 'at' | 'img';
    text?: string;
    href?: string;
    user_id?: string;
    image_key?: string;
    style?: ('bold' | 'italic' | 'underline' | 'lineThrough')[];
}
export interface PostContent {
    zh_cn: {
        content: PostElement[][];
    };
}
export interface CardElement {
    tag: string;
    text?: {
        tag: string;
        content: string;
    };
    content?: string;
    text_size?: string;
}
export interface CardContent {
    schema: string;
    body: {
        elements: CardElement[];
    };
    header?: {
        title: {
            tag: string;
            content: string;
        };
        template?: string;
    };
}
/** Detect whether text contains Markdown formatting. */
export declare function hasMarkdown(text: string): boolean;
/** Convert Markdown text to Feishu post rich-text structure. */
export declare function markdownToPost(markdown: string): PostContent;
/**
 * Convert Markdown text to a Feishu interactive card v2 structure.
 *
 * Uses the card v2 `markdown` component which natively renders full CommonMark
 * syntax including bold, italic, strikethrough, links, lists, code blocks,
 * blockquotes, headings, and tables.
 *
 * Only checkboxes need preprocessing (not supported by card markdown).
 */
export declare function markdownToCard(markdown: string): CardContent;
/**
 * Replace `@name` patterns in post content with Feishu `{ tag: 'at', user_id }` elements.
 * Mutates the post in-place.
 */
export declare function injectMentionsIntoPost(post: PostContent, mentions: Array<{
    name: string;
    platformId: string;
}>): void;
//# sourceMappingURL=feishu-format.d.ts.map