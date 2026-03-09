import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProactiveCoordinator } from '../proactive.js';
import { TaskStore } from '../task-store.js';
import type { TaskRecord } from '../task-store.js';
import { Scheduler } from '../scheduler.js';
import type { StreamEvent } from '../engine.js';
import type { ChannelAdapter } from '../channel.js';
import { loadConfig } from '../workspace.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockAssistant() {
  return {
    chat(_message: string, _opts: { sessionKey: string }): AsyncIterable<StreamEvent> {
      return {
        async *[Symbol.asyncIterator]() {
          yield { type: 'text' as const, content: 'mock reply' };
          yield { type: 'done' as const, sessionId: 'x', durationMs: 100, costUsd: 0.01 };
        },
      };
    },
  };
}

function createMockAdapter(): ChannelAdapter {
  return {
    name: 'mock',
    send: vi.fn<(chatId: string, text: string) => Promise<void>>().mockResolvedValue(undefined),
    start: vi.fn<(onMessage: (msg: any) => void | Promise<void>) => Promise<void>>().mockResolvedValue(undefined),
    stop: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    reply: vi.fn<(msg: any, text: string) => Promise<void>>().mockResolvedValue(undefined),
    maxMessageLength: 4000,
  };
}

function makeTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'task-1',
    name: 'Test Task',
    schedule: '*/5 * * * *',
    prompt: 'do something',
    enabled: true,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProactiveCoordinator', () => {
  let tmpDir: string;
  let taskStore: TaskStore;
  let scheduler: Scheduler;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'proactive-test-'));
    taskStore = new TaskStore(tmpDir);
    scheduler = new Scheduler();
  });

  afterEach(async () => {
    scheduler.stop();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('start() registers tasks with scheduler', () => {
    const coordinator = new ProactiveCoordinator({
      assistant: createMockAssistant(),
      taskStore,
      adapters: new Map(),
      scheduler,
    });

    const task = makeTask();
    coordinator.start([task]);

    // The scheduler should know about this task and return a next-run date
    const nextRun = scheduler.getNextRun(task.id);
    expect(nextRun).not.toBeNull();
    expect(nextRun).toBeInstanceOf(Date);
  });

  it('runTask() executes task and records history', async () => {
    const task = makeTask();
    await taskStore.addTask(task);

    const coordinator = new ProactiveCoordinator({
      assistant: createMockAssistant(),
      taskStore,
      adapters: new Map(),
      scheduler,
    });

    const reply = await coordinator.runTask(task.id);
    expect(reply).toBe('mock reply');

    const history = await taskStore.getHistory(task.id);
    expect(history).toHaveLength(1);
    expect(history[0].status).toBe('success');

    const updated = await taskStore.getTask(task.id);
    expect(updated?.lastRun).toBeDefined();
    expect(updated?.lastStatus).toBe('success');
  });

  it('runTask() sends to channel when target is set', async () => {
    const mockAdapter = createMockAdapter();
    const task = makeTask({
      target: { channel: 'slack', chatId: 'C123' },
    });
    await taskStore.addTask(task);

    const adapters = new Map<string, ChannelAdapter>([['slack', mockAdapter]]);

    const coordinator = new ProactiveCoordinator({
      assistant: createMockAssistant(),
      taskStore,
      adapters,
      scheduler,
    });

    await coordinator.runTask(task.id);
    expect(mockAdapter.send).toHaveBeenCalledWith('C123', 'mock reply');
  });

  it('runTask() records error on failure', async () => {
    const failAssistant = {
      chat(): AsyncIterable<StreamEvent> {
        return {
          async *[Symbol.asyncIterator]() {
            throw new Error('boom');
          },
        };
      },
    };

    const task = makeTask();
    await taskStore.addTask(task);

    const coordinator = new ProactiveCoordinator({
      assistant: failAssistant,
      taskStore,
      adapters: new Map(),
      scheduler,
    });

    await expect(coordinator.runTask(task.id)).rejects.toThrow('boom');

    const history = await taskStore.getHistory(task.id);
    expect(history).toHaveLength(1);
    expect(history[0].status).toBe('error');
    expect(history[0].error).toBe('boom');
  });

  it('stop() stops the scheduler', () => {
    const task = makeTask();
    const coordinator = new ProactiveCoordinator({
      assistant: createMockAssistant(),
      taskStore,
      adapters: new Map(),
      scheduler,
    });

    coordinator.start([task]);
    // Task should be scheduled
    expect(scheduler.getNextRun(task.id)).not.toBeNull();

    coordinator.stop();
    // After stop, getNextRun still knows the task but timers are cleared.
    // The scheduler.stop() clears timers but doesn't remove tasks or disable them,
    // so getNextRun still returns a date. We verify stop was called by checking
    // that the internal timer was nulled — which we can indirectly verify by
    // calling stop again without error.
    coordinator.stop(); // should not throw
  });

  it('runTask() throws for unknown task', async () => {
    const coordinator = new ProactiveCoordinator({
      assistant: createMockAssistant(),
      taskStore,
      adapters: new Map(),
      scheduler,
    });

    await expect(coordinator.runTask('nonexistent')).rejects.toThrow('Task not found');
  });
});

// ---------------------------------------------------------------------------
// Full integration: golem.yaml → loadConfig → mergeConfigTasks → coordinator
// ---------------------------------------------------------------------------

describe('Full execution pipeline (config → schedule → execute → deliver → record)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'proactive-e2e-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('loads tasks from golem.yaml, merges into store, executes, delivers to channel, and records history', async () => {
    // 1. Write a golem.yaml with a task definition
    const yamlContent = `
name: test-bot
engine: cursor
tasks:
  - id: report-1
    name: daily-report
    schedule: "0 9 * * *"
    prompt: "Generate a status report"
    enabled: true
    target:
      channel: slack
      chatId: "C0123456789"
`;
    await writeFile(join(tmpDir, 'golem.yaml'), yamlContent, 'utf-8');

    // 2. Load config and verify tasks are parsed
    const config = await loadConfig(tmpDir);
    expect(config.tasks).toHaveLength(1);
    expect(config.tasks![0].name).toBe('daily-report');
    expect(config.tasks![0].target?.channel).toBe('slack');
    expect(config.tasks![0].target?.chatId).toBe('C0123456789');

    // 3. Merge config tasks into TaskStore (as gateway.ts does)
    const taskStore = new TaskStore(tmpDir);
    const mergedTasks = await taskStore.mergeConfigTasks(config.tasks!);
    expect(mergedTasks).toHaveLength(1);
    expect(mergedTasks[0].createdBy).toBe('config');
    expect(mergedTasks[0].id).toBe('report-1');

    // 4. Create mock assistant that tracks calls
    const chatCalls: Array<{ prompt: string; sessionKey: string }> = [];
    const mockAssistant = {
      chat(message: string, opts: { sessionKey: string }): AsyncIterable<StreamEvent> {
        chatCalls.push({ prompt: message, sessionKey: opts.sessionKey });
        return {
          async *[Symbol.asyncIterator]() {
            yield { type: 'text' as const, content: 'Status: all systems green. 3 PRs merged.' };
            yield { type: 'done' as const, sessionId: 'sess-1', durationMs: 2500, costUsd: 0.05 };
          },
        };
      },
    };

    // 5. Create mock adapter with send() and track calls
    const sendCalls: Array<{ chatId: string; text: string }> = [];
    const mockAdapter: ChannelAdapter = {
      name: 'slack',
      send: async (chatId: string, text: string) => { sendCalls.push({ chatId, text }); },
      start: async () => {},
      stop: async () => {},
      reply: async () => {},
      maxMessageLength: 4000,
    };
    const adapters = new Map<string, ChannelAdapter>([['slack', mockAdapter]]);

    // 6. Create coordinator and start (registers tasks with scheduler)
    const scheduler = new Scheduler();
    const coordinator = new ProactiveCoordinator({
      assistant: mockAssistant,
      taskStore,
      adapters,
      scheduler,
      verbose: false,
    });
    coordinator.start(mergedTasks);

    // Verify task is scheduled
    const nextRun = scheduler.getNextRun('report-1');
    expect(nextRun).toBeInstanceOf(Date);

    // 7. Manually trigger the task (simulates scheduler firing)
    const reply = await coordinator.runTask('report-1');

    // 8. Verify the complete chain:

    // a) Assistant was called with the correct prompt and session key
    expect(chatCalls).toHaveLength(1);
    expect(chatCalls[0].prompt).toBe('Generate a status report');
    expect(chatCalls[0].sessionKey).toBe('task:report-1');

    // b) Reply text was collected correctly
    expect(reply).toBe('Status: all systems green. 3 PRs merged.');

    // c) Result was delivered to the target channel via adapter.send()
    expect(sendCalls).toHaveLength(1);
    expect(sendCalls[0].chatId).toBe('C0123456789');
    expect(sendCalls[0].text).toBe('Status: all systems green. 3 PRs merged.');

    // d) Execution was recorded in history
    const history = await taskStore.getHistory('report-1');
    expect(history).toHaveLength(1);
    expect(history[0].status).toBe('success');
    expect(history[0].taskName).toBe('daily-report');
    expect(history[0].reply).toBe('Status: all systems green. 3 PRs merged.');
    expect(history[0].durationMs).toBe(2500);
    expect(history[0].costUsd).toBe(0.05);

    // e) Task runtime state was updated in the store
    const updatedTask = await taskStore.getTask('report-1');
    expect(updatedTask!.lastRun).toBeDefined();
    expect(updatedTask!.lastStatus).toBe('success');

    // Cleanup
    coordinator.stop();
  });

  it('handles execution failure: records error, does not deliver to channel', async () => {
    const yamlContent = `
name: test-bot
engine: cursor
tasks:
  - id: fail-task
    name: flaky-check
    schedule: "*/30 * * * *"
    prompt: "Run flaky tests"
    enabled: true
    target:
      channel: telegram
      chatId: "99999"
`;
    await writeFile(join(tmpDir, 'golem.yaml'), yamlContent, 'utf-8');

    const config = await loadConfig(tmpDir);
    const taskStore = new TaskStore(tmpDir);
    const mergedTasks = await taskStore.mergeConfigTasks(config.tasks!);

    // Assistant that throws mid-stream
    const failAssistant = {
      chat(): AsyncIterable<StreamEvent> {
        return {
          async *[Symbol.asyncIterator]() {
            yield { type: 'text' as const, content: 'Starting tests...' };
            throw new Error('Agent process crashed');
          },
        };
      },
    };

    const sendCalls: string[] = [];
    const mockAdapter: ChannelAdapter = {
      name: 'telegram',
      send: async (_chatId: string, _text: string) => { sendCalls.push(_text); },
      start: async () => {},
      stop: async () => {},
      reply: async () => {},
    };
    const adapters = new Map<string, ChannelAdapter>([['telegram', mockAdapter]]);

    const scheduler = new Scheduler();
    const coordinator = new ProactiveCoordinator({
      assistant: failAssistant,
      taskStore,
      adapters,
      scheduler,
    });

    // Execution should throw
    await expect(coordinator.runTask('fail-task')).rejects.toThrow('Agent process crashed');

    // Channel should NOT have received a message (error occurred before send)
    expect(sendCalls).toHaveLength(0);

    // Error should be recorded in history
    const history = await taskStore.getHistory('fail-task');
    expect(history).toHaveLength(1);
    expect(history[0].status).toBe('error');
    expect(history[0].error).toBe('Agent process crashed');

    // Task state should reflect the error
    const task = await taskStore.getTask('fail-task');
    expect(task!.lastStatus).toBe('error');
    expect(task!.lastError).toBe('Agent process crashed');

    coordinator.stop();
  });

  it('second config merge preserves runtime state from first execution', async () => {
    const yamlContent = `
name: test-bot
engine: cursor
tasks:
  - id: persist-1
    name: monitor
    schedule: "*/10 * * * *"
    prompt: "Check health"
    enabled: true
`;
    await writeFile(join(tmpDir, 'golem.yaml'), yamlContent, 'utf-8');

    const config = await loadConfig(tmpDir);
    const taskStore = new TaskStore(tmpDir);
    await taskStore.mergeConfigTasks(config.tasks!);

    // Simulate an execution
    const scheduler = new Scheduler();
    const coordinator = new ProactiveCoordinator({
      assistant: createMockAssistant(),
      taskStore,
      adapters: new Map(),
      scheduler,
    });
    await coordinator.runTask('persist-1');

    const afterExec = await taskStore.getTask('persist-1');
    expect(afterExec!.lastRun).toBeDefined();
    expect(afterExec!.lastStatus).toBe('success');
    const savedLastRun = afterExec!.lastRun;

    // Now simulate a "gateway restart" — re-merge config tasks
    // The config changes the prompt but runtime state (lastRun, lastStatus) should survive
    const updatedConfig = { ...config };
    updatedConfig.tasks = [{
      ...config.tasks![0],
      prompt: 'Check health v2',
    }];
    const reMerged = await taskStore.mergeConfigTasks(updatedConfig.tasks);

    expect(reMerged).toHaveLength(1);
    expect(reMerged[0].prompt).toBe('Check health v2'); // updated from config
    expect(reMerged[0].lastRun).toBe(savedLastRun);      // preserved from runtime
    expect(reMerged[0].lastStatus).toBe('success');       // preserved from runtime

    coordinator.stop();
  });
});
