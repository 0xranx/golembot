/**
 * Telegram message format utilities.
 *
 * Converts standard Markdown to Telegram-compatible HTML.
 * Reference: https://core.telegram.org/bots/api#html-style
 */

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

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
export function markdownToHtml(markdown: string): string {
  // Step 1: Process fenced code blocks first
  const { segments } = splitCodeBlocks(markdown);

  const result: string[] = [];
  for (const seg of segments) {
    if (seg.type === 'code') {
      const langAttr = seg.lang ? ` class="language-${escapeHtml(seg.lang)}"` : '';
      result.push(`<pre><code${langAttr}>${escapeHtml(seg.content)}</code></pre>`);
    } else {
      result.push(convertTextSegment(seg.content));
    }
  }

  return result.join('\n');
}

// ---------------------------------------------------------------------------
// Code block splitting
// ---------------------------------------------------------------------------

interface Segment {
  type: 'text' | 'code';
  content: string;
  lang?: string;
}

function splitCodeBlocks(text: string): { segments: Segment[] } {
  const lines = text.split('\n');
  const segments: Segment[] = [];
  let textBuf: string[] = [];
  let codeBuf: string[] = [];
  let inCode = false;
  let codeLang = '';

  for (const line of lines) {
    const fenceMatch = line.match(/^\s*```(\w*)\s*$/);
    if (fenceMatch) {
      if (!inCode) {
        // Flush text buffer
        if (textBuf.length) {
          segments.push({ type: 'text', content: textBuf.join('\n') });
          textBuf = [];
        }
        inCode = true;
        codeLang = fenceMatch[1] || '';
      } else {
        // Flush code buffer
        segments.push({ type: 'code', content: codeBuf.join('\n'), lang: codeLang });
        codeBuf = [];
        inCode = false;
        codeLang = '';
      }
      continue;
    }

    if (inCode) {
      codeBuf.push(line);
    } else {
      textBuf.push(line);
    }
  }

  // Handle unclosed code block
  if (inCode && codeBuf.length) {
    segments.push({ type: 'code', content: codeBuf.join('\n'), lang: codeLang });
  }
  if (textBuf.length) {
    segments.push({ type: 'text', content: textBuf.join('\n') });
  }

  return { segments };
}

// ---------------------------------------------------------------------------
// Text segment conversion
// ---------------------------------------------------------------------------

/** Placeholder prefix for inline code protection. */
const PH = '\x00PH';

function convertTextSegment(text: string): string {
  // Step 1: Protect inline code spans
  const codeSlots: string[] = [];
  let s = text.replace(/`([^`]+)`/g, (_, code) => {
    const idx = codeSlots.length;
    codeSlots.push(`<code>${escapeHtml(code)}</code>`);
    return `${PH}${idx}\x00`;
  });

  // Step 2: Escape HTML entities in remaining text
  s = escapeHtml(s);

  // Step 3: Convert Markdown links [text](url) → <a href="url">text</a>
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) =>
    `<a href="${url}">${label}</a>`);

  // Step 4: Convert bold **text** / __text__ → placeholder (before italic to avoid re-matching)
  const boldSlots: string[] = [];
  s = s.replace(/\*\*([^*]+)\*\*/g, (_, content) => {
    const idx = boldSlots.length;
    boldSlots.push(content);
    return `${PH}BD${idx}\x00`;
  });
  s = s.replace(/__([^_]+)__/g, (_, content) => {
    const idx = boldSlots.length;
    boldSlots.push(content);
    return `${PH}BD${idx}\x00`;
  });

  // Step 5: Convert headings → bold placeholder
  s = s.replace(/^#{1,6}\s+(.+)$/gm, (_, content) => {
    const idx = boldSlots.length;
    boldSlots.push(content);
    return `${PH}BD${idx}\x00`;
  });

  // Step 5b: Convert unordered list items  - item → • item
  s = s.replace(/^- (.+)$/gm, '• $1');

  // Step 6: Convert strikethrough ~~text~~
  s = s.replace(/~~([^~]+)~~/g, '<s>$1</s>');

  // Step 7: Convert italic *text* (remaining single stars after bold extraction)
  s = s.replace(/(?<!\w)\*([^*]+)\*(?!\w)/g, '<i>$1</i>');

  // Step 8: Convert italic _text_ (word-boundary aware)
  s = s.replace(/(?<!\w)_([^_]+)_(?!\w)/g, '<i>$1</i>');

  // Step 9a: Restore bold placeholders → <b>text</b>
  for (let i = boldSlots.length - 1; i >= 0; i--) {
    s = s.replace(`${PH}BD${i}\x00`, `<b>${boldSlots[i]}</b>`);
  }

  // Step 9b: Convert blockquotes > text → <blockquote>text</blockquote>
  // Merge consecutive > lines into a single blockquote block
  const lines = s.split('\n');
  const merged: string[] = [];
  let bqBuf: string[] = [];
  for (const line of lines) {
    const bqMatch = line.match(/^&gt;\s?(.*)/);
    if (bqMatch) {
      bqBuf.push(bqMatch[1]);
    } else {
      if (bqBuf.length) {
        merged.push(`<blockquote>${bqBuf.join('\n')}</blockquote>`);
        bqBuf = [];
      }
      merged.push(line);
    }
  }
  if (bqBuf.length) {
    merged.push(`<blockquote>${bqBuf.join('\n')}</blockquote>`);
  }
  s = merged.join('\n');

  // Step 10: Restore inline code placeholders
  for (let i = codeSlots.length - 1; i >= 0; i--) {
    s = s.replace(`${PH}${i}\x00`, codeSlots[i]);
  }

  return s;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
