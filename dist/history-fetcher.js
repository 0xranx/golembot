import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildConversationKey, buildSessionKey } from './channel.js';
// ---------------------------------------------------------------------------
// Watermarks — tracks per-chat high-water mark to avoid re-fetching
// ---------------------------------------------------------------------------
const GOLEM_DIR = '.golem';
const WATERMARKS_FILE = 'watermarks.json';
function watermarksPath(dir) {
    return join(dir, GOLEM_DIR, WATERMARKS_FILE);
}
export class WatermarkStore {
    dir;
    marks = {};
    constructor(dir) {
        this.dir = dir;
    }
    async load() {
        try {
            const raw = await readFile(watermarksPath(this.dir), 'utf-8');
            this.marks = JSON.parse(raw);
        }
        catch {
            this.marks = {};
        }
    }
    get(key) {
        const ts = this.marks[key];
        return ts ? new Date(ts) : undefined;
    }
    set(key, ts) {
        this.marks[key] = ts.toISOString();
    }
    async save() {
        await mkdir(join(this.dir, GOLEM_DIR), { recursive: true });
        const target = watermarksPath(this.dir);
        const tmp = `${target}.tmp`;
        await writeFile(tmp, `${JSON.stringify(this.marks, null, 2)}\n`, 'utf-8');
        await rename(tmp, target);
    }
}
/**
 * Build a triage prompt for the agent to review missed messages.
 * The agent decides which messages to reply to, skip, or batch-reply.
 */
export function buildTriagePrompt(messages, chatId) {
    const lines = [
        `[System: You have been offline. Below are messages from chat "${chatId}" that arrived while you were away.`,
        'Review each message and decide how to respond:',
        '- Reply to messages that need a response',
        '- Skip or briefly acknowledge messages that were already resolved',
        '- Batch-reply when multiple messages are related',
        '- If none of the messages need a reply, respond with exactly: [SKIP]',
        'Address each person by name.]',
        '',
    ];
    for (const m of messages) {
        lines.push(`[${m.ts}] ${m.senderName}: ${m.text}`);
    }
    return lines.join('\n');
}
function log(verbose, ...args) {
    if (verbose)
        console.log(...args);
}
/**
 * Fetch missed messages from all adapters that support `fetchHistory` + `listChats`.
 * Groups messages by chat and enqueues triage prompts into the inbox.
 */
export async function fetchMissedMessages(opts, watermarks) {
    const { adapters, inbox, seenMessages, config, verbose } = opts;
    const lookbackMs = (config.initialLookbackMinutes ?? 60) * 60 * 1000;
    let totalEnqueued = 0;
    for (const [type, adapter] of adapters) {
        if (!adapter.fetchHistory || !adapter.listChats)
            continue;
        let chats;
        try {
            chats = await adapter.listChats();
        }
        catch (e) {
            console.error(`[history-fetch] Failed to list chats for ${type}:`, e.message);
            continue;
        }
        log(verbose, `[history-fetch] ${type}: found ${chats.length} chat(s)`);
        for (const chat of chats) {
            const wmKey = `${type}:${chat.chatId}`;
            const since = watermarks.get(wmKey) ?? new Date(Date.now() - lookbackMs);
            let messages;
            try {
                messages = await adapter.fetchHistory(chat.chatId, since, 50);
            }
            catch (e) {
                console.error(`[history-fetch] Failed to fetch history for ${wmKey}:`, e.message);
                continue;
            }
            // Filter out bot messages, messages @other-bots (not this one),
            // and messages already processed (check persistent store + inbox + content fingerprint)
            const newMessages = messages.filter((m) => {
                if (m.senderType === 'bot')
                    return false;
                // mentioned===false means the message explicitly @'s a different bot — skip it.
                // mentioned===true means @this-bot; undefined means no @mention or unknown.
                if (m.mentioned === false)
                    return false;
                if (!m.messageId)
                    return true;
                if (seenMessages?.has(type, m.messageId)) {
                    log(verbose, `[history-fetch] ${wmKey}: skip ${m.messageId} (seen-store)`);
                    return false;
                }
                if (inbox.has(type, m.messageId)) {
                    log(verbose, `[history-fetch] ${wmKey}: skip ${m.messageId} (inbox)`);
                    return false;
                }
                // Content-based dedup: catches same message with different messageId
                if (m.senderId && m.text && seenMessages?.hasContent(type, m.senderId, m.text)) {
                    log(verbose, `[history-fetch] ${wmKey}: skip ${m.messageId} (content-dedup)`);
                    return false;
                }
                return true;
            });
            // Always advance watermark using ALL fetched messages (including bot messages),
            // so filtered-out messages are never re-fetched on restart.
            // NOTE: Feishu start_time is in seconds, so we must advance to the next
            // full second to avoid re-fetching the last message every poll cycle.
            if (messages.length > 0) {
                const allLatest = messages[messages.length - 1];
                const allRaw = allLatest.raw;
                const allLatestMs = allRaw?._fetchedAt ? new Date(allRaw._fetchedAt).getTime() : Date.now();
                const nextSecondMs = (Math.floor(allLatestMs / 1000) + 1) * 1000;
                watermarks.set(wmKey, new Date(nextSecondMs));
            }
            if (newMessages.length === 0) {
                log(verbose, `[history-fetch] ${wmKey}: no new messages (${messages.length} filtered)`);
                continue;
            }
            log(verbose, `[history-fetch] ${wmKey}: ${newMessages.length} new message(s)`);
            const conversationMsg = newMessages[newMessages.length - 1];
            const sessionKey = conversationMsg.chatType === 'group' ? buildConversationKey(conversationMsg) : buildSessionKey(conversationMsg);
            // Session-level suppression: if WebSocket delivered any real-time message
            // for this session within the current poll cycle, skip the triage entirely.
            // The real-time path is working — missed messages are part of the same
            // conversation that was already addressed.  Only create triage when the
            // session had NO real-time activity (bot was truly offline).
            // Use poll interval + 5 min buffer to account for long Agent processing times.
            const pollMs = ((config.pollIntervalMinutes ?? 15) + 5) * 60 * 1000;
            const lastRt = inbox.getLastRealtimeTs ? inbox.getLastRealtimeTs(sessionKey) : 0;
            const hasRt = inbox.hasRecentActivity(sessionKey, pollMs);
            console.log(`[history-fetch] ${wmKey}: RT check — hasRecentActivity=${hasRt}, lastRtTs=${lastRt ? new Date(lastRt).toISOString() : 'none'}, pollMs=${pollMs}, now=${new Date().toISOString()}`);
            if (hasRt) {
                console.log(`[history-fetch] ${wmKey}: SUPPRESSED — ${newMessages.length} msg(s) marked seen only`);
                // Mark all messages as seen so they won't be re-triaged next cycle
                for (const m of newMessages) {
                    if (m.messageId) {
                        inbox.markSeen(type, m.messageId);
                        seenMessages?.mark(type, m.messageId);
                    }
                    if (m.senderId && m.text)
                        seenMessages?.markContent(type, m.senderId, m.text);
                }
                continue;
            }
            // No RT activity — bot was offline for this session.  Build triage.
            console.log(`[history-fetch] ${wmKey}: TRIAGE — creating for ${newMessages.length} msg(s)`);
            // Mark all messages as seen first (messageId + content fingerprint).
            for (const m of newMessages) {
                if (m.messageId) {
                    inbox.markSeen(type, m.messageId);
                    seenMessages?.mark(type, m.messageId);
                }
                if (m.senderId && m.text)
                    seenMessages?.markContent(type, m.senderId, m.text);
            }
            const triageMessages = newMessages.map((m) => ({
                ts: m.raw?._fetchedAt || new Date().toISOString(),
                senderName: m.senderName || m.senderId,
                text: m.text,
            }));
            const triagePrompt = buildTriagePrompt(triageMessages, sessionKey);
            // Use the last message's info for reply routing.
            // mentioned is true if ANY message in the batch was @this-bot.
            const lastMsg = conversationMsg;
            const anyMentioned = newMessages.some((m) => m.mentioned === true);
            const channelMsg = {
                channelType: type,
                senderId: lastMsg.senderId,
                senderName: lastMsg.senderName,
                chatId: chat.chatId,
                chatType: chat.chatType,
                messageId: lastMsg.messageId,
                threadId: lastMsg.threadId,
                mentioned: anyMentioned || undefined,
            };
            await inbox.enqueue({
                sessionKey,
                message: triagePrompt,
                source: 'history-fetch',
                channelMsg,
            });
            totalEnqueued++;
        }
    }
    await watermarks.save();
    // Flush seenMessages immediately — do not rely on the 5s debounce timer,
    // because a restart before the timer fires would lose the marks and cause
    // the next poll to re-triage already-processed messages.
    await seenMessages?.save();
    return totalEnqueued;
}
/**
 * Start periodic polling for missed messages.
 * Returns a stop function.
 */
export function startHistoryFetcher(opts) {
    const watermarks = new WatermarkStore(opts.dir);
    const intervalMs = (opts.config.pollIntervalMinutes ?? 15) * 60 * 1000;
    const fetchNow = async () => {
        await watermarks.load();
        return fetchMissedMessages(opts, watermarks);
    };
    const startPolling = () => {
        let stopped = false;
        let timer;
        const poll = async () => {
            if (stopped)
                return;
            try {
                const count = await fetchNow();
                if (count > 0) {
                    log(opts.verbose, `[history-fetch] Periodic poll: ${count} chat(s) with new messages`);
                }
            }
            catch (e) {
                console.error('[history-fetch] Poll error:', e.message);
            }
            if (!stopped) {
                timer = setTimeout(poll, intervalMs);
                if (timer.unref)
                    timer.unref();
            }
        };
        timer = setTimeout(poll, intervalMs);
        if (timer.unref)
            timer.unref();
        return {
            stop: () => {
                stopped = true;
                if (timer)
                    clearTimeout(timer);
            },
        };
    };
    return { watermarks, fetchNow, startPolling };
}
//# sourceMappingURL=history-fetcher.js.map