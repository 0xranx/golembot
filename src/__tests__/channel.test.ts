import { describe, it, expect } from 'vitest';
import { buildSessionKey, stripMention, type ChannelMessage } from '../channel.js';

describe('buildSessionKey', () => {
  it('generates key from channelType:chatId:senderId', () => {
    const msg: ChannelMessage = {
      channelType: 'feishu',
      senderId: 'ou_abc123',
      chatId: 'oc_group456',
      chatType: 'group',
      text: 'hello',
      raw: {},
    };
    expect(buildSessionKey(msg)).toBe('feishu:oc_group456:ou_abc123');
  });

  it('handles dm message', () => {
    const msg: ChannelMessage = {
      channelType: 'dingtalk',
      senderId: 'user001',
      chatId: 'conv_single',
      chatType: 'dm',
      text: 'hi',
      raw: {},
    };
    expect(buildSessionKey(msg)).toBe('dingtalk:conv_single:user001');
  });
});

describe('stripMention', () => {
  it('removes @BotName mentions', () => {
    expect(stripMention('@GolemBot help me query data')).toBe('help me query data');
  });

  it('removes <at> XML-style mentions (Feishu/DingTalk format)', () => {
    expect(stripMention('<at user_id="ou_xxx">GolemBot</at> help me query data')).toBe('help me query data');
  });

  it('removes multiple mentions', () => {
    expect(stripMention('@Bot1 @Bot2 hello world')).toBe('hello world');
  });

  it('handles text with no mentions', () => {
    expect(stripMention('hello world')).toBe('hello world');
  });

  it('handles empty string', () => {
    expect(stripMention('')).toBe('');
  });

  it('strips mentions and trims', () => {
    expect(stripMention('  @Bot  ')).toBe('');
  });
});

// ── Adapter mentioned field logic ─────────────────────────

describe('Slack adapter mentioned field', () => {
  it('sets mentioned=true for app_mention group events', () => {
    // Simulates Slack adapter app_mention handler
    const event = { text: '<@UBOT123> what is 2+2?', user: 'U001', channel: 'C001' };
    const text = event.text.replace(/<@[A-Z0-9]+>/g, '').trim();
    const msg: ChannelMessage = {
      channelType: 'slack', senderId: event.user, chatId: event.channel,
      chatType: 'group', text, mentioned: true, raw: event,
    };
    expect(msg.mentioned).toBe(true);
    expect(msg.text).toBe('what is 2+2?');
  });

  it('DM messages do not set mentioned', () => {
    const msg: ChannelMessage = {
      channelType: 'slack', senderId: 'U001', chatId: 'D001',
      chatType: 'dm', text: 'hello', raw: {},
    };
    expect(msg.mentioned).toBeUndefined();
  });
});

describe('Feishu adapter mentioned field', () => {
  it('sets mentioned=true when bot is @mentioned in group', () => {
    const botOpenId = 'ou_bot123';
    const mentions = [{ key: '@_user_1', id: { open_id: 'ou_bot123' } }];
    const isMentioned = mentions.some(m => m.id?.open_id === botOpenId);
    const text = '@_user_1 help me'.replace(mentions[0].key, '').trim();

    const msg: ChannelMessage = {
      channelType: 'feishu', senderId: 'ou_user1', chatId: 'oc_group1',
      chatType: 'group', text, mentioned: isMentioned, raw: {},
    };
    expect(msg.mentioned).toBe(true);
    expect(msg.text).toBe('help me');
  });

  it('sets mentioned=false for non-mention group messages (smart mode)', () => {
    const botOpenId = 'ou_bot123';
    const mentions: any[] = [];
    const isMentioned = mentions.some(m => m.id?.open_id === botOpenId);

    const msg: ChannelMessage = {
      channelType: 'feishu', senderId: 'ou_user1', chatId: 'oc_group1',
      chatType: 'group', text: 'general discussion', mentioned: isMentioned, raw: {},
    };
    expect(msg.mentioned).toBe(false);
  });

  it('DM messages have mentioned=undefined', () => {
    const msg: ChannelMessage = {
      channelType: 'feishu', senderId: 'ou_user1', chatId: 'oc_dm1',
      chatType: 'dm', text: 'hello', raw: {},
    };
    expect(msg.mentioned).toBeUndefined();
  });
});

describe('DingTalk adapter mentioned field', () => {
  it('sets mentioned=true for group messages (platform guarantees @mention)', () => {
    const isGroup = true;
    const msg: ChannelMessage = {
      channelType: 'dingtalk', senderId: 'user001', chatId: 'cid_group1',
      chatType: 'group', text: 'hello bot', mentioned: isGroup ? true : undefined, raw: {},
    };
    expect(msg.mentioned).toBe(true);
  });

  it('DM messages have mentioned=undefined', () => {
    const isGroup = false;
    const msg: ChannelMessage = {
      channelType: 'dingtalk', senderId: 'user001', chatId: 'cid_dm1',
      chatType: 'dm', text: 'hello', mentioned: isGroup ? true : undefined, raw: {},
    };
    expect(msg.mentioned).toBeUndefined();
  });
});

describe('Discord adapter mentioned field and mention stripping', () => {
  it('sets mentioned=true when <@botId> token is present', () => {
    const botId = '123456789';
    const content = '<@123456789> help me';
    const mentionPattern = new RegExp(`<@!?${botId}>`);
    const mentioned = mentionPattern.test(content);
    expect(mentioned).toBe(true);
  });

  it('strips <@botId> and replaces with @botName when configured', () => {
    const botId = '123456789';
    const botName = 'GolemBot';
    const content = '<@123456789> help me';
    const text = content.replace(new RegExp(`<@!?${botId}>`, 'g'), `@${botName}`).trim();
    expect(text).toBe('@GolemBot help me');
  });

  it('strips <@botId> cleanly when botName is not configured', () => {
    const botId = '123456789';
    const content = '<@123456789> help me';
    const text = content.replace(new RegExp(`<@!?${botId}>`, 'g'), '').trim();
    expect(text).toBe('help me');
  });

  it('handles <@!botId> format (nickname mention)', () => {
    const botId = '123456789';
    const content = '<@!123456789> help me';
    const text = content.replace(new RegExp(`<@!?${botId}>`, 'g'), '').trim();
    expect(text).toBe('help me');
  });
});

// ── Slack routing logic ───────────────────────────────────

describe('Slack message routing logic', () => {
  it('strips <@BOT_ID> from group mention text', () => {
    const text = '<@UBOT> tell me a joke';
    const stripped = text.replace(/<@[A-Z0-9]+>/g, '').trim();
    expect(stripped).toBe('tell me a joke');
  });

  it('strips multiple <@BOT_ID> placeholders', () => {
    const text = '<@UBOT1> and <@UBOT2> hello';
    const stripped = text.replace(/<@[A-Z0-9]+>/g, '').trim();
    expect(stripped).toBe('and  hello'.trim());
  });

  it('leaves DM text unchanged (no <@ID> present)', () => {
    const text = 'just a question';
    const stripped = text.replace(/<@[A-Z0-9]+>/g, '').trim();
    expect(stripped).toBe('just a question');
  });

  it('detects DM channel type from channel_type im', () => {
    const channelType: string = 'im';
    expect(channelType === 'im' ? 'dm' : 'group').toBe('dm');
  });

  it('detects group channel type for non-im channel_type', () => {
    const channelType: string = 'channel';
    expect(channelType === 'im' ? 'dm' : 'group').toBe('group');
  });
});

// ── Telegram routing logic ────────────────────────────────

describe('Telegram message routing logic', () => {
  it('detects @mention via entity type and offset+length', () => {
    const text = '@TestBot help me';
    const entities = [{ type: 'mention', offset: 0, length: 8 }]; // '@TestBot' = 8 chars
    const botUsername = 'TestBot';

    const isMentioned = entities.some(
      (e: any) =>
        e.type === 'mention' &&
        text.slice(e.offset, e.offset + e.length) === `@${botUsername}`,
    );
    expect(isMentioned).toBe(true);
  });

  it('does not flag non-mention entities as bot mentions', () => {
    const text = 'visit https://example.com';
    const entities = [{ type: 'url', offset: 6, length: 19 }];
    const botUsername = 'TestBot';

    const isMentioned = entities.some(
      (e: any) =>
        e.type === 'mention' &&
        text.slice(e.offset, e.offset + e.length) === `@${botUsername}`,
    );
    expect(isMentioned).toBe(false);
  });

  it('does not flag another @user mention as bot mention', () => {
    const text = '@OtherUser hello';
    const entities = [{ type: 'mention', offset: 0, length: 10 }];
    const botUsername = 'TestBot';

    const isMentioned = entities.some(
      (e: any) =>
        e.type === 'mention' &&
        text.slice(e.offset, e.offset + e.length) === `@${botUsername}`,
    );
    expect(isMentioned).toBe(false);
  });

  it('strips @botname from text after detection', () => {
    const text = '@TestBot help me';
    const botUsername = 'TestBot';
    const stripped = text.replace(new RegExp(`@${botUsername}`, 'g'), '').trim();
    expect(stripped).toBe('help me');
  });

  it('detects private chat as DM', () => {
    const chatType: string = 'private';
    expect(chatType === 'private' ? 'dm' : 'group').toBe('dm');
  });

  it('detects group and supergroup chats as group', () => {
    const group: string = 'group';
    const supergroup: string = 'supergroup';
    expect(group === 'private' ? 'dm' : 'group').toBe('group');
    expect(supergroup === 'private' ? 'dm' : 'group').toBe('group');
  });
});
