import { describe, it, expect } from 'vitest';
import {
  hasMarkdown,
  markdownToPost,
  markdownToCard,
  injectMentionsIntoPost,
  type PostElement,
  type PostContent,
} from '../channels/feishu-format.js';

// ---------------------------------------------------------------------------
// hasMarkdown
// ---------------------------------------------------------------------------

describe('hasMarkdown', () => {
  it('returns false for plain text', () => {
    expect(hasMarkdown('hello world')).toBe(false);
    expect(hasMarkdown('just a sentence.')).toBe(false);
    expect(hasMarkdown('12345')).toBe(false);
  });

  it('detects headings', () => {
    expect(hasMarkdown('# Title')).toBe(true);
    expect(hasMarkdown('## Subtitle')).toBe(true);
    expect(hasMarkdown('### Deep')).toBe(true);
  });

  it('detects bold', () => {
    expect(hasMarkdown('this is **bold** text')).toBe(true);
  });

  it('detects italic', () => {
    expect(hasMarkdown('this is *italic* text')).toBe(true);
  });

  it('detects strikethrough', () => {
    expect(hasMarkdown('this is ~~deleted~~ text')).toBe(true);
  });

  it('detects links', () => {
    expect(hasMarkdown('click [here](https://example.com)')).toBe(true);
  });

  it('detects unordered lists', () => {
    expect(hasMarkdown('- item one')).toBe(true);
    expect(hasMarkdown('* item two')).toBe(true);
  });

  it('detects ordered lists', () => {
    expect(hasMarkdown('1. first')).toBe(true);
  });

  it('detects checkboxes', () => {
    expect(hasMarkdown('- [x] done')).toBe(true);
    expect(hasMarkdown('- [ ] todo')).toBe(true);
  });

  it('detects inline code', () => {
    expect(hasMarkdown('use `console.log`')).toBe(true);
  });

  it('detects code blocks', () => {
    expect(hasMarkdown('```js\nconsole.log(1)\n```')).toBe(true);
  });

  it('detects horizontal rules', () => {
    expect(hasMarkdown('---')).toBe(true);
    expect(hasMarkdown('***')).toBe(true);
  });

  it('detects tables', () => {
    expect(hasMarkdown('| a | b |\n|---|---|\n| 1 | 2 |')).toBe(true);
  });

  it('detects blockquotes', () => {
    expect(hasMarkdown('> something')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// markdownToPost
// ---------------------------------------------------------------------------

describe('markdownToPost', () => {
  const getContent = (md: string) => markdownToPost(md).zh_cn.content;

  it('converts plain text to a single text element', () => {
    const content = getContent('hello');
    expect(content).toEqual([[{ tag: 'text', text: 'hello' }]]);
  });

  it('skips empty lines', () => {
    const content = getContent('a\n\nb');
    expect(content).toEqual([
      [{ tag: 'text', text: 'a' }],
      [{ tag: 'text', text: 'b' }],
    ]);
  });

  it('converts headings to bold', () => {
    const content = getContent('## Hello World');
    expect(content).toEqual([[{ tag: 'text', text: 'Hello World', style: ['bold'] }]]);
  });

  it('converts unordered list items', () => {
    const content = getContent('- item one');
    expect(content[0][0]).toEqual({ tag: 'text', text: '\u2022 ' });
    expect(content[0][1]).toEqual({ tag: 'text', text: 'item one' });
  });

  it('converts ordered list items', () => {
    const content = getContent('1. first\n2. second');
    expect(content[0][0]).toEqual({ tag: 'text', text: '1. ' });
    expect(content[1][0]).toEqual({ tag: 'text', text: '2. ' });
  });

  it('converts checked checkboxes', () => {
    const content = getContent('- [x] done');
    expect(content[0][0]).toEqual({ tag: 'text', text: '\u2705 ' });
    expect(content[0][1]).toEqual({ tag: 'text', text: 'done' });
  });

  it('converts unchecked checkboxes', () => {
    const content = getContent('- [ ] todo');
    expect(content[0][0]).toEqual({ tag: 'text', text: '\u2B1C ' });
    expect(content[0][1]).toEqual({ tag: 'text', text: 'todo' });
  });

  it('converts horizontal rules', () => {
    const content = getContent('---');
    expect(content[0][0].text).toBe('\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
  });

  it('converts blockquotes', () => {
    const content = getContent('> important note');
    expect(content[0][0]).toEqual({ tag: 'text', text: '\u275D ' });
    expect(content[0][1]).toEqual({ tag: 'text', text: 'important note' });
  });

  it('converts bold inline', () => {
    const content = getContent('this is **bold** text');
    expect(content[0]).toEqual([
      { tag: 'text', text: 'this is ' },
      { tag: 'text', text: 'bold', style: ['bold'] },
      { tag: 'text', text: ' text' },
    ]);
  });

  it('converts italic inline', () => {
    const content = getContent('this is *italic* text');
    expect(content[0]).toEqual([
      { tag: 'text', text: 'this is ' },
      { tag: 'text', text: 'italic', style: ['italic'] },
      { tag: 'text', text: ' text' },
    ]);
  });

  it('converts strikethrough inline', () => {
    const content = getContent('this is ~~deleted~~ text');
    expect(content[0]).toEqual([
      { tag: 'text', text: 'this is ' },
      { tag: 'text', text: 'deleted', style: ['lineThrough'] },
      { tag: 'text', text: ' text' },
    ]);
  });

  it('converts links', () => {
    const content = getContent('click [here](https://example.com)');
    expect(content[0]).toEqual([
      { tag: 'text', text: 'click ' },
      { tag: 'a', text: 'here', href: 'https://example.com' },
    ]);
  });

  it('converts inline code', () => {
    const content = getContent('use `console.log` here');
    expect(content[0]).toEqual([
      { tag: 'text', text: 'use ' },
      { tag: 'text', text: '\u300Cconsole.log\u300D' },
      { tag: 'text', text: ' here' },
    ]);
  });

  it('handles code blocks with language', () => {
    const content = getContent('```js\nconsole.log(1)\n```');
    expect(content[0][0].text).toBe('\u250C\u2500 js \u2500\u2510');
    expect(content[1][0].text).toBe('\u2502 console.log(1)');
    expect(content[2][0].text).toBe('\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518');
  });

  it('handles code blocks without language', () => {
    const content = getContent('```\nsome code\n```');
    expect(content[0][0].text).toBe('\u250C\u2500 code \u2500\u2510');
  });

  it('closes unclosed code blocks', () => {
    const content = getContent('```js\ncode here');
    expect(content.length).toBe(3);
    expect(content[2][0].text).toBe('\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518');
  });

  it('handles mixed inline formatting', () => {
    const content = getContent('**bold** and [link](http://x.com) and `code`');
    const tags = content[0].map((e: PostElement) => e.tag);
    expect(tags).toContain('a');
    const boldEl = content[0].find((e: PostElement) => e.style?.includes('bold'));
    expect(boldEl?.text).toBe('bold');
    const codeEl = content[0].find((e: PostElement) => e.text === '\u300Ccode\u300D');
    expect(codeEl).toBeDefined();
  });

  it('handles multiline markdown', () => {
    const md = '## Title\n\n- item 1\n- item 2\n\nSome **bold** text.';
    const content = getContent(md);
    // Title line
    expect(content[0][0].style).toEqual(['bold']);
    // At least 4 lines (title, 2 items, text)
    expect(content.length).toBeGreaterThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// markdownToCard
// ---------------------------------------------------------------------------

describe('markdownToCard', () => {
  it('wraps text in a card v2 markdown element with wide_screen_mode', () => {
    const card = markdownToCard('hello');
    expect(card.config.wide_screen_mode).toBe(true);
    expect(card.elements.length).toBe(1);
    expect(card.elements[0].tag).toBe('markdown');
    expect(card.elements[0].content).toBe('hello');
  });

  it('preserves markdown formatting for native rendering', () => {
    const card = markdownToCard('**bold** and *italic*');
    expect(card.elements[0].content).toBe('**bold** and *italic*');
  });

  it('preserves ordered and unordered lists for native rendering', () => {
    const md = '- item 1\n- item 2\n1. first\n2. second';
    const card = markdownToCard(md);
    expect(card.elements[0].content).toBe(md);
  });

  it('converts checkboxes to emoji', () => {
    const card = markdownToCard('- [x] done\n- [ ] todo');
    const content = card.elements[0].content ?? '';
    expect(content).toContain('\u2705 done');
    expect(content).toContain('\u2B1C todo');
  });

  it('converts blockquotes to emoji prefix', () => {
    const card = markdownToCard('> important');
    const content = card.elements[0].content ?? '';
    expect(content).toContain('\uD83D\uDCAC important');
  });

  it('preserves code blocks for native rendering', () => {
    const md = '```js\nconsole.log(1)\n```';
    const card = markdownToCard(md);
    const content = card.elements[0].content ?? '';
    expect(content).toContain('```js');
    expect(content).toContain('console.log(1)');
    expect(content).toContain('```');
  });
});

// ---------------------------------------------------------------------------
// injectMentionsIntoPost
// ---------------------------------------------------------------------------

describe('injectMentionsIntoPost', () => {
  it('replaces @name with at element in a simple text line', () => {
    const post: PostContent = {
      zh_cn: {

        content: [[{ tag: 'text', text: '好的，@小舟 你来处理' }]],
      },
    };
    injectMentionsIntoPost(post, [{ name: '小舟', platformId: 'ou_xiaozhou' }]);

    const line = post.zh_cn.content[0];
    expect(line).toHaveLength(3);
    expect(line[0]).toEqual({ tag: 'text', text: '好的，' });
    expect(line[1]).toEqual({ tag: 'at', user_id: 'ou_xiaozhou' });
    expect(line[2]).toEqual({ tag: 'text', text: ' 你来处理' });
  });

  it('replaces multiple different @mentions in the same line', () => {
    const post: PostContent = {
      zh_cn: {

        content: [[{ tag: 'text', text: '@alice and @bob please review' }]],
      },
    };
    injectMentionsIntoPost(post, [
      { name: 'alice', platformId: 'ou_alice' },
      { name: 'bob', platformId: 'ou_bob' },
    ]);

    const line = post.zh_cn.content[0];
    const atElements = line.filter(el => el.tag === 'at');
    expect(atElements).toHaveLength(2);
    expect(atElements[0].user_id).toBe('ou_alice');
    expect(atElements[1].user_id).toBe('ou_bob');
  });

  it('does not modify non-text elements', () => {
    const post: PostContent = {
      zh_cn: {

        content: [[
          { tag: 'a', text: '@alice link', href: 'https://example.com' },
          { tag: 'text', text: 'hello @alice' },
        ]],
      },
    };
    injectMentionsIntoPost(post, [{ name: 'alice', platformId: 'ou_alice' }]);

    const line = post.zh_cn.content[0];
    // The <a> element should be untouched
    expect(line[0]).toEqual({ tag: 'a', text: '@alice link', href: 'https://example.com' });
    // The text element should have been split
    const atElements = line.filter(el => el.tag === 'at');
    expect(atElements).toHaveLength(1);
  });

  it('handles @mention at the very start of text', () => {
    const post: PostContent = {
      zh_cn: {

        content: [[{ tag: 'text', text: '@alice 你好' }]],
      },
    };
    injectMentionsIntoPost(post, [{ name: 'alice', platformId: 'ou_alice' }]);

    const line = post.zh_cn.content[0];
    expect(line[0]).toEqual({ tag: 'at', user_id: 'ou_alice' });
    expect(line[1]).toEqual({ tag: 'text', text: ' 你好' });
  });

  it('handles @mention at the very end of text', () => {
    const post: PostContent = {
      zh_cn: {

        content: [[{ tag: 'text', text: '请 @alice' }]],
      },
    };
    injectMentionsIntoPost(post, [{ name: 'alice', platformId: 'ou_alice' }]);

    const line = post.zh_cn.content[0];
    expect(line[0]).toEqual({ tag: 'text', text: '请 ' });
    expect(line[1]).toEqual({ tag: 'at', user_id: 'ou_alice' });
  });

  it('does nothing when mentions array is empty', () => {
    const post: PostContent = {
      zh_cn: {

        content: [[{ tag: 'text', text: 'hello @alice' }]],
      },
    };
    const original = JSON.parse(JSON.stringify(post));
    injectMentionsIntoPost(post, []);
    expect(post).toEqual(original);
  });

  it('ignores @names not in the mentions list', () => {
    const post: PostContent = {
      zh_cn: {

        content: [[{ tag: 'text', text: 'hello @alice and @charlie' }]],
      },
    };
    injectMentionsIntoPost(post, [{ name: 'alice', platformId: 'ou_alice' }]);

    const line = post.zh_cn.content[0];
    const atElements = line.filter(el => el.tag === 'at');
    expect(atElements).toHaveLength(1);
    expect(atElements[0].user_id).toBe('ou_alice');
    // @charlie should remain as text
    const textParts = line.filter(el => el.tag === 'text').map(el => el.text).join('');
    expect(textParts).toContain('@charlie');
  });

  it('handles multi-line post content', () => {
    const post: PostContent = {
      zh_cn: {

        content: [
          [{ tag: 'text', text: '第一行 @alice' }],
          [{ tag: 'text', text: '第二行 @bob' }],
        ],
      },
    };
    injectMentionsIntoPost(post, [
      { name: 'alice', platformId: 'ou_alice' },
      { name: 'bob', platformId: 'ou_bob' },
    ]);

    const atLine1 = post.zh_cn.content[0].filter(el => el.tag === 'at');
    const atLine2 = post.zh_cn.content[1].filter(el => el.tag === 'at');
    expect(atLine1).toHaveLength(1);
    expect(atLine1[0].user_id).toBe('ou_alice');
    expect(atLine2).toHaveLength(1);
    expect(atLine2[0].user_id).toBe('ou_bob');
  });
});
