import { describe, it, expect } from 'vitest';
import { formatToolCall, truncate } from '../cli-utils.js';

describe('truncate', () => {
  it('returns short strings unchanged', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('truncates long strings with ellipsis', () => {
    const long = 'a'.repeat(100);
    const result = truncate(long, 20);
    expect(result.length).toBe(20);
    expect(result.endsWith('\u2026')).toBe(true);
  });

  it('handles exact length', () => {
    expect(truncate('12345', 5)).toBe('12345');
  });
});

describe('formatToolCall', () => {
  it('shows name only when args is empty object', () => {
    expect(formatToolCall('Read', '{}')).toBe('Read');
  });

  it('shows file_path when present', () => {
    const result = formatToolCall('Read', '{"file_path":"/src/index.ts"}');
    expect(result).toBe('Read /src/index.ts');
  });

  it('shows command when present', () => {
    const result = formatToolCall('Bash', '{"command":"npm test"}');
    expect(result).toBe('Bash npm test');
  });

  it('shows query when present', () => {
    const result = formatToolCall('Grep', '{"pattern":"TODO"}');
    expect(result).toBe('Grep TODO');
  });

  it('truncates long paths', () => {
    const longPath = '/very/long/' + 'x'.repeat(100) + '/file.ts';
    const result = formatToolCall('Read', JSON.stringify({ file_path: longPath }));
    expect(result.length).toBeLessThan(70);
  });

  it('handles invalid JSON gracefully', () => {
    expect(formatToolCall('Read', 'not json')).toBe('Read');
  });

  it('prefers file_path over command', () => {
    const result = formatToolCall('Tool', '{"file_path":"/a.ts","command":"ls"}');
    expect(result).toBe('Tool /a.ts');
  });
});
