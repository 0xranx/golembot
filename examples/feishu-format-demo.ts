/**
 * Feishu Message Format Demo
 *
 * Visually demonstrates how Markdown text is converted to Feishu
 * post (rich text) and interactive card formats.
 *
 * Run:
 *   pnpm run build && npx tsx examples/feishu-format-demo.ts
 */

import { hasMarkdown, markdownToPost, markdownToCard } from '../dist/channels/feishu-format.js';

// ── Helpers ──────────────────────────────────────────────

const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

let caseNum = 0;
let passed = 0;
let failed = 0;

function section(title: string) {
  console.log(`\n${CYAN}${BOLD}═══ ${title} ═══${RESET}\n`);
}

function demo(label: string, input: string) {
  caseNum++;
  console.log(`${YELLOW}${BOLD}Case ${caseNum}: ${label}${RESET}`);
  console.log(`${DIM}Input:${RESET}`);
  for (const line of input.split('\n')) {
    console.log(`  ${DIM}${line}${RESET}`);
  }

  const isMd = hasMarkdown(input);
  console.log(`  hasMarkdown: ${isMd ? GREEN + 'true' : RED + 'false'}${RESET}`);

  if (isMd) {
    // Post format
    const post = markdownToPost(input);
    console.log(`\n  ${GREEN}Post (msg_type: "post"):${RESET}`);
    for (const line of post.zh_cn.content) {
      const rendered = line.map(el => {
        const style = el.style ? ` [${el.style.join(',')}]` : '';
        if (el.tag === 'a') return `<a href="${el.href}">${el.text}</a>`;
        return `${el.text}${style}`;
      }).join('');
      console.log(`    ${rendered}`);
    }

    // Card format
    const card = markdownToCard(input);
    console.log(`\n  ${GREEN}Card (msg_type: "interactive"):${RESET}`);
    const content = card.elements[0]?.text?.content ?? '';
    for (const line of content.split('\n')) {
      console.log(`    ${line}`);
    }
  } else {
    console.log(`  ${DIM}→ Will send as msg_type: "text" (no conversion)${RESET}`);
  }

  console.log();
}

function verify(label: string, condition: boolean) {
  if (condition) {
    passed++;
    console.log(`  ${GREEN}✓ ${label}${RESET}`);
  } else {
    failed++;
    console.log(`  ${RED}✗ ${label}${RESET}`);
  }
}

// ── Demo Cases ───────────────────────────────────────────

section('1. Markdown Detection');

demo('Plain text (no conversion)', 'Hello, how are you today?');

demo('Text with bold', 'This is **important** information.');

demo('Text with link', 'Check out [GolemBot](https://github.com).');

section('2. Headings & Lists');

demo('Heading', '## Project Overview');

demo('Unordered list', '- First item\n- Second item\n- Third item');

demo('Ordered list', '1. Install dependencies\n2. Configure settings\n3. Run the bot');

demo('Checkbox list', '- [x] Setup complete\n- [ ] Tests pending\n- [x] Docs updated');

section('3. Code');

demo('Inline code', 'Use `console.log()` for debugging.');

demo('Code block', '```typescript\nfunction greet(name: string) {\n  return `Hello, ${name}!`;\n}\n```');

demo('Unclosed code block', '```python\nprint("hello")');

section('4. Rich Formatting');

demo('Bold + italic + link in one line',
  'Read the **docs** at [GolemBot](https://github.com) for *details*.');

demo('Strikethrough', 'This feature is ~~deprecated~~ and should not be used.');

demo('Blockquote', '> This is an important note from the team.');

demo('Horizontal rule', '---');

section('5. Complex Mixed Content');

demo('Full markdown document',
  `## Meeting Notes

- [x] Review PR #42
- [ ] Deploy to staging

Key findings:

1. Performance improved by **30%**
2. See [dashboard](https://metrics.example.com) for details

\`\`\`bash
npm run deploy --env staging
\`\`\`

> Action: Follow up with the team by Friday.`);

// ── Verification ─────────────────────────────────────────

section('6. Automated Verification');

// Plain text should NOT be detected as markdown
verify('Plain text → hasMarkdown = false',
  !hasMarkdown('hello world'));

verify('Number → hasMarkdown = false',
  !hasMarkdown('12345'));

// Markdown should be detected
verify('Bold → hasMarkdown = true',
  hasMarkdown('this is **bold**'));

verify('Code block → hasMarkdown = true',
  hasMarkdown('```js\ncode\n```'));

// Post conversion checks
const post = markdownToPost('## Title\n\n- item 1\n- **bold item**');
verify('Post: heading becomes bold style',
  post.zh_cn.content[0][0].style?.includes('bold') === true);

verify('Post: list item gets bullet prefix',
  post.zh_cn.content[1][0].text === '\u2022 ');

verify('Post: bold in list item has bold style',
  post.zh_cn.content[2].some(el => el.style?.includes('bold')));

// Card conversion checks
const card = markdownToCard('- [x] done\n> quote');
const cardContent = card.elements[0]?.text?.content ?? '';
verify('Card: checkbox converted to emoji',
  cardContent.includes('\u2705 done'));

verify('Card: blockquote converted to emoji prefix',
  cardContent.includes('\uD83D\uDCAC quote'));

verify('Card: wide_screen_mode enabled',
  card.config.wide_screen_mode === true);

// Code block handling
const codePost = markdownToPost('```js\nconsole.log(1)\n```');
verify('Post: code block has opening border',
  codePost.zh_cn.content[0][0].text?.includes('js') === true);

verify('Post: code block content has pipe prefix',
  codePost.zh_cn.content[1][0].text?.startsWith('\u2502') === true);

verify('Post: code block has closing border',
  codePost.zh_cn.content[2][0].text?.includes('\u2518') === true);

// Unclosed code block
const unclosed = markdownToPost('```js\ncode here');
verify('Post: unclosed code block auto-closed',
  unclosed.zh_cn.content[unclosed.zh_cn.content.length - 1][0].text?.includes('\u2518') === true);

// ── Summary ──────────────────────────────────────────────

section('Summary');

console.log(`  Total: ${passed + failed} checks`);
console.log(`  ${GREEN}Passed: ${passed}${RESET}`);
if (failed > 0) {
  console.log(`  ${RED}Failed: ${failed}${RESET}`);
  process.exit(1);
} else {
  console.log(`\n  ${GREEN}${BOLD}All checks passed!${RESET}\n`);
}
