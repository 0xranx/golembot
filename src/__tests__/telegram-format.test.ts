import { describe, it, expect } from 'vitest';
import { markdownToHtml } from '../channels/telegram-format.js';

describe('markdownToHtml', () => {
  // --- Basic transformations ---

  it('converts bold **text** to <b>text</b>', () => {
    expect(markdownToHtml('hello **world**')).toBe('hello <b>world</b>');
  });

  it('converts bold __text__ to <b>text</b>', () => {
    expect(markdownToHtml('hello __world__')).toBe('hello <b>world</b>');
  });

  it('converts italic *text* to <i>text</i>', () => {
    expect(markdownToHtml('hello *world*')).toBe('hello <i>world</i>');
  });

  it('converts italic _text_ to <i>text</i>', () => {
    expect(markdownToHtml('hello _world_')).toBe('hello <i>world</i>');
  });

  it('converts strikethrough ~~text~~ to <s>text</s>', () => {
    expect(markdownToHtml('~~done~~')).toBe('<s>done</s>');
  });

  it('converts inline code to <code>text</code>', () => {
    expect(markdownToHtml('use `console.log`')).toBe('use <code>console.log</code>');
  });

  it('converts links to <a> tags', () => {
    expect(markdownToHtml('[Google](https://google.com)'))
      .toBe('<a href="https://google.com">Google</a>');
  });

  it('converts headings to <b>text</b>', () => {
    expect(markdownToHtml('# Title')).toBe('<b>Title</b>');
    expect(markdownToHtml('## Subtitle')).toBe('<b>Subtitle</b>');
  });

  // --- Code blocks ---

  it('converts code blocks to <pre><code>', () => {
    const input = '```\nconsole.log(1)\n```';
    expect(markdownToHtml(input)).toBe('<pre><code>console.log(1)</code></pre>');
  });

  it('converts code blocks with language to <pre><code class="language-xxx">', () => {
    const input = '```python\nprint("hi")\n```';
    expect(markdownToHtml(input)).toBe('<pre><code class="language-python">print(&quot;hi&quot;)</code></pre>');
  });

  it('escapes HTML inside code blocks', () => {
    const input = '```\n<div>test</div>\n```';
    expect(markdownToHtml(input)).toBe('<pre><code>&lt;div&gt;test&lt;/div&gt;</code></pre>');
  });

  it('escapes HTML inside inline code', () => {
    expect(markdownToHtml('use `<b>tag</b>`')).toBe('use <code>&lt;b&gt;tag&lt;/b&gt;</code>');
  });

  // --- HTML entity escaping ---

  it('escapes & in regular text', () => {
    expect(markdownToHtml('A & B')).toBe('A &amp; B');
  });

  it('escapes < in regular text', () => {
    expect(markdownToHtml('a < b')).toBe('a &lt; b');
  });

  it('escapes > in regular text (not at line start)', () => {
    expect(markdownToHtml('a > b')).toBe('a &gt; b');
  });

  it('does not double-escape generated HTML tags', () => {
    const result = markdownToHtml('**bold**');
    expect(result).toBe('<b>bold</b>');
    expect(result).not.toContain('&lt;b&gt;');
  });

  // --- Code block protection ---

  it('does not convert markdown inside fenced code blocks', () => {
    const input = '```\n**bold** *italic*\n```';
    const result = markdownToHtml(input);
    expect(result).toContain('**bold** *italic*');
    expect(result).not.toContain('<b>');
    expect(result).not.toContain('<i>');
  });

  it('does not convert markdown inside inline code', () => {
    const result = markdownToHtml('`**not bold**`');
    expect(result).toBe('<code>**not bold**</code>');
  });

  it('handles unclosed code blocks', () => {
    const input = '```\nsome code\nmore code';
    const result = markdownToHtml(input);
    expect(result).toContain('some code');
  });

  // --- Blockquote ---

  it('converts > text to <blockquote>', () => {
    expect(markdownToHtml('> This is a quote')).toBe('<blockquote>This is a quote</blockquote>');
  });

  it('merges consecutive blockquote lines', () => {
    const input = '> line one\n> line two';
    expect(markdownToHtml(input)).toBe('<blockquote>line one\nline two</blockquote>');
  });

  it('handles blockquote with surrounding text', () => {
    const input = 'before\n> quoted\nafter';
    const result = markdownToHtml(input);
    expect(result).toContain('before');
    expect(result).toContain('<blockquote>quoted</blockquote>');
    expect(result).toContain('after');
  });

  // --- Edge cases ---

  it('handles empty string', () => {
    expect(markdownToHtml('')).toBe('');
  });

  it('handles plain text without markdown', () => {
    expect(markdownToHtml('hello world')).toBe('hello world');
  });

  it('handles mixed formatting in one line', () => {
    const result = markdownToHtml('**bold** and *italic* and ~~strike~~');
    expect(result).toBe('<b>bold</b> and <i>italic</i> and <s>strike</s>');
  });

  it('handles multiline with mixed elements', () => {
    const input = '# Title\n\n**bold** text\n\n- item one\n- item two';
    const result = markdownToHtml(input);
    expect(result).toContain('<b>Title</b>');
    expect(result).toContain('<b>bold</b> text');
    expect(result).toContain('• item one');
  });

  it('converts unordered list - item to • item', () => {
    expect(markdownToHtml('- one\n- two')).toBe('• one\n• two');
  });

  it('handles multiple links in one line', () => {
    const input = '[A](https://a.com) and [B](https://b.com)';
    const result = markdownToHtml(input);
    expect(result).toContain('<a href="https://a.com">A</a>');
    expect(result).toContain('<a href="https://b.com">B</a>');
  });

  it('preserves text between code blocks', () => {
    const input = '```\ncode1\n```\n**bold text**\n```\ncode2\n```';
    const result = markdownToHtml(input);
    expect(result).toContain('<b>bold text</b>');
    expect(result).toContain('code1');
    expect(result).toContain('code2');
  });

  it('handles multiline code blocks', () => {
    const input = '```js\nconst a = 1;\nconst b = 2;\nconsole.log(a + b);\n```';
    const result = markdownToHtml(input);
    expect(result).toContain('class="language-js"');
    expect(result).toContain('const a = 1;\nconst b = 2;\nconsole.log(a + b);');
  });
});
