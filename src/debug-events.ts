import type { StreamEvent } from './engine.js';

export function isDebugEventsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.GOLEMBOT_DEBUG_EVENTS?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

export function debugEventLog(enabled: boolean, ...args: unknown[]): void {
  if (enabled) console.log(...args);
}

export function summarizeStreamEvent(event: StreamEvent): string {
  switch (event.type) {
    case 'text':
      return `event=text chars=${event.content.length}`;
    case 'tool_call':
      return `event=tool_call name=${event.name}`;
    case 'tool_result':
      return `event=tool_result chars=${event.content.length}`;
    case 'warning':
      return `event=warning chars=${event.message.length}`;
    case 'error':
      return `event=error chars=${event.message.length}`;
    case 'done':
      return `event=done fullTextChars=${event.fullText?.length ?? 0} durationMs=${event.durationMs ?? 'n/a'} costUsd=${event.costUsd ?? 'n/a'}`;
  }
}

export function summarizeJsonEventLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return null;

  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return null;
  }

  const type = typeof obj.type === 'string' ? obj.type : 'unknown';
  if (type === 'assistant') {
    const msg = obj.message as Record<string, unknown> | undefined;
    const content = (msg?.content as Array<Record<string, unknown>> | undefined) ?? [];
    const blocks = Array.isArray(content)
      ? content.map((block) => (typeof block.type === 'string' ? block.type : 'unknown')).join(',')
      : '';
    const textChars = Array.isArray(content)
      ? content
          .filter((block) => block.type === 'text')
          .map((block) => (typeof block.text === 'string' ? block.text.length : 0))
          .reduce((sum, len) => sum + len, 0)
      : 0;
    return `raw type=assistant blocks=[${blocks}] textChars=${textChars}`;
  }

  if (type === 'result') {
    const result = typeof obj.result === 'string' ? obj.result : '';
    const isError = Boolean(obj.is_error);
    return `raw type=result isError=${isError} fullTextChars=${result.length}`;
  }

  if (type === 'tool_call') {
    const subtype = typeof obj.subtype === 'string' ? obj.subtype : 'unknown';
    return `raw type=tool_call subtype=${subtype}`;
  }

  if (type === 'user') {
    const msg = obj.message as Record<string, unknown> | undefined;
    const content = (msg?.content as Array<Record<string, unknown>> | undefined) ?? [];
    const blocks = Array.isArray(content)
      ? content.map((block) => (typeof block.type === 'string' ? block.type : 'unknown')).join(',')
      : '';
    return `raw type=user blocks=[${blocks}]`;
  }

  return `raw type=${type}`;
}
