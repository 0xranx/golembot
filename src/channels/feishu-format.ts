/**
 * Feishu message format utilities.
 *
 * Converts Markdown text to Feishu post (rich text) or interactive card format.
 * Reference: OpenClaw feishu plugin markdown.ts
 */

// ---------------------------------------------------------------------------
// Post (rich text) types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Card (interactive) types
// ---------------------------------------------------------------------------

export interface CardElement {
  tag: string;
  text?: { tag: string; content: string };
  content?: string;
  text_size?: string;
}

export interface CardContent {
  config: { wide_screen_mode: boolean };
  elements: CardElement[];
}

// ---------------------------------------------------------------------------
// Markdown detection
// ---------------------------------------------------------------------------

const MD_PATTERNS: RegExp[] = [
  /^#{1,6}\s/m,                // headings
  /\*\*[^*]+\*\*/,            // bold
  /\*[^*]+\*/,                // italic
  /\[[^\]]+\]\([^)]+\)/,      // links
  /^[-*]\s/m,                 // unordered list
  /^\d+\.\s/m,                // ordered list
  /^[-*]\s+\[[ xX]\]/m,      // checkbox
  /`[^`]+`/,                  // inline code
  /^[-*_]{3,}$/m,             // horizontal rule
  /^```/m,                    // code block
  /^\|.+\|/m,                 // table
  /^>/m,                      // blockquote
  /~~[^~]+~~/,                // strikethrough
];

/** Detect whether text contains Markdown formatting. */
export function hasMarkdown(text: string): boolean {
  return MD_PATTERNS.some((p) => p.test(text));
}

// ---------------------------------------------------------------------------
// Markdown -> Post (rich text)
// ---------------------------------------------------------------------------

/** Convert Markdown text to Feishu post rich-text structure. */
export function markdownToPost(markdown: string): PostContent {
  const lines = markdown.split('\n');
  const content: PostElement[][] = [];

  let inCodeBlock = false;
  let codeBlockLang = '';

  for (const line of lines) {
    const codeBlockMatch = line.match(/^\s*```(\w*)\s*$/);
    if (codeBlockMatch) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeBlockLang = codeBlockMatch[1] || 'code';
        content.push([{ tag: 'text', text: `\u250C\u2500 ${codeBlockLang} \u2500\u2510` }]);
      } else {
        inCodeBlock = false;
        content.push([{ tag: 'text', text: '\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518' }]);
        codeBlockLang = '';
      }
      continue;
    }

    if (inCodeBlock) {
      content.push([{ tag: 'text', text: `\u2502 ${line}` }]);
      continue;
    }

    const elements = parseLine(line);
    if (elements.length > 0) {
      content.push(elements);
    }
  }

  // Close unclosed code block
  if (inCodeBlock) {
    content.push([{ tag: 'text', text: '\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518' }]);
  }

  return { zh_cn: { content } };
}

/** Parse a single line of Markdown into PostElements. */
function parseLine(line: string): PostElement[] {
  const trimmed = line.trim();
  if (!trimmed) return [];

  // Heading -> bold
  const headingMatch = trimmed.match(/^#{1,6}\s+(.+)$/);
  if (headingMatch) {
    return [{ tag: 'text', text: headingMatch[1], style: ['bold'] }];
  }

  // Checkbox (must check before plain list)
  const checkboxMatch = trimmed.match(/^[-*]\s+\[([ xX])\]\s+(.+)$/);
  if (checkboxMatch) {
    const icon = checkboxMatch[1].toLowerCase() === 'x' ? '\u2705 ' : '\u2B1C ';
    return [{ tag: 'text', text: icon }, ...parseInline(checkboxMatch[2])];
  }

  // Unordered list
  const listMatch = trimmed.match(/^[-*]\s+(.+)$/);
  if (listMatch) {
    return [{ tag: 'text', text: '\u2022 ' }, ...parseInline(listMatch[1])];
  }

  // Ordered list
  const orderedMatch = trimmed.match(/^(\d+)\.\s+(.+)$/);
  if (orderedMatch) {
    return [{ tag: 'text', text: `${orderedMatch[1]}. ` }, ...parseInline(orderedMatch[2])];
  }

  // Horizontal rule
  if (/^[-*_]{3,}$/.test(trimmed)) {
    return [{ tag: 'text', text: '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500' }];
  }

  // Blockquote
  const quoteMatch = trimmed.match(/^>\s*(.*)$/);
  if (quoteMatch) {
    return [{ tag: 'text', text: '\u275D ' }, ...parseInline(quoteMatch[1])];
  }

  // Plain line
  return parseInline(trimmed);
}

/** Parse inline Markdown elements. */
function parseInline(text: string): PostElement[] {
  const elements: PostElement[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    // Link [text](url)
    const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/);
    if (linkMatch) {
      elements.push({ tag: 'a', text: linkMatch[1], href: linkMatch[2] });
      remaining = remaining.slice(linkMatch[0].length);
      continue;
    }

    // Bold **text** or __text__
    const boldMatch = remaining.match(/^\*\*([^*]+)\*\*/) || remaining.match(/^__([^_]+)__/);
    if (boldMatch) {
      elements.push({ tag: 'text', text: boldMatch[1], style: ['bold'] });
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    // Strikethrough ~~text~~
    const strikeMatch = remaining.match(/^~~([^~]+)~~/);
    if (strikeMatch) {
      elements.push({ tag: 'text', text: strikeMatch[1], style: ['lineThrough'] });
      remaining = remaining.slice(strikeMatch[0].length);
      continue;
    }

    // Italic *text* or _text_
    const italicMatch = remaining.match(/^\*([^*]+)\*/) || remaining.match(/^_([^_]+)_/);
    if (italicMatch) {
      elements.push({ tag: 'text', text: italicMatch[1], style: ['italic'] });
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }

    // Inline triple-backtick code ```code```
    const inlineCodeBlockMatch =
      remaining.match(/^```(\w*)\s+(.+?)```/) || remaining.match(/^```(.+?)```/);
    if (inlineCodeBlockMatch) {
      const code = inlineCodeBlockMatch[2] || inlineCodeBlockMatch[1];
      elements.push({ tag: 'text', text: `\u300C${code}\u300D` });
      remaining = remaining.slice(inlineCodeBlockMatch[0].length);
      continue;
    }

    // Inline code `code`
    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch) {
      elements.push({ tag: 'text', text: `\u300C${codeMatch[1]}\u300D` });
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    // Plain characters until next special char
    const nextSpecial = remaining.search(/[[\]*_`~]/);
    if (nextSpecial === -1) {
      elements.push({ tag: 'text', text: remaining });
      break;
    } else if (nextSpecial === 0) {
      elements.push({ tag: 'text', text: remaining[0] });
      remaining = remaining.slice(1);
    } else {
      elements.push({ tag: 'text', text: remaining.slice(0, nextSpecial) });
      remaining = remaining.slice(nextSpecial);
    }
  }

  return elements;
}

// ---------------------------------------------------------------------------
// Markdown -> Card (interactive)
// ---------------------------------------------------------------------------

/**
 * Convert Markdown text to a Feishu interactive card structure.
 *
 * Uses the card v2 `markdown` component which natively renders bold, italic,
 * strikethrough, links, ordered/unordered lists, and code blocks.
 * We only preprocess syntax that the markdown component does not support
 * (checkboxes, blockquotes).
 *
 * Note: nested/indented lists are not supported by Feishu's markdown component.
 */
export function markdownToCard(markdown: string): CardContent {
  const preprocessed = preprocessForCard(markdown);

  return {
    config: { wide_screen_mode: true },
    elements: [
      {
        tag: 'markdown',
        content: preprocessed,
      },
    ],
  };
}

/**
 * Replace `@name` patterns in post content with Feishu `{ tag: 'at', user_id }` elements.
 * Mutates the post in-place.
 */
export function injectMentionsIntoPost(
  post: PostContent,
  mentions: Array<{ name: string; platformId: string }>,
): void {
  if (!mentions.length) return;
  const mentionMap = new Map(mentions.map(m => [m.name, m.platformId]));

  for (let i = 0; i < post.zh_cn.content.length; i++) {
    const line = post.zh_cn.content[i];
    const newLine: PostElement[] = [];

    for (const el of line) {
      if (el.tag !== 'text' || !el.text) {
        newLine.push(el);
        continue;
      }

      // Split text on @name patterns and replace with at elements
      let remaining = el.text;
      const mentionPattern = /@([\w\u4e00-\u9fff]{1,20})/g;
      let lastIdx = 0;
      let match;

      // Reset regex state
      mentionPattern.lastIndex = 0;
      const parts: PostElement[] = [];

      while ((match = mentionPattern.exec(remaining)) !== null) {
        const name = match[1];
        const userId = mentionMap.get(name);
        if (!userId) continue;

        // Text before the mention
        if (match.index > lastIdx) {
          const beforeText = remaining.slice(lastIdx, match.index);
          parts.push({ ...el, text: beforeText });
        }

        // The @mention element
        parts.push({ tag: 'at', user_id: userId });

        lastIdx = match.index + match[0].length;
      }

      if (parts.length === 0) {
        // No mentions found in this element
        newLine.push(el);
      } else {
        // Remaining text after last mention
        if (lastIdx < remaining.length) {
          parts.push({ ...el, text: remaining.slice(lastIdx) });
        }
        newLine.push(...parts);
      }
    }

    post.zh_cn.content[i] = newLine;
  }
}

/** Preprocess Markdown for lark_md compatibility. */
function preprocessForCard(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();

      // Checkbox -> emoji
      const cbMatch = trimmed.match(/^[-*]\s+\[([ xX])\]\s+(.+)$/);
      if (cbMatch) {
        const icon = cbMatch[1].toLowerCase() === 'x' ? '\u2705' : '\u2B1C';
        return `${icon} ${cbMatch[2]}`;
      }

      // Blockquote -> emoji prefix
      const quoteMatch = trimmed.match(/^>\s*(.*)$/);
      if (quoteMatch) {
        return `\uD83D\uDCAC ${quoteMatch[1]}`;
      }

      return line;
    })
    .join('\n');
}
