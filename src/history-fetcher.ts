import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ChannelAdapter, ChannelMessage } from './channel.js';
import { type InboxChannelMsg, type InboxStore } from './inbox.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HistoryFetchConfig {
  enabled?: boolean;
  /** Minutes between periodic polls. Default: 15. */
  pollIntervalMinutes?: number;
  /** Minutes to look back on first startup (no watermark). Default: 60. */
  initialLookbackMinutes?: number;
}

// ---------------------------------------------------------------------------
// Watermarks — tracks per-chat high-water mark to avoid re-fetching
// ---------------------------------------------------------------------------

const GOLEM_DIR = '.golem';
const WATERMARKS_FILE = 'watermarks.json';

function watermarksPath(dir: string): string {
  return join(dir, GOLEM_DIR, WATERMARKS_FILE);
}

export class WatermarkStore {
  private dir: string;
  private marks: Record<string, string> = {};

  constructor(dir: string) {
    this.dir = dir;
  }

  async load(): Promise<void> {
    try {
      const raw = await readFile(watermarksPath(this.dir), 'utf-8');
      this.marks = JSON.parse(raw);
    } catch {
      this.marks = {};
    }
  }

  get(key: string): Date | undefined {
    const ts = this.marks[key];
    return ts ? new Date(ts) : undefined;
  }

  set(key: string, ts: Date): void {
    this.marks[key] = ts.toISOString();
  }

  async save(): Promise<void> {
    await mkdir(join(this.dir, GOLEM_DIR), { recursive: true });
    const target = watermarksPath(this.dir);
    const tmp = `${target}.tmp`;
    await writeFile(tmp, `${JSON.stringify(this.marks, null, 2)}\n`, 'utf-8');
    await rename(tmp, target);
  }
}

// ---------------------------------------------------------------------------
// Triage prompt builder
// ---------------------------------------------------------------------------

export interface TriageMessage {
  ts: string;
  senderName: string;
  text: string;
}

/**
 * Build a triage prompt for the agent to review missed messages.
 * The agent decides which messages to reply to, skip, or batch-reply.
 */
export function buildTriagePrompt(messages: TriageMessage[], chatId: string): string {
  const lines: string[] = [
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

// ---------------------------------------------------------------------------
// History Fetcher
// ---------------------------------------------------------------------------

export interface HistoryFetcherOpts {
  dir: string;
  adapters: Map<string, ChannelAdapter>;
  inbox: InboxStore;
  config: HistoryFetchConfig;
  verbose: boolean;
}

function log(verbose: boolean, ...args: unknown[]): void {
  if (verbose) console.log(...args);
}

/**
 * Fetch missed messages from all adapters that support `fetchHistory` + `listChats`.
 * Groups messages by chat and enqueues triage prompts into the inbox.
 */
export async function fetchMissedMessages(opts: HistoryFetcherOpts, watermarks: WatermarkStore): Promise<number> {
  const { adapters, inbox, config, verbose } = opts;
  const lookbackMs = (config.initialLookbackMinutes ?? 60) * 60 * 1000;
  let totalEnqueued = 0;

  for (const [type, adapter] of adapters) {
    if (!adapter.fetchHistory || !adapter.listChats) continue;

    let chats: Array<{ chatId: string; chatType: 'dm' | 'group' }>;
    try {
      chats = await adapter.listChats();
    } catch (e) {
      console.error(`[history-fetch] Failed to list chats for ${type}:`, (e as Error).message);
      continue;
    }

    log(verbose, `[history-fetch] ${type}: found ${chats.length} chat(s)`);

    for (const chat of chats) {
      const wmKey = `${type}:${chat.chatId}`;
      const since = watermarks.get(wmKey) ?? new Date(Date.now() - lookbackMs);

      let messages: ChannelMessage[];
      try {
        messages = await adapter.fetchHistory(chat.chatId, since, 50);
      } catch (e) {
        console.error(`[history-fetch] Failed to fetch history for ${wmKey}:`, (e as Error).message);
        continue;
      }

      // Filter out messages already in inbox (dedup)
      const newMessages = messages.filter((m) => {
        if (!m.messageId) return true;
        return !inbox.has(type, m.messageId);
      });

      if (newMessages.length === 0) {
        log(verbose, `[history-fetch] ${wmKey}: no new messages`);
        continue;
      }

      log(verbose, `[history-fetch] ${wmKey}: ${newMessages.length} new message(s)`);

      // Build triage prompt with all new messages
      const triageMessages: TriageMessage[] = newMessages.map((m) => ({
        ts: (m.raw as any)?._fetchedAt || new Date().toISOString(),
        senderName: m.senderName || m.senderId,
        text: m.text,
      }));

      const sessionKey = `${type}:${chat.chatId}`;
      const triagePrompt = buildTriagePrompt(triageMessages, sessionKey);

      // Use the last message's info for reply routing
      const lastMsg = newMessages[newMessages.length - 1];
      const channelMsg: InboxChannelMsg = {
        channelType: type,
        senderId: lastMsg.senderId,
        senderName: lastMsg.senderName,
        chatId: chat.chatId,
        chatType: chat.chatType,
        messageId: lastMsg.messageId,
      };

      await inbox.enqueue({
        sessionKey,
        message: triagePrompt,
        source: 'history-fetch',
        channelMsg,
      });

      totalEnqueued++;

      // Update watermark to 1ms after the latest message's time,
      // so the next fetch excludes this message (APIs typically use >= for start_time).
      const rawData = lastMsg.raw as any;
      const latestMs = rawData?._fetchedAt ? new Date(rawData._fetchedAt).getTime() : Date.now();
      watermarks.set(wmKey, new Date(latestMs + 1));
    }
  }

  await watermarks.save();
  return totalEnqueued;
}

/**
 * Start periodic polling for missed messages.
 * Returns a stop function.
 */
export function startHistoryFetcher(opts: HistoryFetcherOpts): {
  watermarks: WatermarkStore;
  /** Run an immediate fetch (used on startup). */
  fetchNow: () => Promise<number>;
  /** Start periodic polling. Returns stop function. */
  startPolling: () => { stop: () => void };
} {
  const watermarks = new WatermarkStore(opts.dir);
  const intervalMs = (opts.config.pollIntervalMinutes ?? 15) * 60 * 1000;

  const fetchNow = async (): Promise<number> => {
    await watermarks.load();
    return fetchMissedMessages(opts, watermarks);
  };

  const startPolling = () => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      if (stopped) return;
      try {
        const count = await fetchNow();
        if (count > 0) {
          log(opts.verbose, `[history-fetch] Periodic poll: ${count} chat(s) with new messages`);
        }
      } catch (e) {
        console.error('[history-fetch] Poll error:', (e as Error).message);
      }
      if (!stopped) {
        timer = setTimeout(poll, intervalMs);
        if (timer.unref) timer.unref();
      }
    };

    timer = setTimeout(poll, intervalMs);
    if (timer.unref) timer.unref();

    return {
      stop: () => {
        stopped = true;
        if (timer) clearTimeout(timer);
      },
    };
  };

  return { watermarks, fetchNow, startPolling };
}
