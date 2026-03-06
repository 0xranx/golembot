/**
 * Slack message format utilities.
 *
 * Converts standard Markdown to Slack mrkdwn format.
 * Reference: https://api.slack.com/reference/surfaces/formatting
 */

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

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
export function markdownToMrkdwn(markdown: string): string {
  return processOutsideCodeBlocks(markdown, convertSegment);
}

// ---------------------------------------------------------------------------
// Code block splitting
// ---------------------------------------------------------------------------

/**
 * Split text into code-block and non-code-block segments.
 * Only non-code-block segments are passed to `transform`.
 */
function processOutsideCodeBlocks(
  text: string,
  transform: (segment: string) => string,
): string {
  const lines = text.split('\n');
  const result: string[] = [];
  let buf: string[] = [];
  let inCode = false;

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      if (!inCode) {
        // Flush non-code buffer
        if (buf.length) {
          result.push(transform(buf.join('\n')));
          buf = [];
        }
        inCode = true;
        result.push(line); // opening fence
      } else {
        // Flush code buffer
        result.push(...buf);
        buf = [];
        inCode = false;
        result.push(line); // closing fence
      }
      continue;
    }
    buf.push(line);
  }

  // Remaining buffer
  if (buf.length) {
    if (inCode) {
      result.push(...buf);
    } else {
      result.push(transform(buf.join('\n')));
    }
  }

  return result.join('\n');
}

// ---------------------------------------------------------------------------
// Segment conversion (non-code-block text)
// ---------------------------------------------------------------------------

/** Placeholder prefix unlikely to appear in real text. */
const PH = '\x00PH';

function convertSegment(text: string): string {
  // Step 1: Protect inline code spans
  const inlineCodeSlots: string[] = [];
  let s = text.replace(/`([^`]+)`/g, (_, code) => {
    const idx = inlineCodeSlots.length;
    inlineCodeSlots.push(`\`${code}\``);
    return `${PH}IC${idx}\x00`;
  });

  // Step 2: Protect existing Slack tokens (<@U123>, <#C123>, <!here>, <url|label>)
  const slackTokenSlots: string[] = [];
  s = s.replace(/<(?:@[A-Z0-9]+|#[A-Z0-9]+|![a-z]+(?:\^[A-Z0-9]+)?|https?:\/\/[^|>]+(?:\|[^>]+)?)>/gi, (tok) => {
    const idx = slackTokenSlots.length;
    slackTokenSlots.push(tok);
    return `${PH}ST${idx}\x00`;
  });

  // Step 3: Escape HTML entities (before inserting any Slack syntax)
  s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Step 4: Convert Markdown links [text](url) → <url|text>
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => `<${url}|${label}>`);

  // Step 5: Convert bold **text** or __text__ → placeholder (before italic to avoid re-matching)
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

  // Step 6: Convert headings → bold placeholder
  s = s.replace(/^#{1,6}\s+(.+)$/gm, (_, content) => {
    const idx = boldSlots.length;
    boldSlots.push(content);
    return `${PH}BD${idx}\x00`;
  });

  // Step 6b: Convert unordered list items  - item → • item
  s = s.replace(/^- (.+)$/gm, '• $1');

  // Step 7: Convert strikethrough ~~text~~ → ~text~
  s = s.replace(/~~([^~]+)~~/g, '~$1~');

  // Step 8: Convert italic *text* → _text_ (single star, not inside words)
  s = s.replace(/(?<!\w)\*([^*]+)\*(?!\w)/g, '_$1_');

  // Step 9: Restore bold placeholders → *text*
  for (let i = boldSlots.length - 1; i >= 0; i--) {
    s = s.replace(`${PH}BD${i}\x00`, `*${boldSlots[i]}*`);
  }

  // Step 11: Restore Slack tokens
  for (let i = slackTokenSlots.length - 1; i >= 0; i--) {
    s = s.replace(`${PH}ST${i}\x00`, slackTokenSlots[i]);
  }

  // Step 12: Restore inline code spans
  for (let i = inlineCodeSlots.length - 1; i >= 0; i--) {
    s = s.replace(`${PH}IC${i}\x00`, inlineCodeSlots[i]);
  }

  return s;
}
