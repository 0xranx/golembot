/**
 * CLI formatting helpers — tool call display and string truncation.
 */

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '\u2026';
}

export function formatToolCall(name: string, argsJson: string): string {
  let detail = '';
  try {
    const args = JSON.parse(argsJson);
    if (typeof args === 'object' && args !== null) {
      // Pick the most informative argument to display
      const path = args.file_path ?? args.path ?? args.filename;
      const command = args.command;
      const query = args.query ?? args.pattern ?? args.search;
      if (path) {
        detail = ` ${truncate(String(path), 60)}`;
      } else if (command) {
        detail = ` ${truncate(String(command), 60)}`;
      } else if (query) {
        detail = ` ${truncate(String(query), 60)}`;
      }
    }
  } catch {
    // not valid JSON — show nothing extra
  }
  return `${name}${detail}`;
}
