import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChannelMessage } from '../channel.js';
import { TelegramAdapter } from '../channels/telegram.js';

function makeMsg(overrides: Partial<ChannelMessage> = {}): ChannelMessage {
  return {
    channelType: 'telegram',
    senderId: '100',
    senderName: 'alice',
    chatId: '42',
    chatType: 'dm',
    text: 'hello',
    messageId: '7',
    raw: {},
    ...overrides,
  };
}

function makeAdapter(api: Record<string, unknown>): TelegramAdapter {
  const adapter = new TelegramAdapter({ botToken: 'test-token' });
  (adapter as any).bot = { api };
  return adapter;
}

describe('TelegramAdapter outbound reliability', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('sends HTML replies with quote reply metadata', async () => {
    const api = {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 101 }),
    };
    const adapter = makeAdapter(api);

    await adapter.reply(makeMsg(), '**hello**');

    expect(api.sendMessage).toHaveBeenCalledWith(42, '<b>hello</b>', {
      parse_mode: 'HTML',
      reply_to_message_id: 7,
    });
  });

  it('falls back to plain text when Telegram rejects HTML entities', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const api = {
      sendMessage: vi
        .fn()
        .mockRejectedValueOnce({
          error_code: 400,
          description: "Bad Request: can't parse entities: unsupported start tag",
        })
        .mockResolvedValueOnce({ message_id: 102 }),
    };
    const adapter = makeAdapter(api);

    await adapter.reply(makeMsg(), '**hello**');

    expect(api.sendMessage).toHaveBeenNthCalledWith(1, 42, '<b>hello</b>', {
      parse_mode: 'HTML',
      reply_to_message_id: 7,
    });
    expect(api.sendMessage).toHaveBeenNthCalledWith(2, 42, '**hello**', {
      reply_to_message_id: 7,
    });
    expect(warnSpy.mock.calls.join(' ')).toContain('fallback=plain');
    expect(warnSpy.mock.calls.join(' ')).not.toContain('test-token');
  });

  it('falls back to a normal chat message when reply target is stale', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const api = {
      sendMessage: vi
        .fn()
        .mockRejectedValueOnce({
          error_code: 400,
          description: 'Bad Request: replied message not found',
        })
        .mockResolvedValueOnce({ message_id: 103 }),
    };
    const adapter = makeAdapter(api);

    await adapter.reply(makeMsg(), 'hello');

    expect(api.sendMessage).toHaveBeenNthCalledWith(1, 42, 'hello', {
      parse_mode: 'HTML',
      reply_to_message_id: 7,
    });
    expect(api.sendMessage).toHaveBeenNthCalledWith(2, 42, 'hello', {
      parse_mode: 'HTML',
    });
    expect(warnSpy.mock.calls.join(' ')).toContain('fallback=no-reply');
  });

  it('retries once after Telegram rate limits the send', async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const api = {
      sendMessage: vi
        .fn()
        .mockRejectedValueOnce({
          error_code: 429,
          description: 'Too Many Requests: retry after 1',
          parameters: { retry_after: 1 },
        })
        .mockResolvedValueOnce({ message_id: 104 }),
    };
    const adapter = makeAdapter(api);

    const promise = adapter.send('42', 'hello');
    await vi.advanceTimersByTimeAsync(1000);
    await promise;

    expect(api.sendMessage).toHaveBeenCalledTimes(2);
    expect(warnSpy.mock.calls.join(' ')).toContain('retry=rate-limit');
  });

  it('logs sanitized metadata when all send attempts fail', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = {
      error_code: 400,
      description: 'Bad Request: forbidden',
    };
    const api = {
      sendMessage: vi.fn().mockRejectedValue(error),
    };
    const adapter = makeAdapter(api);

    await expect(adapter.send('42', 'secret prompt body')).rejects.toBe(error);

    const log = warnSpy.mock.calls.join(' ');
    expect(log).toContain('failed');
    expect(log).toContain('chat=42');
    expect(log).not.toContain('secret prompt body');
    expect(log).not.toContain('test-token');
  });

  it('creates and clears temporary status messages without HTML parsing', async () => {
    const api = {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 105 }),
      deleteMessage: vi.fn().mockResolvedValue(true),
    };
    const adapter = makeAdapter(api);

    const statusId = await adapter.sendStatus(makeMsg(), '⏳ thinking...');
    await adapter.clearStatus(makeMsg(), statusId);

    expect(statusId).toBe('105');
    expect(api.sendMessage).toHaveBeenCalledWith(42, '⏳ thinking...', {
      reply_to_message_id: 7,
    });
    expect(api.deleteMessage).toHaveBeenCalledWith(42, 105);
  });

  it('ignores inbound telegram messages from users outside the allowlist', async () => {
    const onMessage = vi.fn();
    let handler: ((ctx: any) => Promise<void>) | undefined;
    const grammyBot = {
      api: {
        getMe: vi.fn().mockResolvedValue({ username: 'testbot' }),
      },
      on: vi.fn((event: string, cb: (ctx: any) => Promise<void>) => {
        if (event === 'message') handler = cb;
      }),
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    };

    vi.doMock('grammy', () => ({
      Bot: vi.fn(() => grammyBot),
    }));

    const adapter = new TelegramAdapter({
      botToken: 'test-token',
      allowedUserIds: ['123456'],
    });
    await adapter.start(onMessage);

    expect(handler).toBeDefined();
    await handler?.({
      message: {
        from: { id: 999999, first_name: 'Mallory' },
        chat: { id: 42, type: 'private' },
        text: 'hello',
        message_id: 7,
      },
    });

    expect(onMessage).not.toHaveBeenCalled();
  });
});
