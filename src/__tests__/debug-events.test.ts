import { describe, expect, it } from 'vitest';
import { isDebugEventsEnabled, summarizeJsonEventLine, summarizeStreamEvent } from '../debug-events.js';
import type { StreamEvent } from '../engine.js';

describe('debug-events', () => {
  it('detects enabled debug flag values', () => {
    expect(isDebugEventsEnabled({ GOLEMBOT_DEBUG_EVENTS: '1' } as NodeJS.ProcessEnv)).toBe(true);
    expect(isDebugEventsEnabled({ GOLEMBOT_DEBUG_EVENTS: 'true' } as NodeJS.ProcessEnv)).toBe(true);
    expect(isDebugEventsEnabled({ GOLEMBOT_DEBUG_EVENTS: 'on' } as NodeJS.ProcessEnv)).toBe(true);
    expect(isDebugEventsEnabled({ GOLEMBOT_DEBUG_EVENTS: '0' } as NodeJS.ProcessEnv)).toBe(false);
  });

  it('summarizes stream events without content leakage', () => {
    const events: StreamEvent[] = [
      { type: 'text', content: 'hello world' },
      { type: 'tool_call', name: 'Read', args: '{"path":"x"}' },
      { type: 'tool_result', content: 'done' },
      { type: 'warning', message: 'warn' },
      { type: 'error', message: 'boom' },
      { type: 'done', fullText: 'final reply', durationMs: 123, costUsd: 0.01 },
    ];

    expect(summarizeStreamEvent(events[0])).toBe('event=text chars=11');
    expect(summarizeStreamEvent(events[1])).toBe('event=tool_call name=Read');
    expect(summarizeStreamEvent(events[2])).toBe('event=tool_result chars=4');
    expect(summarizeStreamEvent(events[3])).toBe('event=warning chars=4');
    expect(summarizeStreamEvent(events[4])).toBe('event=error chars=4');
    expect(summarizeStreamEvent(events[5])).toBe('event=done fullTextChars=11 durationMs=123 costUsd=0.01');
  });

  it('summarizes raw assistant/result json lines', () => {
    const assistantLine = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'thinking', thinking: 'secret' },
          { type: 'text', text: 'hello' },
        ],
      },
    });
    const resultLine = JSON.stringify({ type: 'result', is_error: false, result: 'final text' });

    expect(summarizeJsonEventLine(assistantLine)).toBe('raw type=assistant blocks=[thinking,text] textChars=5');
    expect(summarizeJsonEventLine(resultLine)).toBe('raw type=result isError=false fullTextChars=10');
  });
});
