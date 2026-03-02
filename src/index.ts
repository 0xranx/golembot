import { resolve } from 'node:path';
import { ensureReady, initWorkspace, type GolemConfig, type SkillInfo } from './workspace.js';
import { loadSession, saveSession, clearSession, pruneExpiredSessions, appendHistory } from './session.js';
import { createEngine, type StreamEvent, type AgentEngine } from './engine.js';

export type { StreamEvent } from './engine.js';
export type { GolemConfig, SkillInfo, ChannelsConfig, GatewayConfig, FeishuChannelConfig, DingtalkChannelConfig, WecomChannelConfig } from './workspace.js';
export { createGolemServer, startServer, type ServerOpts, type GolemServer } from './server.js';
export type { ChannelAdapter, ChannelMessage } from './channel.js';
export { buildSessionKey, stripMention } from './channel.js';
export { startGateway } from './gateway.js';

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
    return new Promise<void>(r => e.queue.push(r));
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
    return new Promise<boolean>(r => e.queue.push(() => r(true)));
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
}

export interface Assistant {
  chat(message: string, opts?: ChatOpts): AsyncIterable<StreamEvent>;
  init(opts: { engine: string; name: string }): Promise<void>;
  resetSession(sessionKey?: string): Promise<void>;
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
  ): AsyncIterable<StreamEvent> {
    const { config, skills } = await ensureReady(dir);

    const engineType = engineOverride || config.engine;
    const model = modelOverride || config.model;
    const engine: AgentEngine = createEngine(engineType);

    const sessionId = await loadSession(dir, sessionKey);
    const skillPaths = skills.map(s => s.path);

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
      for await (const event of engine.invoke(message, {
        workspace: dir,
        skillPaths,
        sessionId,
        model,
        apiKey,
        skipPermissions: config.skipPermissions,
        signal: controller.signal,
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
      await saveSession(dir, lastSessionId, sessionKey);
    }

    if (gotError && sessionId && !isRetry) {
      const isResumeFail =
        errorMessage.toLowerCase().includes('resume') ||
        errorMessage.toLowerCase().includes('session');
      if (isResumeFail) {
        await clearSession(dir, sessionKey);
        yield { type: 'warning' as const, message: 'Session could not be resumed. Starting fresh conversation.' };
        yield* doChat(message, sessionKey, true);
      }
    }
  }

  async function* chatImpl(message: string, sessionKey: string): AsyncIterable<StreamEvent> {
    // Rate limits use opts values directly — no file I/O before acquiring the mutex,
    // so same-key serialization order is preserved (first caller wins the lock).
    const maxConcurrent = maxConcurrentOpt ?? 10;
    const maxQueuePerSession = maxQueuePerSessionOpt ?? 3;

    // Global concurrency check (soft — sufficient to prevent overload)
    if (activeChatCount >= maxConcurrent) {
      yield { type: 'error', message: `Server busy: too many concurrent requests (limit: ${maxConcurrent}). Try again later.` };
      return;
    }

    // Per-session queue limit — synchronous path taken before any await
    const acquired = await mutex.tryAcquire(sessionKey, maxQueuePerSession);
    if (!acquired) {
      yield { type: 'error', message: `Too many pending requests for this session (limit: ${maxQueuePerSession}). Try again later.` };
      return;
    }

    activeChatCount++;
    try {
      yield* doChat(message, sessionKey, false);
    } finally {
      activeChatCount--;
      mutex.release(sessionKey);
    }
  }

  return {
    chat(message: string, chatOpts?: ChatOpts): AsyncIterable<StreamEvent> {
      const key = chatOpts?.sessionKey || DEFAULT_SESSION_KEY;
      return chatImpl(message, key);
    },

    async init(initOpts: { engine: string; name: string }): Promise<void> {
      const builtinSkillsDir = resolve(
        new URL('.', import.meta.url).pathname,
        '..',
        'skills',
      );
      await initWorkspace(dir, {
        name: initOpts.name,
        engine: initOpts.engine,
      }, builtinSkillsDir);
      engineOverride = initOpts.engine;
    },

    async resetSession(sessionKey?: string): Promise<void> {
      await clearSession(dir, sessionKey || DEFAULT_SESSION_KEY);
    },
  };
}
