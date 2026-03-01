import { resolve } from 'node:path';
import { ensureReady, initWorkspace, type GolemConfig, type SkillInfo } from './workspace.js';
import { loadSession, saveSession, clearSession } from './session.js';
import { createEngine, type StreamEvent, type AgentEngine } from './engine.js';

export type { StreamEvent } from './engine.js';
export type { GolemConfig, SkillInfo, ChannelsConfig, GatewayConfig, FeishuChannelConfig, DingtalkChannelConfig, WecomChannelConfig } from './workspace.js';
export { createGolemServer, startServer, type ServerOpts } from './server.js';
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
}

const DEFAULT_SESSION_KEY = 'default';

export function createAssistant(opts: CreateAssistantOpts): Assistant {
  const dir = resolve(opts.dir);
  const mutex = new KeyedMutex();
  let engineOverride = opts.engine;
  let modelOverride = opts.model;
  const apiKey = opts.apiKey;

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

    let lastSessionId: string | undefined;
    let gotError = false;
    let errorMessage = '';

    for await (const event of engine.invoke(message, {
      workspace: dir,
      skillPaths,
      sessionId,
      model,
      apiKey,
      skipPermissions: config.skipPermissions,
    })) {
      if (event.type === 'done' && event.sessionId) {
        lastSessionId = event.sessionId;
      }
      if (event.type === 'error') {
        gotError = true;
        errorMessage = event.message;
      }
      yield event;
    }

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
    await mutex.acquire(sessionKey);
    try {
      yield* doChat(message, sessionKey, false);
    } finally {
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
