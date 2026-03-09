import { describe, it, expect, vi } from 'vitest';
import { parseCommand, executeCommand, type CommandContext } from '../commands.js';
import type { TaskStore } from '../task-store.js';
import type { Scheduler } from '../scheduler.js';

// ── parseCommand ─────────────────────────────────────────

describe('parseCommand', () => {
  it('returns null for non-command text', () => {
    expect(parseCommand('hello world')).toBeNull();
    expect(parseCommand('  just a message  ')).toBeNull();
    expect(parseCommand('')).toBeNull();
  });

  it('parses simple command', () => {
    expect(parseCommand('/help')).toEqual({ name: '/help', args: [] });
  });

  it('parses command with args', () => {
    expect(parseCommand('/engine claude-code')).toEqual({ name: '/engine', args: ['claude-code'] });
  });

  it('parses command with multiple args', () => {
    expect(parseCommand('/model claude-sonnet-4-6')).toEqual({ name: '/model', args: ['claude-sonnet-4-6'] });
  });

  it('normalizes command name to lowercase', () => {
    expect(parseCommand('/HELP')).toEqual({ name: '/help', args: [] });
    expect(parseCommand('/Engine Cursor')).toEqual({ name: '/engine', args: ['Cursor'] });
  });

  it('handles extra whitespace', () => {
    expect(parseCommand('  /help  ')).toEqual({ name: '/help', args: [] });
    expect(parseCommand('/engine   cursor  ')).toEqual({ name: '/engine', args: ['cursor'] });
  });
});

// ── executeCommand ───────────────────────────────────────

function makeCtx(overrides?: Partial<CommandContext>): CommandContext {
  return {
    dir: '/tmp/test',
    sessionKey: 'test-session',
    getStatus: async () => ({
      config: { name: 'my-bot', engine: 'cursor', model: 'sonnet-4.6' } as any,
      skills: [
        { name: 'general', path: '/tmp/skills/general', description: 'General assistant' },
        { name: 'faq', path: '/tmp/skills/faq', description: 'FAQ support' },
      ],
      engine: 'cursor',
      model: 'sonnet-4.6',
    }),
    setEngine: vi.fn(),
    setModel: vi.fn(),
    resetSession: vi.fn(),
    listModels: vi.fn().mockResolvedValue(['model-a', 'model-b', 'model-c']),
    ...overrides,
  };
}

describe('executeCommand', () => {
  // ── /help ──
  it('/help returns command list', async () => {
    const result = await executeCommand({ name: '/help', args: [] }, makeCtx());
    expect(result).not.toBeNull();
    expect(result!.text).toContain('/help');
    expect(result!.text).toContain('/status');
    expect(result!.text).toContain('/engine');
    expect(result!.text).toContain('/model');
    expect(result!.text).toContain('/skill');
    expect(result!.text).toContain('/reset');
    expect(result!.data).toHaveProperty('commands');
  });

  // ── /status ──
  it('/status shows current config', async () => {
    const result = await executeCommand({ name: '/status', args: [] }, makeCtx());
    expect(result).not.toBeNull();
    expect(result!.text).toContain('my-bot');
    expect(result!.text).toContain('cursor');
    expect(result!.text).toContain('sonnet-4.6');
    expect(result!.data!.engine).toBe('cursor');
    expect(result!.data!.model).toBe('sonnet-4.6');
  });

  // ── /engine ──
  it('/engine without args shows current engine', async () => {
    const result = await executeCommand({ name: '/engine', args: [] }, makeCtx());
    expect(result!.text).toContain('cursor');
    expect(result!.text).toContain('Available');
  });

  it('/engine with valid name switches engine', async () => {
    const ctx = makeCtx();
    const result = await executeCommand({ name: '/engine', args: ['claude-code'] }, ctx);
    expect(result!.text).toContain('claude-code');
    expect(result!.text).toContain('switched');
    expect(ctx.setEngine).toHaveBeenCalledWith('claude-code', true);
  });

  it('/engine with invalid name returns error', async () => {
    const ctx = makeCtx();
    const result = await executeCommand({ name: '/engine', args: ['invalid'] }, ctx);
    expect(result!.text).toContain('Unknown engine');
    expect(ctx.setEngine).not.toHaveBeenCalled();
  });

  // ── /model ──
  it('/model without args shows current model', async () => {
    const result = await executeCommand({ name: '/model', args: [] }, makeCtx());
    expect(result!.text).toContain('sonnet-4.6');
  });

  it('/model without args and no model set', async () => {
    const ctx = makeCtx({
      getStatus: async () => ({
        config: { name: 'bot', engine: 'cursor' } as any,
        skills: [],
        engine: 'cursor',
        model: undefined,
      }),
    });
    const result = await executeCommand({ name: '/model', args: [] }, ctx);
    expect(result!.text).toContain('No model override');
  });

  it('/model list fetches available models', async () => {
    const ctx = makeCtx();
    const result = await executeCommand({ name: '/model', args: ['list'] }, ctx);
    expect(result).not.toBeNull();
    expect(result!.text).toContain('model-a');
    expect(result!.text).toContain('model-b');
    expect(result!.text).toContain('model-c');
    expect(result!.text).toContain('cursor');
    expect(result!.data!.models).toEqual(['model-a', 'model-b', 'model-c']);
    expect(ctx.listModels).toHaveBeenCalled();
  });

  it('/model list with no models returns empty message', async () => {
    const ctx = makeCtx({ listModels: vi.fn().mockResolvedValue([]) });
    const result = await executeCommand({ name: '/model', args: ['list'] }, ctx);
    expect(result!.text).toContain('No models found');
    expect(result!.data!.models).toEqual([]);
  });

  it('/model with args switches model', async () => {
    const ctx = makeCtx();
    const result = await executeCommand({ name: '/model', args: ['claude-sonnet-4-6'] }, ctx);
    expect(result!.text).toContain('claude-sonnet-4-6');
    expect(ctx.setModel).toHaveBeenCalledWith('claude-sonnet-4-6');
  });

  // ── /skill ──
  it('/skill lists installed skills', async () => {
    const result = await executeCommand({ name: '/skill', args: [] }, makeCtx());
    expect(result!.text).toContain('general');
    expect(result!.text).toContain('faq');
    expect(result!.data!.skills).toHaveLength(2);
  });

  it('/skill with no skills', async () => {
    const ctx = makeCtx({
      getStatus: async () => ({
        config: { name: 'bot', engine: 'cursor' } as any,
        skills: [],
        engine: 'cursor',
        model: undefined,
      }),
    });
    const result = await executeCommand({ name: '/skill', args: [] }, ctx);
    expect(result!.text).toContain('No skills');
  });

  // ── /reset ──
  it('/reset clears session', async () => {
    const ctx = makeCtx();
    const result = await executeCommand({ name: '/reset', args: [] }, ctx);
    expect(result!.text).toContain('Session reset');
    expect(ctx.resetSession).toHaveBeenCalledWith('test-session');
  });

  // ── Unknown command ──
  it('unknown command returns null', async () => {
    const result = await executeCommand({ name: '/unknown', args: [] }, makeCtx());
    expect(result).toBeNull();
  });
});

// ── /cron ─────────────────────────────────────────────────

const mockTasks = [
  {
    id: 'task-1',
    name: 'Daily Report',
    schedule: '0 9 * * *',
    prompt: 'Generate daily report',
    enabled: true,
    createdAt: '2026-01-01T00:00:00Z',
    lastRun: '2026-03-08T09:00:00Z',
    lastStatus: 'success' as const,
  },
  {
    id: 'task-2',
    name: 'Weekly Cleanup',
    schedule: '0 0 * * 0',
    prompt: 'Run weekly cleanup',
    enabled: false,
    createdAt: '2026-01-15T00:00:00Z',
  },
];

const mockHistory = [
  {
    taskId: 'task-1',
    taskName: 'Daily Report',
    startedAt: '2026-03-08T09:00:00Z',
    completedAt: '2026-03-08T09:01:30Z',
    status: 'success' as const,
    reply: 'Report generated successfully.',
    durationMs: 90000,
  },
  {
    taskId: 'task-1',
    taskName: 'Daily Report',
    startedAt: '2026-03-07T09:00:00Z',
    completedAt: '2026-03-07T09:02:00Z',
    status: 'error' as const,
    reply: 'Failed to fetch data.',
    durationMs: 120000,
    error: 'timeout',
  },
];

function makeMockTaskStore(): TaskStore {
  return {
    listTasks: vi.fn().mockResolvedValue(mockTasks),
    getTask: vi.fn().mockImplementation(async (id: string) =>
      mockTasks.find((t) => t.id === id),
    ),
    getHistory: vi.fn().mockResolvedValue(mockHistory),
    updateTask: vi.fn().mockResolvedValue(true),
    removeTask: vi.fn().mockResolvedValue(true),
  } as unknown as TaskStore;
}

function makeMockScheduler(): Scheduler {
  return {
    enableTask: vi.fn(),
    disableTask: vi.fn(),
    removeTask: vi.fn(),
  } as unknown as Scheduler;
}

function makeCronCtx(overrides?: Partial<CommandContext>): CommandContext {
  return makeCtx({
    taskStore: makeMockTaskStore(),
    scheduler: makeMockScheduler(),
    runTask: vi.fn().mockResolvedValue('Task executed successfully.'),
    ...overrides,
  });
}

describe('/cron', () => {
  it('/cron (no args) lists tasks', async () => {
    const ctx = makeCronCtx();
    const result = await executeCommand({ name: '/cron', args: [] }, ctx);
    expect(result).not.toBeNull();
    expect(result!.text).toContain('Daily Report');
    expect(result!.text).toContain('Weekly Cleanup');
    expect(result!.data!.tasks).toHaveLength(2);
  });

  it('/cron list lists tasks', async () => {
    const ctx = makeCronCtx();
    const result = await executeCommand({ name: '/cron', args: ['list'] }, ctx);
    expect(result).not.toBeNull();
    expect(result!.text).toContain('Daily Report');
    expect(result!.text).toContain('Weekly Cleanup');
    expect(result!.data!.tasks).toHaveLength(2);
  });

  it('/cron run <id> runs the task and returns reply', async () => {
    const ctx = makeCronCtx();
    const result = await executeCommand({ name: '/cron', args: ['run', 'task-1'] }, ctx);
    expect(result).not.toBeNull();
    expect(result!.text).toBe('Task executed successfully.');
    expect(result!.data!.taskId).toBe('task-1');
    expect(ctx.runTask).toHaveBeenCalledWith('task-1');
  });

  it('/cron enable <id> enables the task', async () => {
    const ctx = makeCronCtx();
    const result = await executeCommand({ name: '/cron', args: ['enable', 'task-1'] }, ctx);
    expect(result).not.toBeNull();
    expect(result!.text).toContain('enabled');
    expect((ctx.taskStore!.updateTask as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('task-1', { enabled: true });
    expect((ctx.scheduler!.enableTask as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('task-1');
  });

  it('/cron disable <id> disables the task', async () => {
    const ctx = makeCronCtx();
    const result = await executeCommand({ name: '/cron', args: ['disable', 'task-2'] }, ctx);
    expect(result).not.toBeNull();
    expect(result!.text).toContain('disabled');
    expect((ctx.taskStore!.updateTask as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('task-2', { enabled: false });
    expect((ctx.scheduler!.disableTask as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('task-2');
  });

  it('/cron del <id> deletes the task', async () => {
    const ctx = makeCronCtx();
    const result = await executeCommand({ name: '/cron', args: ['del', 'task-1'] }, ctx);
    expect(result).not.toBeNull();
    expect(result!.text).toContain('deleted');
    expect((ctx.taskStore!.removeTask as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('task-1');
    expect((ctx.scheduler!.removeTask as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('task-1');
  });

  it('/cron history <id> returns execution history', async () => {
    const ctx = makeCronCtx();
    const result = await executeCommand({ name: '/cron', args: ['history', 'task-1'] }, ctx);
    expect(result).not.toBeNull();
    expect(result!.text).toContain('History for task task-1');
    expect(result!.text).toContain('success');
    expect(result!.text).toContain('error');
    expect(result!.data!.history).toHaveLength(2);
    expect((ctx.taskStore!.getHistory as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('task-1', 10);
  });

  it('/cron when taskStore is not available returns gateway mode message', async () => {
    const ctx = makeCtx(); // no taskStore
    const result = await executeCommand({ name: '/cron', args: [] }, ctx);
    expect(result).not.toBeNull();
    expect(result!.text).toContain('gateway mode');
  });
});
