import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { ImageAttachment } from './channel.js';
import { type AgentEngine, createEngine, type DiscoveredEngine, discoverEngines, type StreamEvent } from './engine.js';
import {
  appendHistory,
  clearSession,
  getHistoryPath,
  loadSession,
  pruneExpiredSessions,
  saveSession,
} from './session.js';
import {
  ensureReady,
  type GolemConfig,
  initWorkspace,
  loadConfig,
  type ProviderConfig,
  patchConfig,
  type SkillInfo,
  scanSkills,
  writeConfig,
} from './workspace.js';

export type { ChannelAdapter, ChannelMessage, ImageAttachment, ReadReceipt } from './channel.js';
export { buildSessionKey, stripMention } from './channel.js';
export { type CommandContext, type CommandResult, executeCommand, parseCommand } from './commands.js';
export type { ChannelStatus, DashboardContext, GatewayMetrics, RecentMessage } from './dashboard.js';
export type { DiscoveredEngine, StreamEvent } from './engine.js';
export { claudeProviderEnv, codexProviderEnv, cursorProviderEnv, openCodeProviderEnv } from './engine.js';
export type { FleetEntry, FleetInstance, FleetServerOpts } from './fleet.js';
export {
  findInstance,
  findStoppedInstance,
  isProcessAlive,
  listInstances,
  listStoppedInstances,
  registerInstance,
  renderFleetDashboard,
  startFleetServer,
  startInstance,
  stopInstance,
  unregisterInstance,
} from './fleet.js';
export { startGateway } from './gateway.js';
export type { HistoryFetchConfig } from './history-fetcher.js';
export { buildTriagePrompt, startHistoryFetcher, WatermarkStore } from './history-fetcher.js';
export type { InboxConfig, InboxEntry } from './inbox.js';
export { InboxStore } from './inbox.js';
export type { ProactiveCoordinatorOpts } from './proactive.js';
export { createProactiveCoordinator, ProactiveCoordinator } from './proactive.js';
export { createProviderFromPreset, type ProviderPreset, providerPresets } from './provider-presets.js';
export type { CronFields, ScheduledTaskDef, TaskTarget } from './scheduler.js';
export { getNextCronDelay, getNextCronTime, normalizeSchedule, parseCron, Scheduler } from './scheduler.js';
export { createGolemServer, type GolemServer, type ServerOpts, startServer } from './server.js';
export type { TaskExecution, TaskRecord } from './task-store.js';
export { TaskStore } from './task-store.js';
export type {
  ChannelsConfig,
  DingtalkChannelConfig,
  DiscordChannelConfig,
  FeishuChannelConfig,
  GatewayConfig,
  GolemConfig,
  ProviderConfig,
  SkillInfo,
  SlackChannelConfig,
  StreamingConfig,
  TelegramChannelConfig,
  WecomChannelConfig,
} from './workspace.js';
export { patchConfig } from './workspace.js';

// ── Helpers ───────────────────────────────────────────

function mimeToExt(mime: string): string {
  const map: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/bmp': '.bmp',
    'image/svg+xml': '.svg',
  };
  return map[mime] || '.png';
}

// ── Per-key Mutex ──────────────────────────────────────

class KeyedMutex {
  private _locks = new Map<string, { queue: Array<() => void>; locked: boolean }>();

  private _entry(key: string) {
    let e = this._locks.get(key);
    if (!e) {
      e = { queue: [], locked: false };
      this._locks.set(key, e);
    }
    return e;
  }

  acquire(key: string): Promise<void> {
    const e = this._entry(key);
    if (!e.locked) {
      e.locked = true;
      return Promise.resolve();
    }
    return new Promise<void>((r) => e.queue.push(r));
  }

  /**
   * Try to acquire the lock. Returns false immediately if the pending queue
   * already has `maxPending` waiters (not counting the currently running one).
   */
  tryAcquire(key: string, maxPending: number): Promise<boolean> {
    const e = this._entry(key);
    if (!e.locked) {
      e.locked = true;
      return Promise.resolve(true);
    }
    if (e.queue.length >= maxPending) {
      return Promise.resolve(false);
    }
    return new Promise<boolean>((r) => e.queue.push(() => r(true)));
  }

  release(key: string): void {
    const e = this._locks.get(key);
    if (!e) return;
    const next = e.queue.shift();
    if (next) {
      next();
    } else {
      e.locked = false;
      if (e.queue.length === 0) this._locks.delete(key);
    }
  }
}

// ── Assistant ───────────────────────────────────────────

export interface ChatOpts {
  sessionKey?: string;
  /** Images attached to the user message. Saved to disk and referenced in the prompt. */
  images?: ImageAttachment[];
}

export interface Assistant {
  chat(message: string, opts?: ChatOpts): AsyncIterable<StreamEvent>;
  init(opts: { engine: string; name: string }): Promise<void>;
  resetSession(sessionKey?: string): Promise<void>;
  /** Switch engine at runtime (takes effect on next chat call). When clearModel is true, also resets the model override. */
  setEngine(engine: string, clearModel?: boolean): void;
  /** Switch model at runtime (takes effect on next chat call). */
  setModel(model: string): void;
  /** Return current runtime status (engine, model, config, skills). */
  getStatus(): Promise<{ config: GolemConfig; skills: SkillInfo[]; engine: string; model: string | undefined }>;
  /** List available models for the current engine. */
  listModels(): Promise<string[]>;
  /** Discover CLI engines installed on the system. */
  discoverEngines(): Promise<DiscoveredEngine[]>;
  /** Set provider config at runtime (updates in-memory state and writes to golem.yaml). */
  setProvider(provider: ProviderConfig): void;
}

export interface CreateAssistantOpts {
  dir: string;
  engine?: string;
  model?: string;
  apiKey?: string;
  /** Max concurrent Agent invocations (overrides golem.yaml). Default: 10. */
  maxConcurrent?: number;
  /** Max queued requests per session key (overrides golem.yaml). Default: 3. */
  maxQueuePerSession?: number;
  /** Agent invocation timeout in ms (overrides golem.yaml timeout field). Default: 300000. */
  timeoutMs?: number;
}

const DEFAULT_SESSION_KEY = 'default';

export function createAssistant(opts: CreateAssistantOpts): Assistant {
  const dir = resolve(opts.dir);
  const mutex = new KeyedMutex();
  let engineOverride = opts.engine;
  let modelOverride = opts.model;
  const apiKey = opts.apiKey;
  let providerOverride: ProviderConfig | undefined;

  // Concurrency limits — resolved from opts, then config, then hardcoded defaults
  const maxConcurrentOpt = opts.maxConcurrent;
  const maxQueuePerSessionOpt = opts.maxQueuePerSession;
  const timeoutMsOpt = opts.timeoutMs;

  // Global concurrency counter (across all sessions for this assistant instance)
  let activeChatCount = 0;

  // Prune expired sessions once per process lifetime per assistant instance
  let pruneDone = false;

  async function* doChat(
    message: string,
    sessionKey: string,
    isRetry: boolean,
    images?: ImageAttachment[],
  ): AsyncIterable<StreamEvent> {
    const { config, skills } = await ensureReady(dir);

    const engineType = engineOverride || config.engine;
    const provider = providerOverride || config.provider;
    // Model priority: per-engine provider override > modelOverride > provider.model > config.model
    const model = provider?.models?.[engineType] || modelOverride || provider?.model || config.model;
    const engine: AgentEngine = createEngine(engineType);

    const sessionId = await loadSession(dir, sessionKey, engineType);
    const skillPaths = skills.map((s) => s.path);

    // Save attached images to workspace temp dir so the agent can read them
    const imagePaths: string[] = [];
    const imageDir = join(dir, '.golem', 'images');
    if (images && images.length > 0) {
      await mkdir(imageDir, { recursive: true });
      const ts = Date.now();
      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        const ext = mimeToExt(img.mimeType);
        const fileName = img.fileName || `img_${ts}_${i}${ext}`;
        const filePath = join(imageDir, fileName);
        await writeFile(filePath, img.data);
        imagePaths.push(filePath);
      }
    }

    // When starting a fresh session, check if there is a per-session history file
    // from prior conversations. If so, prepend a hint so the agent can read it and
    // restore context (e.g. after engine switch or session expiry).
    let finalMessage = message;
    if (!sessionId) {
      const hPath = getHistoryPath(dir, sessionKey);
      if (existsSync(hPath)) {
        finalMessage =
          `[System: This is a new session but you have prior conversation history with this user. ` +
          `Read ${hPath} to restore context before responding.]\n\n` +
          message;
      }
    }

    // Append image file paths to the message so the agent can read/view them
    if (imagePaths.length > 0) {
      const imageRefs = imagePaths.map((p) => p).join('\n');
      finalMessage += `\n\n[User attached ${imagePaths.length} image(s). File paths:\n${imageRefs}\nPlease read/view these files to see the images.]`;
    }

    // Prune once per process
    if (!pruneDone) {
      pruneDone = true;
      pruneExpiredSessions(dir, config.sessionTtlDays ?? 30).catch(() => {});
    }

    // Timeout via AbortController
    const timeoutMs = timeoutMsOpt ?? (config.timeout ? config.timeout * 1000 : 300_000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    // Write user turn to history
    await appendHistory(dir, {
      ts: new Date().toISOString(),
      sessionKey,
      role: 'user',
      content: message,
    }).catch(() => {});

    let lastSessionId: string | undefined;
    let gotError = false;
    let errorMessage = '';
    let fullReply = '';
    let doneEvt: Extract<StreamEvent, { type: 'done' }> | undefined;

    try {
      for await (const event of engine.invoke(finalMessage, {
        workspace: dir,
        skillPaths,
        sessionId,
        model,
        apiKey: apiKey || provider?.apiKey,
        skipPermissions: config.skipPermissions,
        signal: controller.signal,
        imagePaths: imagePaths.length > 0 ? imagePaths : undefined,
        hasPermissionsConfig: !!config.permissions,
        provider,
      })) {
        if (event.type === 'done') {
          if (event.sessionId) lastSessionId = event.sessionId;
          doneEvt = event;
        }
        if (event.type === 'error') {
          gotError = true;
          errorMessage = event.message;
        }
        if (event.type === 'text') {
          fullReply += event.content;
        }
        yield event;
      }
    } finally {
      clearTimeout(timer);
      // Clean up temp image files
      for (const p of imagePaths) {
        rm(p).catch(() => {});
      }
    }

    // Write assistant turn to history (even partial on timeout)
    await appendHistory(dir, {
      ts: new Date().toISOString(),
      sessionKey,
      role: 'assistant',
      content: fullReply,
      durationMs: doneEvt?.durationMs,
      costUsd: doneEvt?.costUsd,
    }).catch(() => {});

    if (lastSessionId) {
      await saveSession(dir, lastSessionId, sessionKey, engineType);
    }

    if (gotError && sessionId && !isRetry) {
      const isResumeFail =
        errorMessage.toLowerCase().includes('resume') || errorMessage.toLowerCase().includes('session');
      if (isResumeFail) {
        await clearSession(dir, sessionKey);
        yield { type: 'warning' as const, message: 'Session could not be resumed. Starting fresh conversation.' };
        yield* doChat(message, sessionKey, true, images);
      }
    }
  }

  async function* chatImpl(
    message: string,
    sessionKey: string,
    images?: ImageAttachment[],
  ): AsyncIterable<StreamEvent> {
    // Rate limits use opts values directly — no file I/O before acquiring the mutex,
    // so same-key serialization order is preserved (first caller wins the lock).
    const maxConcurrent = maxConcurrentOpt ?? 10;
    const maxQueuePerSession = maxQueuePerSessionOpt ?? 3;

    // Increment first (synchronous), then check — eliminates the race window
    // between the old check-then-await-then-increment pattern.
    activeChatCount++;
    if (activeChatCount > maxConcurrent) {
      activeChatCount--;
      yield {
        type: 'error',
        message: `Server busy: too many concurrent requests (limit: ${maxConcurrent}). Try again later.`,
      };
      return;
    }

    // Per-session queue limit
    const acquired = await mutex.tryAcquire(sessionKey, maxQueuePerSession);
    if (!acquired) {
      activeChatCount--;
      yield {
        type: 'error',
        message: `Too many pending requests for this session (limit: ${maxQueuePerSession}). Try again later.`,
      };
      return;
    }

    try {
      yield* doChat(message, sessionKey, false, images);
    } finally {
      activeChatCount--;
      mutex.release(sessionKey);
    }
  }

  return {
    chat(message: string, chatOpts?: ChatOpts): AsyncIterable<StreamEvent> {
      const key = chatOpts?.sessionKey || DEFAULT_SESSION_KEY;
      return chatImpl(message, key, chatOpts?.images);
    },

    async init(initOpts: { engine: string; name: string }): Promise<void> {
      const builtinSkillsDir = resolve(new URL('.', import.meta.url).pathname, '..', 'skills');
      await initWorkspace(
        dir,
        {
          name: initOpts.name,
          engine: initOpts.engine,
        },
        builtinSkillsDir,
      );
      engineOverride = initOpts.engine;
    },

    async resetSession(sessionKey?: string): Promise<void> {
      await clearSession(dir, sessionKey || DEFAULT_SESSION_KEY);
    },

    setEngine(engine: string, clearModel?: boolean): void {
      engineOverride = engine;
      if (clearModel) {
        modelOverride = undefined;
        patchConfig(dir, { engine, model: undefined }).catch(() => {});
      } else {
        patchConfig(dir, { engine }).catch(() => {});
      }
    },

    setModel(model: string): void {
      modelOverride = model || undefined;
      if (model) {
        patchConfig(dir, { model }).catch(() => {});
      } else {
        patchConfig(dir, { model: undefined }).catch(() => {});
      }
    },

    async getStatus(): Promise<{
      config: GolemConfig;
      skills: SkillInfo[];
      engine: string;
      model: string | undefined;
    }> {
      const config = await loadConfig(dir);
      const skills = await scanSkills(dir);
      return {
        config,
        skills,
        engine: engineOverride || config.engine,
        model: modelOverride || config.model,
      };
    },

    async listModels(): Promise<string[]> {
      const config = await loadConfig(dir);
      const engineType = engineOverride || config.engine;
      const model = modelOverride || config.model;
      const engine = createEngine(engineType);
      if (!engine.listModels) return [];
      return engine.listModels({ apiKey, model });
    },

    async discoverEngines(): Promise<DiscoveredEngine[]> {
      return discoverEngines();
    },

    setProvider(provider: ProviderConfig): void {
      providerOverride = provider;
      // Persist to golem.yaml
      loadConfig(dir)
        .then((config) => {
          config.provider = provider;
          return writeConfig(dir, config);
        })
        .catch(() => {});
    },
  };
}
