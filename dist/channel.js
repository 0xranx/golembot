export function buildSessionKey(msg) {
    if (msg.channelType === 'slack' && msg.chatType === 'dm' && msg.threadId) {
        return `slack:${msg.chatId}:${msg.senderId}:thread:${msg.threadId}`;
    }
    return `${msg.channelType}:${msg.chatId}:${msg.senderId}`;
}
export function buildConversationKey(msg) {
    if (msg.channelType === 'slack' && msg.chatType === 'group' && msg.threadId) {
        return `slack:${msg.chatId}:thread:${msg.threadId}`;
    }
    return `${msg.channelType}:${msg.chatId}`;
}
/**
 * Strip @mention tags from the text, returning only the user's actual message.
 * Handles common IM @mention formats: `@BotName`, `<at user_id="xxx">BotName</at>` etc.
 */
export function stripMention(text) {
    return text
        .replace(/<at[^>]*>.*?<\/at>/gi, '')
        .replace(/@\S+/g, '')
        .trim();
}
/**
 * Detect whether `text` contains an @mention of `botName`.
 * Handles `@BotName` and XML-style `<at ...>BotName</at>`.
 */
export function detectMention(text, botName) {
    const escaped = botName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`@${escaped}(?!\\w)|<at[^>]*>${escaped}<\\/at>`, 'i').test(text);
}
//# sourceMappingURL=channel.js.map