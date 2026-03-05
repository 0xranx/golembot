export interface ChannelMessage {
  channelType: string;
  senderId: string;
  senderName?: string;
  chatId: string;
  chatType: 'dm' | 'group';
  text: string;
  raw: unknown;
  /**
   * Set to `true` by adapters that can reliably detect a bot @mention through
   * platform-native means (e.g. Discord's `<@userId>` token). When set, the
   * gateway treats the message as an @mention regardless of text pattern matching.
   */
  mentioned?: boolean;
}

export interface MentionTarget {
  name: string;
  platformId: string;
}

export interface ReplyOptions {
  mentions?: MentionTarget[];
}

export interface ChannelAdapter {
  readonly name: string;
  /** Optional: override the default 4000-char message split limit for this channel. */
  readonly maxMessageLength?: number;
  start(onMessage: (msg: ChannelMessage) => void | Promise<void>): Promise<void>;
  reply(msg: ChannelMessage, text: string, options?: ReplyOptions): Promise<void>;
  stop(): Promise<void>;
  /**
   * Optional: send a "typing…" indicator to the chat.
   * Called before a long-running AI invocation so the user sees immediate feedback.
   * Implementations should be idempotent and best-effort (errors are ignored).
   */
  typing?(msg: ChannelMessage): Promise<void>;
  /**
   * Optional: resolve group members for @mention support.
   * Returns a map of display name → platform-specific user ID.
   * Called by the gateway when the AI reply contains @mentions.
   */
  getGroupMembers?(chatId: string): Promise<Map<string, string>>;
}

export function buildSessionKey(msg: ChannelMessage): string {
  return `${msg.channelType}:${msg.chatId}:${msg.senderId}`;
}

/**
 * Strip @mention tags from the text, returning only the user's actual message.
 * Handles common IM @mention formats: `@BotName`, `<at user_id="xxx">BotName</at>` etc.
 */
export function stripMention(text: string): string {
  return text
    .replace(/<at[^>]*>.*?<\/at>/gi, '')
    .replace(/@\S+/g, '')
    .trim();
}

/**
 * Detect whether `text` contains an @mention of `botName`.
 * Handles `@BotName` and XML-style `<at ...>BotName</at>`.
 */
export function detectMention(text: string, botName: string): boolean {
  const escaped = botName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`@${escaped}(?!\\w)|<at[^>]*>${escaped}<\\/at>`, 'i').test(text);
}
