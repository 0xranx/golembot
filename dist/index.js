import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { assessCodexProviderCompatibility, codexProviderWarningFingerprint } from './codex-provider-compat.js';
import { debugEventLog, isDebugEventsEnabled, summarizeStreamEvent } from './debug-events.js';
import { createEngine, discoverEngines } from './engine.js';
import { compressImages } from './image-compress.js';
import { appendHistory, clearSession, getHistoryPath, loadSession, pruneExpiredSessions, resetConversation, saveSession, } from './session.js';
import { daysUntilExpiry, ensureTokenMeta } from './token-meta.js';
import { DEFAULT_TIMEOUT_SECONDS, ensureReady, initWorkspace, loadConfig, patchConfig, scanSkills, writeConfig, } from './workspace.js';
export { buildSessionKey, stripMention } from './channel.js';
export { executeCommand, parseCommand } from './commands.js';
export { claudeProviderEnv, codexProviderEnv, cursorProviderEnv, grokProviderEnv, openCodeProviderEnv, } from './engine.js';
export { findInstance, findStoppedInstance, isProcessAlive, listInstances, listStoppedInstances, registerInstance, renderFleetDashboard, startFleetServer, startInstance, stopInstance, unregisterInstance, } from './fleet.js';
export { startGateway } from './gateway.js';
export { buildTriagePrompt, startHistoryFetcher, WatermarkStore } from './history-fetcher.js';
export { InboxStore } from './inbox.js';
export { createProactiveCoordinator, ProactiveCoordinator } from './proactive.js';
export { createProviderFromPreset, providerPresets } from './provider-presets.js';
export { getNextCronDelay, getNextCronTime, normalizeSchedule, parseCron, Scheduler } from './scheduler.js';
export { createGolemServer, startServer } from './server.js';
export { TaskStore } from './task-store.js';
export { patchConfig } from './workspace.js';
// ── Helpers ───────────────────────────────────────────
function mimeToExt(mime) {
    const map = {
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
    _locks = new Map();
    _entry(key) {
        let e = this._locks.get(key);
        if (!e) {
            e = { queue: [], locked: false };
            this._locks.set(key, e);
        }
        return e;
    }
    acquire(key) {
        const e = this._entry(key);
        if (!e.locked) {
            e.locked = true;
            return Promise.resolve();
        }
        return new Promise((r) => e.queue.push(r));
    }
    /**
     * Try to acquire the lock. Returns false immediately if the pending queue
     * already has `maxPending` waiters (not counting the currently running one).
     */
    tryAcquire(key, maxPending) {
        const e = this._entry(key);
        if (!e.locked) {
            e.locked = true;
            return Promise.resolve(true);
        }
        if (e.queue.length >= maxPending) {
            return Promise.resolve(false);
        }
        return new Promise((r) => e.queue.push(() => r(true)));
    }
    release(key) {
        const e = this._locks.get(key);
        if (!e)
            return;
        const next = e.queue.shift();
        if (next) {
            next();
        }
        else {
            e.locked = false;
            if (e.queue.length === 0)
                this._locks.delete(key);
        }
    }
}
const DEFAULT_SESSION_KEY = 'default';
function classifySilentReply(text) {
    const trimmed = text.trim();
    if (trimmed === '[PASS]')
        return 'pass';
    if (trimmed === '[SKIP]')
        return 'skip';
    return null;
}
function buildCompletionEvent(params) {
    const { fullReply, doneEvt, gotError, errorMessage, signal, sessionId } = params;
    const shared = {
        sessionId: sessionId || doneEvt?.sessionId,
        durationMs: doneEvt?.durationMs,
        costUsd: doneEvt?.costUsd,
        numTurns: doneEvt?.numTurns,
    };
    const silentReason = classifySilentReply(fullReply);
    if (silentReason) {
        return {
            type: 'completion',
            status: 'silent',
            reason: silentReason,
            ...shared,
        };
    }
    if (signal.aborted) {
        return {
            type: 'completion',
            status: 'aborted',
            reason: signal.reason === 'user' ? 'user' : 'timeout',
            partialText: fullReply.trim() ? fullReply : undefined,
            ...shared,
        };
    }
    if (gotError) {
        return {
            type: 'completion',
            status: 'failed',
            message: errorMessage || 'Agent error',
            partialText: fullReply.trim() ? fullReply : undefined,
            ...shared,
        };
    }
    if (fullReply.trim()) {
        return {
            type: 'completion',
            status: 'completed',
            finalText: fullReply,
            ...shared,
        };
    }
    return {
        type: 'completion',
        status: 'failed',
        message: 'Agent completed without a final reply',
        ...shared,
    };
}
export function createAssistant(opts) {
    const dir = resolve(opts.dir);
    const mutex = new KeyedMutex();
    let engineOverride = opts.engine;
    let modelOverride = opts.model;
    const apiKey = opts.apiKey;
    let providerOverride;
    // Concurrency limits — resolved from opts, then config, then hardcoded defaults
    const maxConcurrentOpt = opts.maxConcurrent;
    const maxQueuePerSessionOpt = opts.maxQueuePerSession;
    const timeoutMsOpt = opts.timeoutMs;
    // Global concurrency counter (across all sessions for this assistant instance)
    let activeChatCount = 0;
    const activeRuns = new Map();
    // Prune expired sessions once per process lifetime per assistant instance
    let pruneDone = false;
    // Circuit breaker: track consecutive primary-provider failures in memory.
    // Once primaryFailureCount reaches the threshold, all subsequent calls use
    // provider.fallback. A recovery timer periodically resets the circuit so the
    // primary is retried — if it succeeds the circuit closes; if it fails again
    // the fallback is reactivated.
    let primaryFailureCount = 0;
    let usingFallback = false;
    let recoveryTimer = null;
    // OAuth token expiry warning: emit at most once per hour
    let lastExpiryWarningAt = 0;
    const codexProviderWarnings = new Set();
    function canEmitExpiryWarning() {
        return Date.now() - lastExpiryWarningAt > 3_600_000;
    }
    async function* doChat(message, sessionKey, isRetry, controller, images, files) {
        const debugEventsEnabled = isDebugEventsEnabled();
        const { config, skills } = await ensureReady(dir);
        const engineType = engineOverride || config.engine;
        const baseProvider = providerOverride || config.provider;
        // Circuit breaker: route to fallback when the primary has failed too many times
        const provider = usingFallback && baseProvider?.fallback ? baseProvider.fallback : baseProvider;
        // Model priority: per-engine provider override > modelOverride > provider.model > config.model
        const model = provider?.models?.[engineType] || modelOverride || provider?.model || config.model;
        const engine = createEngine(engineType);
        // OAuth token expiry warning (rate-limited: once per hour)
        if (config.oauthToken && canEmitExpiryWarning()) {
            const meta = await ensureTokenMeta(join(dir, '.golem'), config.oauthToken);
            const daysLeft = daysUntilExpiry(meta);
            if (daysLeft <= 30) {
                lastExpiryWarningAt = Date.now();
                yield {
                    type: 'warning',
                    message: `Claude Max OAuth token expires in ~${daysLeft} days. Run \`claude setup-token\` to renew.`,
                };
            }
        }
        if (engineType === 'codex' && provider) {
            const fingerprint = codexProviderWarningFingerprint(provider);
            const compatibility = assessCodexProviderCompatibility(provider);
            if (fingerprint && compatibility && !codexProviderWarnings.has(fingerprint)) {
                codexProviderWarnings.add(fingerprint);
                yield {
                    type: 'warning',
                    message: `${compatibility.warning} See Provider Routing docs before using a custom provider with Codex.`,
                };
            }
        }
        const sessionId = await loadSession(dir, sessionKey, engineType);
        const skillPaths = skills.map((s) => s.path);
        // Compress large images so they fit within engine tool limits (e.g. Claude
        // Code's Read tool has a ~15000 token cap).  Small images pass through unchanged.
        const compressedImages = images && images.length > 0 ? await compressImages(images) : undefined;
        // Save attached images to workspace temp dir so the agent can read them
        const imagePaths = [];
        const imageDir = join(dir, '.golem', 'images');
        if (compressedImages && compressedImages.length > 0) {
            await mkdir(imageDir, { recursive: true });
            const ts = Date.now();
            for (let i = 0; i < compressedImages.length; i++) {
                const img = compressedImages[i];
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
                yield {
                    type: 'warning',
                    message: `Restoring prior conversation history for this session. Use \`/reset\` to start fresh.`,
                };
                finalMessage =
                    `[System: This is a new session but you have prior conversation history with this user. ` +
                        `Read ${hPath} to restore context before responding.]\n\n` +
                        message;
            }
        }
        // Save attached files to workspace temp dir so the agent can read them
        const filePaths = [];
        const fileDir = join(dir, '.golem', 'files');
        if (files && files.length > 0) {
            await mkdir(fileDir, { recursive: true });
            for (const file of files) {
                const filePath = join(fileDir, file.fileName);
                await writeFile(filePath, file.data);
                filePaths.push(filePath);
            }
        }
        // Append image file paths to the message so the agent can read/view them
        if (imagePaths.length > 0) {
            const imageRefs = imagePaths.map((p) => p).join('\n');
            finalMessage += `\n\n[User attached ${imagePaths.length} image(s). File paths:\n${imageRefs}\nPlease read/view these files to see the images.]`;
        }
        // Append file paths to the message so the agent can read them
        if (filePaths.length > 0) {
            const fileRefs = filePaths.map((p) => p).join('\n');
            finalMessage += `\n\n[User attached ${filePaths.length} file(s). File paths:\n${fileRefs}\nPlease read these files to see the content.]`;
        }
        // Prune once per process
        if (!pruneDone) {
            pruneDone = true;
            pruneExpiredSessions(dir, config.sessionTtlDays ?? 30).catch(() => { });
        }
        // Timeout via AbortController
        const timeoutMs = timeoutMsOpt ?? (config.timeout ? config.timeout * 1000 : DEFAULT_TIMEOUT_SECONDS * 1000);
        const timer = setTimeout(() => controller.abort('timeout'), timeoutMs);
        // Write user turn to history
        await appendHistory(dir, {
            ts: new Date().toISOString(),
            sessionKey,
            role: 'user',
            content: message,
        }).catch(() => { });
        let lastSessionId;
        let gotError = false;
        let errorMessage = '';
        let fullReply = '';
        let doneEvt;
        try {
            debugEventLog(debugEventsEnabled, `[event-debug] invoke engine=${engineType} resume=${!!sessionId} images=${imagePaths.length} files=${filePaths.length} provider=${!!provider} mcp=${config.mcp ? Object.keys(config.mcp).length : 0} model=${model ?? '(default)'}`);
            for await (const event of engine.invoke(finalMessage, {
                workspace: dir,
                skillPaths,
                sessionId,
                model,
                apiKey: apiKey || provider?.apiKey,
                skipPermissions: config.skipPermissions,
                codex: config.codex,
                signal: controller.signal,
                imagePaths: imagePaths.length > 0 ? imagePaths : undefined,
                hasPermissionsConfig: !!config.permissions,
                provider,
                oauthToken: config.oauthToken,
                mcpConfig: config.mcp,
            })) {
                debugEventLog(debugEventsEnabled, `[event-debug] assistant ${summarizeStreamEvent(event)}`);
                if (event.type === 'done') {
                    if (event.sessionId)
                        lastSessionId = event.sessionId;
                    if (!fullReply.trim() && event.fullText) {
                        fullReply = event.fullText;
                    }
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
        }
        finally {
            clearTimeout(timer);
            // Clean up temp image and file attachments
            for (const p of [...imagePaths, ...filePaths]) {
                rm(p).catch(() => { });
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
        }).catch(() => { });
        if (lastSessionId) {
            await saveSession(dir, lastSessionId, sessionKey, engineType);
        }
        // Update circuit breaker state for the primary provider.
        // Only track when a fallback is configured and we are still using the primary.
        if (baseProvider?.fallback && !usingFallback) {
            if (gotError) {
                primaryFailureCount++;
                const threshold = baseProvider.failoverThreshold ?? 3;
                if (primaryFailureCount >= threshold) {
                    usingFallback = true;
                    const recoveryMs = baseProvider.fallbackRecoveryMs ?? 60_000;
                    const recoveryNote = recoveryMs > 0 ? ` Will retry primary in ${Math.round(recoveryMs / 1000)}s.` : '';
                    yield {
                        type: 'warning',
                        message: `Primary provider failed ${primaryFailureCount} time${primaryFailureCount === 1 ? '' : 's'} in a row. Switching to fallback provider.${recoveryNote}`,
                    };
                    // Schedule automatic recovery: after the cooldown, tentatively
                    // reset to the primary. The next chat call will test it; if it
                    // fails again the fallback will be reactivated.
                    if (recoveryMs > 0) {
                        if (recoveryTimer)
                            clearTimeout(recoveryTimer);
                        recoveryTimer = setTimeout(() => {
                            usingFallback = false;
                            primaryFailureCount = 0;
                            recoveryTimer = null;
                        }, recoveryMs);
                    }
                }
            }
            else {
                primaryFailureCount = 0;
                // Primary recovered — cancel any pending recovery timer (already back on primary)
                if (recoveryTimer) {
                    clearTimeout(recoveryTimer);
                    recoveryTimer = null;
                }
            }
        }
        if (gotError && sessionId && !isRetry) {
            const isResumeFail = errorMessage.toLowerCase().includes('resume') || errorMessage.toLowerCase().includes('session');
            if (isResumeFail) {
                await clearSession(dir, sessionKey);
                yield { type: 'warning', message: 'Session could not be resumed. Starting fresh conversation.' };
                yield* doChat(message, sessionKey, true, controller, images, files);
                return;
            }
        }
        // Detect OAuth token authentication failures
        if (gotError && config.oauthToken) {
            const lower = errorMessage.toLowerCase();
            const isAuthError = ['401', 'unauthorized', 'authentication', 'token expired', 'invalid token'].some((kw) => lower.includes(kw));
            if (isAuthError) {
                yield {
                    type: 'warning',
                    message: 'Authentication failed — your Claude Max OAuth token may have expired. Run `claude setup-token` to generate a new one.',
                };
            }
        }
        yield buildCompletionEvent({
            fullReply,
            doneEvt,
            gotError,
            errorMessage,
            signal: controller.signal,
            sessionId: lastSessionId,
        });
    }
    async function* chatImpl(message, sessionKey, images, files) {
        // Rate limits use opts values directly — no file I/O before acquiring the mutex,
        // so same-key serialization order is preserved (first caller wins the lock).
        const maxConcurrent = maxConcurrentOpt ?? 10;
        const maxQueuePerSession = maxQueuePerSessionOpt ?? 3;
        // Increment first (synchronous), then check — eliminates the race window
        // between the old check-then-await-then-increment pattern.
        activeChatCount++;
        if (activeChatCount > maxConcurrent) {
            activeChatCount--;
            const message = `Server busy: too many concurrent requests (limit: ${maxConcurrent}). Try again later.`;
            yield { type: 'error', message };
            yield { type: 'completion', status: 'failed', message };
            return;
        }
        // Per-session queue limit
        const acquired = await mutex.tryAcquire(sessionKey, maxQueuePerSession);
        if (!acquired) {
            activeChatCount--;
            const message = `Too many pending requests for this session (limit: ${maxQueuePerSession}). Try again later.`;
            yield { type: 'error', message };
            yield { type: 'completion', status: 'failed', message };
            return;
        }
        try {
            const controller = new AbortController();
            activeRuns.set(sessionKey, { controller });
            try {
                yield* doChat(message, sessionKey, false, controller, images, files);
            }
            catch (e) {
                const message = e instanceof Error ? e.message : String(e);
                yield { type: 'error', message };
                yield { type: 'completion', status: 'failed', message };
            }
            finally {
                const active = activeRuns.get(sessionKey);
                if (active?.controller === controller)
                    activeRuns.delete(sessionKey);
            }
        }
        finally {
            activeChatCount--;
            mutex.release(sessionKey);
        }
    }
    return {
        chat(message, chatOpts) {
            const key = chatOpts?.sessionKey || DEFAULT_SESSION_KEY;
            return chatImpl(message, key, chatOpts?.images, chatOpts?.files);
        },
        async init(initOpts) {
            const builtinSkillsDir = resolve(new URL('.', import.meta.url).pathname, '..', 'skills');
            const config = {
                name: initOpts.name,
                engine: initOpts.engine,
            };
            if (initOpts.role) {
                config.persona = { role: initOpts.role };
            }
            await initWorkspace(dir, config, builtinSkillsDir);
            engineOverride = initOpts.engine;
        },
        async cancel(sessionKey) {
            const key = sessionKey || DEFAULT_SESSION_KEY;
            const active = activeRuns.get(key);
            if (!active || active.controller.signal.aborted)
                return false;
            active.reason = 'user';
            active.controller.abort('user');
            return true;
        },
        async resetSession(sessionKey) {
            await resetConversation(dir, sessionKey || DEFAULT_SESSION_KEY);
        },
        setEngine(engine, clearModel) {
            engineOverride = engine;
            if (clearModel) {
                modelOverride = undefined;
                patchConfig(dir, { engine, model: undefined }).catch(() => { });
            }
            else {
                patchConfig(dir, { engine }).catch(() => { });
            }
        },
        setModel(model) {
            modelOverride = model || undefined;
            if (model) {
                patchConfig(dir, { model }).catch(() => { });
            }
            else {
                patchConfig(dir, { model: undefined }).catch(() => { });
            }
        },
        async getStatus() {
            const config = await loadConfig(dir);
            const skills = await scanSkills(dir);
            return {
                config,
                skills,
                engine: engineOverride || config.engine,
                model: modelOverride || config.model,
            };
        },
        async listModels() {
            const config = await loadConfig(dir);
            const engineType = engineOverride || config.engine;
            const model = modelOverride || config.model;
            const engine = createEngine(engineType);
            if (!engine.listModels)
                return [];
            return engine.listModels({ apiKey, model });
        },
        async discoverEngines() {
            return discoverEngines();
        },
        setProvider(provider) {
            providerOverride = provider;
            // Persist to golem.yaml
            loadConfig(dir)
                .then((config) => {
                config.provider = provider;
                return writeConfig(dir, config);
            })
                .catch(() => { });
        },
    };
}
//# sourceMappingURL=index.js.map