import { mkdir, readFile as readFileAsync } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildConversationKey,
  buildSessionKey,
  type ChannelAdapter,
  type ChannelMessage,
  detectMention,
  type MentionTarget,
  type ReadReceipt,
  stripMention,
} from './channel.js';
import {
  type ChannelStatus,
  createMetrics,
  type DashboardContext,
  type GatewayMetrics,
  KNOWN_CHANNELS,
  recordMessage,
} from './dashboard.js';
import { debugEventLog, isDebugEventsEnabled, summarizeStreamEvent } from './debug-events.js';
import { listInstances, registerInstance, unregisterInstance } from './fleet.js';
import { startHistoryFetcher } from './history-fetcher.js';
import { type InboxEntry, InboxStore } from './inbox.js';
import { type Assistant, type CommandContext, createAssistant, executeCommand, parseCommand } from './index.js';
import { setPeerBase } from './peer-require.js';
import { createProactiveCoordinator, type ProactiveCoordinator } from './proactive.js';
import { Scheduler } from './scheduler.js';
import { SeenMessageStore } from './seen-messages.js';
import { createGolemServer, type GolemServer, type ServerOpts } from './server.js';
import { TaskStore } from './task-store.js';
import {
  type ChannelsConfig,
  type DingtalkChannelConfig,
  type DiscordChannelConfig,
  type FeishuChannelConfig,
  type GolemConfig,
  type GroupChatConfig,
  loadConfig,
  type SlackChannelConfig,
  type StreamingConfig,
  scanSkills,
  type TelegramChannelConfig,
  type WecomChannelConfig,
  type WeixinChannelConfig,
} from './workspace.js';

export function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLen) {
    let splitIdx = remaining.lastIndexOf('\n\n', maxLen);
    if (splitIdx <= 0) splitIdx = remaining.lastIndexOf('\n', maxLen);
    if (splitIdx <= 0) splitIdx = remaining.lastIndexOf(' ', maxLen);
    if (splitIdx <= 0) splitIdx = maxLen;

    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).replace(/^\n+/, '');
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function summarizeToolCall(name: string, args: string, maxLen = 72): string {
  const firstToken = name.split(/\s/)[0];
  const label = firstToken.includes('/') ? firstToken.split('/').pop()! : firstToken;
  const compactArgs = args.replace(/\s+/g, ' ').trim();
  if (!compactArgs || compactArgs === '{}' || compactArgs === '[]') return `🔧 ${label}...`;
  const preview = compactArgs.length > maxLen ? `${compactArgs.slice(0, maxLen)}...` : compactArgs;
  return `🔧 ${label} ${preview}`;
}

function buildErrorNotice(errorMessage: string, timeoutSeconds: number): { reply: string; status: string } {
  if (/stopped by user/i.test(errorMessage)) {
    return {
      reply: 'The task was stopped before completion. The partial reply above may be incomplete.',
      status: '⏹️ Stopped',
    };
  }
  if (/timed out/i.test(errorMessage)) {
    return {
      reply: `Task timed out after ${timeoutSeconds}s. The partial reply above may be incomplete.`,
      status: `⚠️ Timed out (${timeoutSeconds}s)`,
    };
  }
  return {
    reply: 'The reply was interrupted before completion. The partial reply above may be incomplete.',
    status: '⚠️ Interrupted',
  };
}

interface GatewayOpts {
  dir?: string;
  port?: number;
  host?: string;
  token?: string;
  apiKey?: string;
  verbose?: boolean;
}

function log(verbose: boolean, ...args: unknown[]): void {
  if (verbose) console.log(...args);
}

// ── Group chat state (in-memory, per gateway process) ───────────────────────

export interface GroupMessage {
  senderName: string;
  text: string;
  isBot: boolean;
}

/** Recent message history per group conversation (channel or Slack thread). */
export const groupHistories = new Map<string, GroupMessage[]>();

/** Total bot replies sent per group — used as a safety valve against runaway chains. */
export const groupTurnCounters = new Map<string, number>();

/** Timestamp of the last human (non-bot) message per group — used to reset turn counters. */
export const groupLastActivity = new Map<string, number>();

/** Clear all in-memory group state for a session key (called by the resetSession wrapper). */
export function clearGroupChatState(sessionKey: string): void {
  groupHistories.delete(sessionKey);
  groupTurnCounters.delete(sessionKey);
  groupLastActivity.delete(sessionKey);
}

/**
 * After this many milliseconds of silence in a group, reset the turn counter.
 * This ensures maxTurns is a per-conversation limit, not a permanent lifetime ban.
 */
export const GROUP_TURN_RESET_MS = 60 * 60 * 1000; // 1 hour

/**
 * Purge all in-memory group state for groups that have been idle longer than
 * `GROUP_TURN_RESET_MS`. Called periodically to prevent unbounded memory growth
 * when a gateway process serves many dynamic groups over its lifetime.
 */
export function purgeIdleGroups(): void {
  const cutoff = Date.now() - GROUP_TURN_RESET_MS;
  for (const [key, ts] of groupLastActivity) {
    if (ts < cutoff) {
      groupHistories.delete(key);
      groupTurnCounters.delete(key);
      groupLastActivity.delete(key);
    }
  }
}

export function resolveGroupChatConfig(config: GolemConfig): Required<GroupChatConfig> {
  const gc = config.groupChat ?? {};
  return {
    groupPolicy: gc.groupPolicy ?? 'mention-only',
    historyLimit: gc.historyLimit ?? 20,
    maxTurns: gc.maxTurns ?? 10,
  };
}

export function resolveStreamingConfig(config: GolemConfig): Required<StreamingConfig> {
  const sc = config.streaming ?? {};
  return {
    mode: sc.mode ?? 'streaming',
    showToolCalls: sc.showToolCalls ?? false,
  };
}

/** Peer bot info for multi-bot awareness in group prompts. */
export interface PeerBot {
  name: string;
  role?: string;
}

export function buildGroupPrompt(
  history: GroupMessage[],
  senderName: string,
  userText: string,
  injectPass: boolean,
  groupKey: string,
  _dir: string,
  /** When set, the message explicitly @mentions someone else — this bot should almost always [PASS]. */
  othersAddressed?: string[],
  /** Other GolemBot instances discovered via fleet, for multi-bot coordination. */
  peers?: PeerBot[],
): string {
  const parts: string[] = [];

  if (injectPass) {
    const base =
      '[System: You are participating in a group chat and were NOT directly addressed. ' +
      'Only respond if you have something important to add or correct. ' +
      'If you have nothing essential to contribute, respond with exactly: [PASS]]';
    if (othersAddressed && othersAddressed.length > 0) {
      const names = othersAddressed.join(', ');
      parts.push(
        `[System: This message is directed at ${names}, not you. ` +
          'Only respond if you have something important to add or correct. ' +
          'If you have nothing essential to contribute, respond with exactly: [PASS]]',
      );
    } else {
      parts.push(base);
    }
  }

  // Inject peer bot awareness — lets the agent know about other bots in the fleet
  if (peers && peers.length > 0) {
    const peerDescs = peers.map((p) => (p.role ? `${p.name} (${p.role})` : p.name));
    parts.push(`[Peers: ${peerDescs.join(', ')}]`);
    // When not in smart mode (no [PASS] instructions), add lighter guidance
    // so the agent still understands it has peer bots and can defer on out-of-domain topics
    if (!injectPass) {
      parts.push(
        '[System: Other bots listed above are your peers. ' +
          'Focus on your own domain expertise. If a question is clearly better suited ' +
          'for a peer, mention them by name and let them handle it.]',
      );
    }
  }

  // Inject group identity + memory file path so the agent can read/update group memory
  const safeKey = groupKey.replace(/[^a-z0-9_-]/gi, '-');
  const memoryPath = join('memory', 'groups', `${safeKey}.md`);
  parts.push(`[Group: ${groupKey} | MemoryFile: ${memoryPath}]`);

  if (history.length > 1) {
    // history already includes the current message we just pushed; exclude the last entry
    const recentHistory = history.slice(0, -1);
    parts.push('--- Recent group conversation ---');
    for (const m of recentHistory) {
      // In multi-bot scenarios, show which bot spoke (not just generic [bot])
      const label = m.isBot ? `[bot:${m.senderName}]` : `[${m.senderName}]`;
      parts.push(`${label} ${m.text}`);
    }
    parts.push('--- New message ---');
  }

  parts.push(`[${senderName}] ${userText}`);
  return parts.join('\n');
}

export function requireFields(type: string, config: Record<string, unknown>, fields: string[]): void {
  const missing = fields.filter((f) => !config[f]);
  if (missing.length > 0) {
    throw new Error(`Channel "${type}" is missing required config: ${missing.join(', ')}`);
  }
}

/**
 * Extract @mentions from AI reply text by matching against known group members.
 * Returns the original text (unchanged) plus a list of resolved mention targets.
 */
export function parseMentions(
  text: string,
  memberCache: Map<string, string>,
): { text: string; mentions: MentionTarget[] } {
  const mentions: MentionTarget[] = [];
  if (memberCache.size === 0) return { text, mentions };

  const mentionPattern = /@([\w\u4e00-\u9fff]{1,20})/g;
  const seen = new Set<string>();
  let match;
  while ((match = mentionPattern.exec(text)) !== null) {
    const name = match[1];
    if (seen.has(name)) continue;
    const platformId = memberCache.get(name);
    if (platformId) {
      mentions.push({ name, platformId });
      seen.add(name);
    }
  }
  return { text, mentions };
}

async function createChannelAdapter(
  type: string,
  channelConfig: Record<string, unknown>,
  dir: string,
): Promise<ChannelAdapter> {
  switch (type) {
    case 'feishu': {
      requireFields(type, channelConfig, ['appId', 'appSecret']);
      const { FeishuAdapter } = await import('./channels/feishu.js');
      return new FeishuAdapter(channelConfig as unknown as FeishuChannelConfig);
    }
    case 'dingtalk': {
      requireFields(type, channelConfig, ['clientId', 'clientSecret']);
      const { DingtalkAdapter } = await import('./channels/dingtalk.js');
      return new DingtalkAdapter(channelConfig as unknown as DingtalkChannelConfig);
    }
    case 'wecom': {
      requireFields(type, channelConfig, ['botId', 'secret']);
      const { WecomAdapter } = await import('./channels/wecom.js');
      return new WecomAdapter(channelConfig as unknown as WecomChannelConfig);
    }
    case 'slack': {
      requireFields(type, channelConfig, ['botToken', 'appToken']);
      const { SlackAdapter } = await import('./channels/slack.js');
      return new SlackAdapter(channelConfig as unknown as SlackChannelConfig);
    }
    case 'telegram': {
      requireFields(type, channelConfig, ['botToken']);
      const { TelegramAdapter } = await import('./channels/telegram.js');
      return new TelegramAdapter(channelConfig as unknown as TelegramChannelConfig);
    }
    case 'discord': {
      requireFields(type, channelConfig, ['botToken']);
      const { DiscordAdapter } = await import('./channels/discord.js');
      return new DiscordAdapter(channelConfig as unknown as DiscordChannelConfig);
    }
    case 'weixin': {
      requireFields(type, channelConfig, ['token']);
      const { WeixinAdapter } = await import('./channels/weixin.js');
      return new WeixinAdapter(channelConfig as unknown as WeixinChannelConfig);
    }
    default: {
      const adapterPath = channelConfig._adapter;
      if (typeof adapterPath !== 'string') {
        throw new Error(`Unknown channel type "${type}". Add "_adapter: <path or package>" to use a custom adapter.`);
      }
      const resolvedPath =
        adapterPath.startsWith('.') || adapterPath.startsWith('/') ? resolve(dir, adapterPath) : adapterPath;
      let mod: any;
      try {
        mod = await import(resolvedPath);
      } catch (e) {
        throw new Error(`Failed to load custom adapter "${adapterPath}": ${(e as Error).message}`);
      }
      const AdapterClass = mod.default ?? mod[Object.keys(mod)[0]];
      if (typeof AdapterClass !== 'function') {
        throw new Error(`Custom adapter "${adapterPath}" must export a default class.`);
      }
      return new AdapterClass(channelConfig);
    }
  }
}

/**
 * Process a single incoming IM message through the gateway pipeline.
 * Exported for unit-testing; `startGateway` calls this for every adapter message.
 */
export async function handleMessage(
  msg: ChannelMessage,
  config: GolemConfig,
  assistant: Pick<
    Assistant,
    'chat' | 'setEngine' | 'setModel' | 'getStatus' | 'resetSession' | 'cancel' | 'listModels'
  >,
  adapter: Pick<
    ChannelAdapter,
    'reply' | 'maxMessageLength' | 'typing' | 'getGroupMembers' | 'sendStatus' | 'updateStatus' | 'clearStatus'
  >,
  channelType: string,
  verbose: boolean,
  dir: string,
  metrics?: GatewayMetrics,
  cronCtx?: { taskStore: TaskStore; scheduler: Scheduler; runTask: (id: string) => Promise<string> },
  /** Fleet peers for multi-bot awareness. */
  peers?: PeerBot[],
): Promise<void> {
  const userText = msg.chatType === 'group' ? stripMention(msg.text) : msg.text;
  if (!userText && (!msg.images || msg.images.length === 0) && (!msg.files || msg.files.length === 0)) return;

  // ── Slash command interception ──
  const parsed = parseCommand(userText);
  if (parsed) {
    const sessionKey = msg.chatType === 'group' ? buildConversationKey(msg) : buildSessionKey(msg);
    const cmdCtx: CommandContext = {
      dir,
      sessionKey,
      getStatus: () => assistant.getStatus(),
      setEngine: (e, c) => assistant.setEngine(e, c),
      setModel: (m) => assistant.setModel(m),
      resetSession: (k) => assistant.resetSession(k),
      cancelSession: (k) => assistant.cancel(k),
      listModels: () => assistant.listModels(),
      taskStore: cronCtx?.taskStore,
      scheduler: cronCtx?.scheduler,
      runTask: cronCtx?.runTask,
    };
    const result = await executeCommand(parsed, cmdCtx);
    if (result) {
      log(verbose, `[${channelType}] slash command: ${parsed.name}`);
      await adapter.reply(msg, result.text);
      return;
    }
    // Unknown command — fall through to agent
  }

  const senderLabel = msg.senderName || msg.senderId;
  let sessionKey: string;
  let fullText: string;
  let injectPass = false;

  if (msg.chatType === 'group') {
    const groupKey = buildConversationKey(msg);
    sessionKey = groupKey;
    const gc = resolveGroupChatConfig(config);

    // Skip messages sent by this bot itself (prevents feedback loops in broadcast adapters)
    if (msg.senderName === config.name) return;

    // Reset turn counter if the group has been idle for longer than GROUP_TURN_RESET_MS.
    // This makes maxTurns a per-conversation limit rather than a permanent process-lifetime ban.
    const lastActivity = groupLastActivity.get(groupKey) ?? 0;
    if (Date.now() - lastActivity > GROUP_TURN_RESET_MS) {
      groupTurnCounters.delete(groupKey);
    }
    groupLastActivity.set(groupKey, Date.now());

    // Always update history buffer, regardless of policy.
    // Skip history-fetch triage prompts — they are system messages, not real group conversation.
    const isTriage = userText.startsWith('[System: You have been offline');
    const hist = groupHistories.get(groupKey) ?? [];
    const isBotSender = msg.senderType === 'bot';
    if (!isTriage) {
      hist.push({ senderName: msg.senderName ?? msg.senderId, text: userText, isBot: isBotSender });
    }
    if (hist.length > gc.historyLimit) hist.shift();
    groupHistories.set(groupKey, hist);

    // mention-only: skip if not @mentioned (zero agent cost)
    // msg.mentioned is set by adapters that detect mentions natively
    // (e.g. Discord's <@userId> token), as a fallback when text normalisation
    // hasn't happened (e.g. botName not configured).
    const mentioned = detectMention(msg.text, config.name) || !!msg.mentioned;
    if (gc.groupPolicy === 'mention-only' && !mentioned) return;

    // maxTurns safety valve: stop if this bot has replied too many times in this group
    if ((groupTurnCounters.get(groupKey) ?? 0) >= gc.maxTurns) {
      log(verbose, `[${channelType}] maxTurns (${gc.maxTurns}) reached for group ${groupKey}, skipping`);
      return;
    }

    // Ensure memory/groups/ directory exists (agent will read/write memory files here)
    await mkdir(join(dir, 'memory', 'groups'), { recursive: true }).catch(() => {});

    injectPass = gc.groupPolicy === 'smart' && !mentioned;

    // Use adapter-provided mention info for stronger [PASS] hint in multi-bot chats.
    const othersAddressed = injectPass ? msg.mentionedOthers : undefined;

    fullText = buildGroupPrompt(
      hist,
      msg.senderName ?? msg.senderId,
      userText,
      injectPass,
      groupKey,
      dir,
      othersAddressed,
      peers,
    );
  } else {
    sessionKey = buildSessionKey(msg);
    fullText = `[System: This is a private 1-on-1 conversation with ${senderLabel}.]\n${msg.text}`;
  }

  log(verbose, `[${channelType}] received from ${senderLabel}: "${userText}" → session ${sessionKey}`);
  // Send typing indicator immediately, then refresh every 4s while waiting for AI.
  // Telegram's typing action expires after ~5s, so we keep it alive.
  let typingTimer: ReturnType<typeof setInterval> | undefined;
  if (adapter.typing) {
    adapter.typing(msg).catch(() => {});
    typingTimer = setInterval(() => adapter.typing!(msg).catch(() => {}), 4000);
  }

  const msgStartMs = Date.now();

  function trackMetrics(extra: { responsePreview: string; passed?: boolean }) {
    if (!metrics) return;
    recordMessage(metrics, {
      ts: new Date().toISOString(),
      source: channelType,
      sender: senderLabel,
      messagePreview: userText.slice(0, 120),
      durationMs: durationMs ?? Date.now() - msgStartMs,
      costUsd,
      ...extra,
    });
  }

  let costUsd: number | undefined;
  let durationMs: number | undefined;

  const maxLen = adapter.maxMessageLength ?? 4000;
  const streamingConfig = resolveStreamingConfig(config);
  const debugEventsEnabled = verbose || isDebugEventsEnabled();
  let hasVisibleStatus = false;
  let thinkingStatusTimer: ReturnType<typeof setTimeout> | undefined;
  let statusMessageId: string | undefined;
  let statusMessageText: string | undefined;
  let statusFinalized = false;

  const cancelThinkingStatus = () => {
    if (thinkingStatusTimer !== undefined) {
      clearTimeout(thinkingStatusTimer);
      thinkingStatusTimer = undefined;
    }
  };

  const sendStatusUpdate = async (text: string): Promise<void> => {
    if (!text.trim()) return;
    cancelThinkingStatus();
    debugEventLog(
      debugEventsEnabled,
      `[event-debug] gateway status textChars=${text.trim().length} hasStatus=${!!statusMessageId}`,
    );
    if (adapter.sendStatus && adapter.updateStatus && adapter.clearStatus) {
      if (!statusMessageId) {
        statusMessageId = await adapter.sendStatus(msg, text.trim());
      } else {
        await adapter.updateStatus(msg, statusMessageId, text.trim());
      }
      statusMessageText = text.trim();
      return;
    }
    if (hasVisibleStatus) return;
    hasVisibleStatus = true;
    await adapter.reply(msg, text.trim());
  };

  const finalizeStatusUpdate = async (finalText = '✅ Done'): Promise<void> => {
    cancelThinkingStatus();
    if (!statusMessageId) return;
    debugEventLog(debugEventsEnabled, `[event-debug] gateway status-final textChars=${finalText.length}`);
    if (adapter.updateStatus) {
      await adapter.updateStatus(msg, statusMessageId, finalText);
      statusMessageText = finalText;
      statusFinalized = true;
      return;
    }
    if (adapter.clearStatus) {
      const currentStatusId = statusMessageId;
      statusMessageId = undefined;
      await adapter.clearStatus(msg, currentStatusId);
    }
  };

  if (msg.chatType === 'dm') {
    thinkingStatusTimer = setTimeout(() => {
      sendStatusUpdate('⏳ thinking...').catch(() => {});
    }, 1500);
  }

  // Helper: send a text chunk to the IM channel (handles splitMessage + mentions).
  const sendChunk = async (text: string): Promise<void> => {
    if (!text.trim()) return;
    hasVisibleStatus = true;
    cancelThinkingStatus();
    if (statusMessageId && adapter.updateStatus && statusMessageText !== '✍️ replying...') {
      await adapter.updateStatus(msg, statusMessageId, '✍️ replying...');
      statusMessageText = '✍️ replying...';
    }
    // Final safety net: never send [PASS]/[SKIP] sentinel values to IM
    const sentinel = text.trim();
    if (sentinel === '[PASS]' || sentinel === '[SKIP]') {
      log(verbose, `[${channelType}] sendChunk blocked sentinel: ${sentinel}`);
      return;
    }
    const chunks = splitMessage(text.trim(), maxLen);
    debugEventLog(
      debugEventsEnabled,
      `[event-debug] gateway reply totalChars=${text.trim().length} chunks=${chunks.length} chatType=${msg.chatType}`,
    );
    let mentions: MentionTarget[] = [];
    if (msg.chatType === 'group' && adapter.getGroupMembers) {
      try {
        const memberCache = await adapter.getGroupMembers(msg.chatId);
        mentions = parseMentions(text.trim(), memberCache).mentions;
      } catch {
        /* best effort */
      }
    }
    const replyOpts = mentions.length > 0 ? { mentions } : undefined;
    for (const chunk of chunks) {
      await adapter.reply(msg, chunk, replyOpts);
    }
    // Stop typing indicator after first message is sent
    if (typingTimer !== undefined) {
      clearInterval(typingTimer);
      typingTimer = undefined;
    }
  };

  try {
    let fullReply = '';
    let hasError = false;
    let lastErrorMessage = '';
    const timeoutSeconds = config.timeout ?? 300;
    // When injectPass is active (smart mode, not mentioned), force buffered behavior
    // to prevent [PASS] sentinel from leaking to IM before we can detect and suppress it.
    const effectiveMode = injectPass ? 'buffered' : streamingConfig.mode;

    if (effectiveMode === 'streaming') {
      // ── Streaming mode: send text at logical boundaries ──
      let buffer = '';
      let chunkIdx = 0;

      // Flush the buffer to IM. Called at paragraph breaks, tool_call, and done.
      const flush = async (reason: string): Promise<void> => {
        if (!buffer.trim()) {
          buffer = '';
          return;
        }
        chunkIdx++;
        console.log(
          `[stream-debug] chunk #${chunkIdx} (${reason}): "${buffer.trim().slice(0, 80)}…" [${buffer.length} chars]`,
        );
        await sendChunk(buffer);
        buffer = '';
      };

      for await (const event of assistant.chat(fullText, { sessionKey, images: msg.images, files: msg.files })) {
        debugEventLog(debugEventsEnabled, `[event-debug] gateway ${summarizeStreamEvent(event)}`);
        if (event.type === 'text') {
          fullReply += event.content;
          buffer += event.content;

          // Flush at paragraph boundaries (\n\n) within the buffer.
          // Split on double-newline, flush completed paragraphs, keep the tail.
          const parts = buffer.split(/\n\n/);
          if (parts.length > 1) {
            // Everything except the last part is complete paragraphs — send them
            const complete = parts.slice(0, -1).join('\n\n');
            buffer = parts[parts.length - 1];
            chunkIdx++;
            console.log(
              `[stream-debug] chunk #${chunkIdx} (paragraph): "${complete.trim().slice(0, 80)}…" [${complete.length} chars]`,
            );
            await sendChunk(complete);
          }
        } else if (event.type === 'tool_call') {
          // Agent switches to tool use — flush accumulated text first
          await flush('tool_call');
          if (streamingConfig.showToolCalls) {
            const hint = summarizeToolCall(event.name, event.args);
            log(verbose, `[${channelType}] stream tool_call: ${hint}`);
            await sendStatusUpdate(hint);
          } else {
            log(verbose, `[${channelType}] stream tool_call: ${event.name.slice(0, 40)}`);
          }
        } else if (event.type === 'warning') {
          log(verbose, `[${channelType}] warning: ${event.message}`);
        } else if (event.type === 'error') {
          hasError = true;
          lastErrorMessage = event.message;
          console.error(`[${channelType}] Engine error: ${event.message}`);
        } else if (event.type === 'done') {
          if (!fullReply.trim() && event.fullText) {
            fullReply = event.fullText;
            buffer = event.fullText;
          }
          costUsd = event.costUsd;
          durationMs = event.durationMs;
        }
      }

      // Flush remaining buffer
      await flush('done');
      console.log(`[stream-debug] finished: ${chunkIdx} chunk(s) sent, fullReply=${fullReply.length} chars`);

      // [PASS] sentinel — in streaming mode (which is now only used when injectPass=false),
      // this check handles the rare case where a non-smart-mode agent outputs [PASS].
      // Smart-mode [PASS] leak is prevented by forcing buffered mode above.
      const trimmed = fullReply.trim();
      if (trimmed === '[PASS]' || trimmed === '[SKIP]') {
        log(verbose, `[${channelType}] ${trimmed} — bot chose not to respond`);
        trackMetrics({ passed: true, responsePreview: '' });
        return;
      }

      if (!trimmed && hasError) {
        await sendChunk('Sorry, an error occurred while processing your message. Please try again later.');
        fullReply = 'Sorry, an error occurred while processing your message. Please try again later.';
      }

      let finalStatusText: string | undefined;
      if (trimmed && hasError) {
        const notice = buildErrorNotice(lastErrorMessage, timeoutSeconds);
        await sendChunk(notice.reply);
        finalStatusText = notice.status;
      } else if (hasError) {
        finalStatusText = '⚠️ Failed';
      }

      if (fullReply.trim()) {
        await finalizeStatusUpdate(finalStatusText ?? '✅ Done');
        log(verbose, `[${channelType}] replied to ${senderLabel}: "${fullReply.trim().slice(0, 80)}..." (streaming)`);
        trackMetrics({ responsePreview: fullReply.trim().slice(0, 120) });
      }
    } else {
      // ── Buffered mode (default): accumulate all text, send at end ──
      for await (const event of assistant.chat(fullText, { sessionKey, images: msg.images, files: msg.files })) {
        debugEventLog(debugEventsEnabled, `[event-debug] gateway ${summarizeStreamEvent(event)}`);
        if (event.type === 'text') {
          fullReply += event.content;
        } else if (event.type === 'warning') {
          log(verbose, `[${channelType}] warning: ${event.message}`);
        } else if (event.type === 'error') {
          hasError = true;
          lastErrorMessage = event.message;
          console.error(`[${channelType}] Engine error: ${event.message}`);
        } else if (event.type === 'done') {
          if (!fullReply.trim() && event.fullText) {
            fullReply = event.fullText;
          }
          costUsd = event.costUsd;
          durationMs = event.durationMs;
        }
      }

      // [PASS] / [SKIP] sentinel: bot chose to stay silent
      const trimmedBuf = fullReply.trim();
      if (trimmedBuf === '[PASS]' || trimmedBuf === '[SKIP]') {
        log(verbose, `[${channelType}] ${trimmedBuf} — bot chose not to respond`);
        trackMetrics({ passed: true, responsePreview: '' });
        return;
      }

      if (!fullReply.trim() && hasError) {
        fullReply = 'Sorry, an error occurred while processing your message. Please try again later.';
      }

      if (fullReply.trim()) {
        await sendChunk(fullReply);
        let finalStatusText: string | undefined;
        if (
          hasError &&
          fullReply !== 'Sorry, an error occurred while processing your message. Please try again later.'
        ) {
          const notice = buildErrorNotice(lastErrorMessage, timeoutSeconds);
          await sendChunk(notice.reply);
          finalStatusText = notice.status;
        } else if (hasError) {
          finalStatusText = '⚠️ Failed';
        }
        await finalizeStatusUpdate(finalStatusText ?? '✅ Done');
        log(verbose, `[${channelType}] replied to ${senderLabel}: "${fullReply.trim().slice(0, 80)}..."`);
        trackMetrics({ responsePreview: fullReply.trim().slice(0, 120) });
      }
    }

    // Update group history with the full reply + increment turn counter
    if (fullReply.trim() && msg.chatType === 'group') {
      const groupKey = buildConversationKey(msg);
      const gc = resolveGroupChatConfig(config);
      const hist = groupHistories.get(groupKey) ?? [];
      hist.push({ senderName: config.name, text: fullReply.trim(), isBot: true });
      if (hist.length > gc.historyLimit) hist.shift();
      groupHistories.set(groupKey, hist);
      groupTurnCounters.set(groupKey, (groupTurnCounters.get(groupKey) ?? 0) + 1);
    }
  } catch (e) {
    console.error(`[${channelType}] Failed to process message:`, e);
    try {
      await adapter.reply(msg, 'Sorry, an error occurred while processing your message. Please try again later.');
    } catch {
      // best effort
    }
  } finally {
    if (!statusFinalized && statusMessageId) {
      await finalizeStatusUpdate();
    }
    cancelThinkingStatus();
    if (typingTimer !== undefined) clearInterval(typingTimer);
  }
}

// ── CLI banner ───────────────────────────────────────────────────────────────

const ANSI = {
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
} as const;

function printBanner(ctx: {
  host: string;
  port: number;
  version: string;
  config: GolemConfig;
  token?: string;
  channelStatuses: ChannelStatus[];
}): void {
  const { dim, bold, reset, cyan, green, red, yellow } = ANSI;
  const { host, port, version, config, token, channelStatuses } = ctx;
  const url = `http://${host}:${port}`;

  console.log('');
  console.log(`  ${bold}🤖 GolemBot Gateway${reset} ${dim}v${version}${reset}`);
  console.log(`  ${dim}${'─'.repeat(44)}${reset}`);
  console.log(`  ${dim}Bot:${reset}        ${config.name} ${dim}(${config.engine})${reset}`);
  if (config.model) console.log(`  ${dim}Model:${reset}      ${config.model}`);
  console.log(`  ${dim}Auth:${reset}       ${token ? `${green}enabled${reset}` : `${yellow}disabled${reset}`}`);
  console.log('');

  console.log(`  ${bold}Endpoints${reset}`);
  console.log(`  ${cyan}➜${reset}  Dashboard   ${cyan}${url}/${reset}`);
  console.log(`  ${cyan}➜${reset}  HTTP API    ${dim}POST${reset} ${url}/chat`);
  console.log(`  ${cyan}➜${reset}  Health      ${dim}GET${reset}  ${url}/health`);
  console.log('');

  const connectedCount = channelStatuses.filter((c) => c.status === 'connected').length;
  console.log(`  ${bold}Channels${reset} ${dim}(${connectedCount} connected)${reset}`);
  for (const ch of channelStatuses) {
    const name = ch.type.charAt(0).toUpperCase() + ch.type.slice(1);
    if (ch.status === 'connected') {
      console.log(`  ${green}●${reset}  ${name}`);
    } else if (ch.status === 'failed') {
      console.log(`  ${red}●${reset}  ${name} ${dim}— ${ch.error}${reset}`);
    } else {
      console.log(`  ${dim}○  ${name}${reset}`);
    }
  }
  if (connectedCount === 0) {
    console.log(`  ${dim}   Add channels in golem.yaml or visit the Dashboard${reset}`);
  }
  console.log('');

  const authParam = token ? ` \\\n     -H 'Authorization: Bearer ${token}'` : '';
  console.log(`  ${bold}Quick test${reset}`);
  console.log(`  ${dim}$ curl -X POST ${url}/chat${authParam} \\`);
  console.log(`     -H 'Content-Type: application/json' \\`);
  console.log(`     -d '{"message":"hello"}'${reset}`);
  console.log('');
}

// ── Inbox consumer loop ──────────────────────────────────────────────────────

/**
 * Convert a ChannelMessage to inbox entry fields for enqueueing.
 */
export function channelMsgToInbox(
  msg: ChannelMessage,
  sessionKey: string,
  fullText: string,
): Omit<InboxEntry, 'id' | 'ts' | 'status'> {
  return {
    sessionKey,
    message: fullText,
    source: msg.channelType,
    channelMsg: {
      channelType: msg.channelType,
      senderId: msg.senderId,
      senderName: msg.senderName,
      chatId: msg.chatId,
      chatType: msg.chatType,
      messageId: msg.messageId,
      threadId: msg.threadId,
      mentioned: msg.mentioned,
    },
  };
}

/**
 * Start a sequential inbox consumer that processes pending messages one by one.
 * Returns a stop function.
 */
export function startInboxConsumer(
  inbox: InboxStore,
  processEntry: (entry: InboxEntry) => Promise<void>,
  verbose: boolean,
): { stop: () => void } {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const loop = async () => {
    while (!stopped) {
      try {
        const pending = await inbox.getPending();
        if (pending.length === 0) {
          // Sleep 1s before checking again
          await new Promise<void>((r) => {
            timer = setTimeout(r, 1000);
          });
          continue;
        }

        for (const entry of pending) {
          if (stopped) break;
          log(verbose, `[inbox] processing ${entry.id} from ${entry.source} (session: ${entry.sessionKey})`);
          await inbox.updateStatus(entry.id, 'processing');
          try {
            await processEntry(entry);
            await inbox.updateStatus(entry.id, 'done');
          } catch (e) {
            console.error(`[inbox] Failed to process entry ${entry.id}:`, e);
            await inbox.updateStatus(entry.id, 'failed', {
              error: (e as Error).message,
            });
          }
        }
      } catch (e) {
        console.error('[inbox] Consumer error:', e);
        // Sleep before retry
        await new Promise<void>((r) => {
          timer = setTimeout(r, 2000);
        });
      }
    }
  };

  loop();

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}

// ── Gateway startup ──────────────────────────────────────────────────────────

export async function startGateway(opts: GatewayOpts): Promise<void> {
  const dir = resolve(opts.dir || '.');
  setPeerBase(dir);

  const config: GolemConfig = await loadConfig(dir);
  const verbose = opts.verbose ?? false;

  const assistant: Assistant = createAssistant({
    dir,
    apiKey: opts.apiKey,
    maxConcurrent: config.maxConcurrent,
    maxQueuePerSession: config.maxQueuePerSession,
    timeoutMs: config.timeout ? config.timeout * 1000 : undefined,
  });

  // Wrap resetSession so that POST /reset also clears the gateway's in-memory
  // group state (history buffer, turn counter, last-activity timestamp).
  const _originalReset = assistant.resetSession.bind(assistant);
  assistant.resetSession = async (sessionKey: string) => {
    clearGroupChatState(sessionKey);
    return _originalReset(sessionKey);
  };

  const gatewayConfig = config.gateway || {};
  const port = opts.port ?? gatewayConfig.port ?? 3000;
  const host = opts.host ?? gatewayConfig.host ?? '127.0.0.1';
  const token = opts.token ?? gatewayConfig.token;

  // ── Dashboard: metrics + channel statuses ──
  const metrics: GatewayMetrics = createMetrics();
  const channelStatuses: ChannelStatus[] = [];
  const skills = await scanSkills(dir);

  let version = '0.0.0';
  try {
    const selfDir = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(await readFileAsync(join(selfDir, '..', 'package.json'), 'utf-8'));
    version = pkg.version ?? version;
  } catch {
    /* ok — dev mode or missing */
  }

  // TaskStore is created here (before channels) so we can pass it to dashboardCtx.
  // The coordinator is created later, after channels are ready.
  const taskStore = new TaskStore(dir);

  const dashboardCtx: DashboardContext = {
    config,
    skills,
    channelStatuses,
    metrics,
    startTime: Date.now(),
    version,
    getRuntimeStatus: async () => {
      const s = await assistant.getStatus();
      return { engine: s.engine, model: s.model };
    },
    taskStore,
    dir,
    getFleetPeers: async () => {
      try {
        const instances = await listInstances();
        return instances
          .filter((i) => i.name !== config.name)
          .map((i) => ({
            name: i.name,
            url: i.url,
            engine: i.engine,
            model: i.model,
            role: i.role,
            alive: i.alive,
          }));
      } catch {
        return [];
      }
    },
  };

  // shutdown is assigned later after httpServer is created — use a wrapper
  let shutdownFn: (() => Promise<void>) | undefined;
  const serverOpts: ServerOpts = { port, token, hostname: host, onShutdown: () => shutdownFn?.() };
  const httpServer: GolemServer = createGolemServer(
    assistant,
    serverOpts,
    dashboardCtx,
    dir,
    () => (coordinator ? { taskStore, scheduler, runTask: (id) => coordinator!.runTask(id) } : undefined),
    () => adapterMap,
  );

  // Declare scheduler & coordinator early so adapter callbacks can reference them safely.
  const scheduler = new Scheduler();
  let coordinator: ProactiveCoordinator | undefined;

  // ── Fleet peer cache (multi-bot awareness) ─────────────────────────────────
  let fleetPeers: PeerBot[] = [];
  const refreshFleetPeers = async () => {
    try {
      const instances = await listInstances();
      fleetPeers = instances.filter((i) => i.name !== config.name).map((i) => ({ name: i.name, role: i.role }));
    } catch {
      /* best effort */
    }
  };
  await refreshFleetPeers();
  const peerRefreshTimer = setInterval(refreshFleetPeers, 60_000);
  peerRefreshTimer.unref();

  const adapters: ChannelAdapter[] = [];
  const adapterMap = new Map<string, ChannelAdapter>();
  const channels: ChannelsConfig | undefined = config.channels;

  // ── Inbox (persistent message queue) ────────────────────────────────────────
  const inboxEnabled = config.inbox?.enabled === true;
  const inboxStore = inboxEnabled ? new InboxStore(dir) : undefined;
  let inboxConsumer: { stop: () => void } | undefined;

  // Persistent dedup store — shared between real-time and history-fetch paths
  const seenMessages = new SeenMessageStore(dir);
  await seenMessages.load();

  if (channels) {
    for (const [type, channelConfig] of Object.entries(channels)) {
      if (!channelConfig) continue;

      try {
        const adapter = await createChannelAdapter(type, channelConfig as Record<string, unknown>, dir);

        // Set read receipt handler before start() so adapters can subscribe during initialization.
        adapter.readReceiptHandler = (receipt: ReadReceipt) => {
          log(verbose, `[${type}] read receipt: message ${receipt.messageId} read by ${receipt.readerId}`);
        };

        if (inboxStore) {
          // Inbox mode: enqueue messages for sequential consumption
          await adapter.start((msg: ChannelMessage) => {
            // Dedup by persistent seen store + inbox seen set (messageId + content fingerprint)
            if (msg.messageId) {
              if (seenMessages.has(type, msg.messageId) || inboxStore.has(type, msg.messageId)) {
                log(verbose, `[${type}] duplicate message ${msg.messageId}, skipping`);
                return;
              }
              // Mark as seen persistently — survives restart
              seenMessages.mark(type, msg.messageId);
            }
            // Content-based dedup: same sender + same text = same message
            if (msg.senderId && msg.text && seenMessages.hasContent(type, msg.senderId, msg.text)) {
              log(verbose, `[${type}] duplicate content from ${msg.senderId}, skipping`);
              return;
            }
            if (msg.senderId && msg.text) {
              seenMessages.markContent(type, msg.senderId, msg.text);
            }

            // Build sessionKey + fullText the same way handleMessage does,
            // but we need the ChannelMessage for reply routing, so we store the
            // raw msg reference keyed by entry ID in a local map.
            const sessionKey = msg.chatType === 'group' ? buildConversationKey(msg) : buildSessionKey(msg);

            const entry = channelMsgToInbox(msg, sessionKey, msg.text);
            log(verbose, `[${type}] enqueued message from ${msg.senderName || msg.senderId}`);
            inboxStore.enqueue(entry);
          });
        } else {
          // Direct mode (original behavior)
          await adapter.start((msg: ChannelMessage) =>
            handleMessage(
              msg,
              config,
              assistant,
              adapter,
              type,
              verbose,
              dir,
              metrics,
              coordinator ? { taskStore, scheduler, runTask: (id) => coordinator!.runTask(id) } : undefined,
              fleetPeers,
            ),
          );
        }

        adapters.push(adapter);
        adapterMap.set(type, adapter);
        channelStatuses.push({ type, status: 'connected' });

        // DingTalk Stream SDK only delivers @mention messages to the bot.
        // Warn if the user configured smart/always, which won't work as expected.
        if (type === 'dingtalk') {
          const gc = resolveGroupChatConfig(config);
          if (gc.groupPolicy !== 'mention-only') {
            console.warn(
              `   ⚠️  DingTalk groupPolicy "${gc.groupPolicy}" will behave like "mention-only" — ` +
                `the platform only delivers @mention messages to bots.`,
            );
          }
        }
      } catch (e) {
        channelStatuses.push({ type, status: 'failed', error: (e as Error).message });
      }
    }
  }

  // Mark unconfigured channels
  for (const type of KNOWN_CHANNELS) {
    if (!channelStatuses.some((c) => c.type === type)) {
      channelStatuses.push({ type, status: 'not_configured' });
    }
  }

  // ── Start inbox consumer ───────────────────────────────────────────────────
  if (inboxStore) {
    // Recover any messages left in 'processing' state from a previous crash.
    // Skip entries whose messageId is already in the persistent seen store —
    // they were already processed (and likely replied to) before the crash.
    const recovered = await inboxStore.getPending();
    for (const entry of recovered) {
      const mid = entry.channelMsg?.messageId;
      const ct = entry.channelMsg?.channelType;
      if (mid && ct && seenMessages.has(ct, mid)) {
        log(verbose, `[inbox] Skipping recovered entry ${entry.id} — already seen (${mid})`);
        await inboxStore.updateStatus(entry.id, 'done');
      }
    }
    const stillPending = recovered.filter((e) => e.status === 'pending');
    if (stillPending.length > 0) {
      log(verbose, `[inbox] Recovered ${stillPending.length} pending message(s) from previous session`);
    }

    inboxConsumer = startInboxConsumer(
      inboxStore,
      async (entry) => {
        // Reconstruct a ChannelMessage from the stored entry for handleMessage
        const chMsg = entry.channelMsg;
        if (!chMsg) {
          log(verbose, `[inbox] Entry ${entry.id} has no channelMsg, skipping`);
          return;
        }

        const adapter = adapterMap.get(chMsg.channelType);
        if (!adapter) {
          log(verbose, `[inbox] No adapter for ${chMsg.channelType}, skipping entry ${entry.id}`);
          return;
        }

        const msg: ChannelMessage = {
          channelType: chMsg.channelType,
          senderId: chMsg.senderId,
          senderName: chMsg.senderName,
          chatId: chMsg.chatId,
          chatType: chMsg.chatType,
          messageId: chMsg.messageId,
          threadId: chMsg.threadId,
          text: entry.message,
          raw: {},
          // For history-fetch triage, mentioned is set from the adapter's
          // per-message mention resolution (e.g. Feishu single-message API).
          mentioned: chMsg.mentioned,
        };

        // For inbox entries (especially history-fetch), the raw object is empty,
        // so adapter.reply() may fail (e.g. Discord needs raw.reply()).
        // Wrap adapter to fallback to send() when reply() throws.
        const wrappedAdapter: Pick<
          ChannelAdapter,
          'reply' | 'maxMessageLength' | 'typing' | 'getGroupMembers' | 'sendStatus' | 'updateStatus' | 'clearStatus'
        > = {
          maxMessageLength: adapter.maxMessageLength,
          typing: adapter.typing?.bind(adapter),
          getGroupMembers: adapter.getGroupMembers?.bind(adapter),
          sendStatus: adapter.sendStatus?.bind(adapter),
          updateStatus: adapter.updateStatus?.bind(adapter),
          clearStatus: adapter.clearStatus?.bind(adapter),
          reply: async (m, text, opts) => {
            try {
              await adapter.reply(m, text, opts);
            } catch {
              // Fallback: send directly to chatId (no quote reply)
              if (adapter.send) {
                await adapter.send(m.chatId, text);
              } else {
                log(verbose, `[inbox] reply failed and no send() available for ${chMsg.channelType}`);
              }
            }
          },
        };

        await handleMessage(
          msg,
          config,
          assistant,
          wrappedAdapter,
          chMsg.channelType,
          verbose,
          dir,
          metrics,
          coordinator ? { taskStore, scheduler, runTask: (id) => coordinator!.runTask(id) } : undefined,
          fleetPeers,
        );

        // Update session activity timestamp AFTER the Agent finishes responding,
        // not just at enqueue time.  This extends the history-fetch suppression
        // window to cover the full Agent processing duration.
        if (entry.source !== 'history-fetch') {
          inboxStore.touchRealtimeTs(entry.sessionKey);
        }
      },
      verbose,
    );
    log(verbose, '[inbox] Consumer started');

    // Schedule periodic compaction
    const retentionDays = config.inbox?.retentionDays ?? 7;
    const compactTimer = setInterval(
      async () => {
        const removed = await inboxStore.compact(retentionDays);
        if (removed > 0) log(verbose, `[inbox] Compacted ${removed} old entries`);
      },
      6 * 60 * 60 * 1000, // every 6 hours
    );
    compactTimer.unref();
  }

  // ── History fetcher (offline message awareness) ─────────────────────────────
  let historyPoller: { stop: () => void } | undefined;
  if (inboxStore && config.historyFetch?.enabled) {
    const fetcher = startHistoryFetcher({
      dir,
      adapters: adapterMap,
      inbox: inboxStore,
      seenMessages,
      config: config.historyFetch,
      verbose,
    });

    // Delay the initial history-fetch to give WebSocket connections time to
    // deliver catch-up events.  Without this delay, fetchNow() races with the
    // WebSocket reconnection: the REST API may return messages *before* the
    // real-time path has marked them in seenMessages, causing duplicate triage.
    const startupDelayMs = 15_000; // 15 seconds
    log(verbose, `[history-fetch] Waiting ${startupDelayMs / 1000}s for WebSocket catch-up before first poll…`);
    const startupTimer = setTimeout(async () => {
      try {
        const count = await fetcher.fetchNow();
        if (count > 0) {
          log(verbose, `[history-fetch] Startup: enqueued triage for ${count} chat(s) with missed messages`);
        } else {
          log(verbose, '[history-fetch] Startup: no missed messages');
        }
      } catch (e) {
        console.error('[history-fetch] Startup fetch failed:', (e as Error).message);
      }
    }, startupDelayMs);
    if (startupTimer.unref) startupTimer.unref();

    // Start periodic polling
    historyPoller = fetcher.startPolling();
    log(verbose, `[history-fetch] Periodic polling every ${config.historyFetch.pollIntervalMinutes ?? 15}m`);
  }

  // ── Scheduled tasks ─────────────────────────────────────────────────────────
  if (config.tasks && config.tasks.length > 0) {
    try {
      const mergedTasks = await taskStore.mergeConfigTasks(config.tasks);
      coordinator = createProactiveCoordinator({
        assistant,
        taskStore,
        adapters: adapterMap,
        scheduler,
        verbose,
      });
      coordinator.start(mergedTasks);
      log(verbose, `[scheduler] ${mergedTasks.filter((t) => t.enabled).length} task(s) scheduled`);
    } catch (e) {
      console.error('[scheduler] Failed to initialize tasks:', (e as Error).message);
    }
  }

  httpServer.listen(port, host, () => {
    printBanner({ host, port, version, config, token, channelStatuses });

    // Register with fleet directory for discovery by `golembot fleet`
    registerInstance({
      name: config.name,
      url: `http://${host}:${port}`,
      pid: process.pid,
      engine: config.engine,
      model: config.model,
      version,
      startedAt: new Date().toISOString(),
      channels: channelStatuses
        .filter((c) => c.status === 'connected')
        .map((c) => ({ type: c.type, status: c.status })),
      authEnabled: !!token,
      dir,
      role: config.persona?.role,
    }).catch(() => {}); // best-effort
  });

  // Periodically purge idle group state to prevent unbounded memory growth
  const purgeTimer = setInterval(purgeIdleGroups, GROUP_TURN_RESET_MS);
  purgeTimer.unref(); // don't keep the process alive just for cleanup

  const shutdown = async () => {
    console.log('\nShutting down Gateway...');
    clearInterval(purgeTimer);
    clearInterval(peerRefreshTimer);
    if (historyPoller) historyPoller.stop();
    if (inboxConsumer) inboxConsumer.stop();
    if (coordinator) coordinator.stop();
    seenMessages.stop();
    await seenMessages.save().catch(() => {});
    for (const adapter of adapters) {
      try {
        await adapter.stop();
      } catch {
        // best effort
      }
    }
    httpServer.forceClose();
    await unregisterInstance(config.name, port).catch(() => {});
    process.exit(0);
  };
  shutdownFn = shutdown;

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
