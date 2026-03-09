import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TaskStore } from '../task-store.js';
import type { TaskRecord, TaskExecution, ScheduledTaskDef } from '../task-store.js';

describe('TaskStore', () => {
  let dir: string;
  let store: TaskStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'golem-test-taskstore-'));
    store = new TaskStore(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // CRUD
  // -----------------------------------------------------------------------

  describe('load', () => {
    it('returns empty array when no file exists', async () => {
      expect(await store.load()).toEqual([]);
    });

    it('returns empty array when file is corrupted', async () => {
      await mkdir(join(dir, '.golem'), { recursive: true });
      await writeFile(join(dir, '.golem', 'tasks.json'), '{{broken', 'utf-8');
      expect(await store.load()).toEqual([]);
    });

    it('returns empty array when file contains non-array JSON', async () => {
      await mkdir(join(dir, '.golem'), { recursive: true });
      await writeFile(join(dir, '.golem', 'tasks.json'), '{"foo":"bar"}\n', 'utf-8');
      expect(await store.load()).toEqual([]);
    });
  });

  describe('save', () => {
    it('creates .golem directory and writes tasks', async () => {
      const tasks: TaskRecord[] = [
        { id: 'abc', name: 'test', schedule: '0 9 * * *', prompt: 'hello', enabled: true, createdAt: '2026-01-01T00:00:00Z' },
      ];
      await store.save(tasks);

      const raw = await readFile(join(dir, '.golem', 'tasks.json'), 'utf-8');
      const parsed = JSON.parse(raw);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].id).toBe('abc');
    });

    it('writes atomically (tmp + rename)', async () => {
      // After save, no .tmp file should remain
      await store.save([]);
      const files = await readFile(join(dir, '.golem', 'tasks.json'), 'utf-8');
      expect(files).toBeDefined();
      // .tmp should not exist — if rename succeeded, it's gone
      await expect(readFile(join(dir, '.golem', 'tasks.json.tmp'), 'utf-8')).rejects.toThrow();
    });
  });

  describe('addTask', () => {
    it('appends a task and persists', async () => {
      await store.addTask({ id: 't1', name: 'task1', schedule: '0 * * * *', prompt: 'do stuff', enabled: true, createdAt: '2026-01-01T00:00:00Z' });
      await store.addTask({ id: 't2', name: 'task2', schedule: '0 * * * *', prompt: 'more stuff', enabled: true, createdAt: '2026-01-01T00:00:00Z' });

      const tasks = await store.load();
      expect(tasks).toHaveLength(2);
      expect(tasks[0].id).toBe('t1');
      expect(tasks[1].id).toBe('t2');
    });

    it('generates id if not provided', async () => {
      const task: TaskRecord = { id: '', name: 'auto-id', schedule: '0 * * * *', prompt: 'test', enabled: true, createdAt: '2026-01-01T00:00:00Z' };
      await store.addTask(task);

      const tasks = await store.load();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toHaveLength(8);
      expect(tasks[0].id).toMatch(/^[0-9a-f]{8}$/);
    });
  });

  describe('removeTask', () => {
    it('removes existing task and returns true', async () => {
      await store.addTask({ id: 'del1', name: 'to-delete', schedule: '0 * * * *', prompt: 'x', enabled: true, createdAt: '2026-01-01T00:00:00Z' });
      await store.addTask({ id: 'keep1', name: 'to-keep', schedule: '0 * * * *', prompt: 'y', enabled: true, createdAt: '2026-01-01T00:00:00Z' });

      const result = await store.removeTask('del1');
      expect(result).toBe(true);

      const tasks = await store.load();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe('keep1');
    });

    it('returns false when task not found', async () => {
      const result = await store.removeTask('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('getTask', () => {
    it('returns the task if found', async () => {
      await store.addTask({ id: 'g1', name: 'findme', schedule: '0 * * * *', prompt: 'hi', enabled: true, createdAt: '2026-01-01T00:00:00Z' });
      const task = await store.getTask('g1');
      expect(task).toBeDefined();
      expect(task!.name).toBe('findme');
    });

    it('returns undefined if not found', async () => {
      expect(await store.getTask('nope')).toBeUndefined();
    });
  });

  describe('updateTask', () => {
    it('patches an existing task and returns true', async () => {
      await store.addTask({ id: 'u1', name: 'original', schedule: '0 * * * *', prompt: 'old', enabled: true, createdAt: '2026-01-01T00:00:00Z' });

      const result = await store.updateTask('u1', { prompt: 'new', lastStatus: 'success', lastRun: '2026-01-02T00:00:00Z' });
      expect(result).toBe(true);

      const task = await store.getTask('u1');
      expect(task!.prompt).toBe('new');
      expect(task!.lastStatus).toBe('success');
      expect(task!.name).toBe('original'); // unchanged fields preserved
    });

    it('returns false when task not found', async () => {
      const result = await store.updateTask('missing', { prompt: 'nope' });
      expect(result).toBe(false);
    });

    it('id is immutable even if patch includes it', async () => {
      await store.addTask({ id: 'immutable', name: 'test', schedule: '0 * * * *', prompt: 'x', enabled: true, createdAt: '2026-01-01T00:00:00Z' });

      await store.updateTask('immutable', { id: 'hacked' } as Partial<TaskRecord>);
      const task = await store.getTask('immutable');
      expect(task).toBeDefined();
      expect(task!.id).toBe('immutable');
    });
  });

  describe('listTasks', () => {
    it('returns all tasks', async () => {
      await store.addTask({ id: 'l1', name: 'a', schedule: '* * * * *', prompt: 'x', enabled: true, createdAt: '2026-01-01T00:00:00Z' });
      await store.addTask({ id: 'l2', name: 'b', schedule: '* * * * *', prompt: 'y', enabled: true, createdAt: '2026-01-01T00:00:00Z' });

      const list = await store.listTasks();
      expect(list).toHaveLength(2);
    });
  });

  // -----------------------------------------------------------------------
  // mergeConfigTasks
  // -----------------------------------------------------------------------

  describe('mergeConfigTasks', () => {
    it('adds new config tasks', async () => {
      const configTasks: ScheduledTaskDef[] = [
        { id: 'c1', name: 'daily-report', schedule: '0 9 * * *', prompt: 'generate report', enabled: true },
      ];

      const result = await store.mergeConfigTasks(configTasks);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('daily-report');
      expect(result[0].createdBy).toBe('config');
      expect(result[0].createdAt).toBeDefined();
    });

    it('updates existing config task schedule and prompt', async () => {
      // Pre-populate a config task
      await store.addTask({
        id: 'c1', name: 'daily-report', schedule: '0 9 * * *', prompt: 'old prompt', enabled: true,
        createdAt: '2026-01-01T00:00:00Z', createdBy: 'config',
        lastRun: '2026-01-02T00:00:00Z', lastStatus: 'success',
      });

      const configTasks: ScheduledTaskDef[] = [
        { id: 'c1', name: 'daily-report', schedule: '0 10 * * *', prompt: 'new prompt', enabled: true },
      ];

      const result = await store.mergeConfigTasks(configTasks);
      expect(result).toHaveLength(1);
      expect(result[0].schedule).toBe('0 10 * * *');
      expect(result[0].prompt).toBe('new prompt');
      // Runtime state preserved
      expect(result[0].lastRun).toBe('2026-01-02T00:00:00Z');
      expect(result[0].lastStatus).toBe('success');
      expect(result[0].createdAt).toBe('2026-01-01T00:00:00Z');
    });

    it('removes stale config tasks no longer in config', async () => {
      await store.addTask({
        id: 'old', name: 'removed-task', schedule: '0 * * * *', prompt: 'x', enabled: true,
        createdAt: '2026-01-01T00:00:00Z', createdBy: 'config',
      });

      const configTasks: ScheduledTaskDef[] = []; // empty — old task removed from config
      const result = await store.mergeConfigTasks(configTasks);
      expect(result).toHaveLength(0);
    });

    it('preserves IM-created tasks untouched', async () => {
      await store.addTask({
        id: 'im1', name: 'user-task', schedule: '0 12 * * *', prompt: 'remind me', enabled: true,
        createdAt: '2026-01-01T00:00:00Z', createdBy: 'im',
      });

      const configTasks: ScheduledTaskDef[] = [
        { id: 'c1', name: 'config-task', schedule: '0 9 * * *', prompt: 'report', enabled: true },
      ];

      const result = await store.mergeConfigTasks(configTasks);
      expect(result).toHaveLength(2);

      const imTask = result.find(t => t.id === 'im1');
      expect(imTask).toBeDefined();
      expect(imTask!.createdBy).toBe('im');
      expect(imTask!.prompt).toBe('remind me');

      const configTask = result.find(t => t.name === 'config-task');
      expect(configTask).toBeDefined();
      expect(configTask!.createdBy).toBe('config');
    });

    it('generates id for config tasks without one', async () => {
      const configTasks: ScheduledTaskDef[] = [
        { id: '', name: 'no-id', schedule: '0 * * * *', prompt: 'test', enabled: true },
      ];

      const result = await store.mergeConfigTasks(configTasks);
      expect(result).toHaveLength(1);
      expect(result[0].id).toHaveLength(8);
      expect(result[0].id).toMatch(/^[0-9a-f]{8}$/);
    });
  });

  // -----------------------------------------------------------------------
  // Execution history
  // -----------------------------------------------------------------------

  describe('recordExecution', () => {
    it('appends execution to JSONL file', async () => {
      const exec: TaskExecution = {
        taskId: 't1', taskName: 'test', startedAt: '2026-01-01T00:00:00Z',
        completedAt: '2026-01-01T00:01:00Z', status: 'success',
        reply: 'done', durationMs: 60000,
      };

      await store.recordExecution(exec);
      await store.recordExecution({ ...exec, taskId: 't2', taskName: 'other' });

      const raw = await readFile(join(dir, '.golem', 'tasks-history.jsonl'), 'utf-8');
      const lines = raw.trim().split('\n');
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]).taskId).toBe('t1');
      expect(JSON.parse(lines[1]).taskId).toBe('t2');
    });

    it('creates .golem directory if missing', async () => {
      await store.recordExecution({
        taskId: 'x', taskName: 'x', startedAt: 'ts', completedAt: 'ts',
        status: 'success', reply: 'ok', durationMs: 1,
      });

      const raw = await readFile(join(dir, '.golem', 'tasks-history.jsonl'), 'utf-8');
      expect(raw).toContain('"taskId":"x"');
    });
  });

  describe('getHistory', () => {
    async function seedHistory(executions: TaskExecution[]) {
      for (const exec of executions) {
        await store.recordExecution(exec);
      }
    }

    it('returns entries for a specific taskId, most recent first', async () => {
      await seedHistory([
        { taskId: 't1', taskName: 'a', startedAt: '2026-01-01T01:00:00Z', completedAt: '2026-01-01T01:01:00Z', status: 'success', reply: 'first', durationMs: 1000 },
        { taskId: 't2', taskName: 'b', startedAt: '2026-01-01T02:00:00Z', completedAt: '2026-01-01T02:01:00Z', status: 'success', reply: 'other', durationMs: 1000 },
        { taskId: 't1', taskName: 'a', startedAt: '2026-01-01T03:00:00Z', completedAt: '2026-01-01T03:01:00Z', status: 'error', reply: '', durationMs: 500, error: 'oops' },
      ]);

      const history = await store.getHistory('t1');
      expect(history).toHaveLength(2);
      // Most recent first
      expect(history[0].startedAt).toBe('2026-01-01T03:00:00Z');
      expect(history[0].status).toBe('error');
      expect(history[1].startedAt).toBe('2026-01-01T01:00:00Z');
    });

    it('respects limit parameter', async () => {
      for (let i = 0; i < 5; i++) {
        await store.recordExecution({
          taskId: 't1', taskName: 'a', startedAt: `2026-01-0${i + 1}T00:00:00Z`,
          completedAt: `2026-01-0${i + 1}T00:01:00Z`, status: 'success',
          reply: `run-${i}`, durationMs: 1000,
        });
      }

      const history = await store.getHistory('t1', 3);
      expect(history).toHaveLength(3);
      // Most recent 3
      expect(history[0].reply).toBe('run-4');
      expect(history[2].reply).toBe('run-2');
    });

    it('returns empty array when no history file exists', async () => {
      const history = await store.getHistory('t1');
      expect(history).toEqual([]);
    });

    it('returns empty array when taskId has no executions', async () => {
      await store.recordExecution({
        taskId: 'other', taskName: 'x', startedAt: 'ts', completedAt: 'ts',
        status: 'success', reply: 'ok', durationMs: 1,
      });

      const history = await store.getHistory('nonexistent');
      expect(history).toEqual([]);
    });

    it('defaults limit to 20', async () => {
      for (let i = 0; i < 25; i++) {
        await store.recordExecution({
          taskId: 't1', taskName: 'a', startedAt: `ts-${i}`, completedAt: `ts-${i}`,
          status: 'success', reply: `r-${i}`, durationMs: 1,
        });
      }

      const history = await store.getHistory('t1');
      expect(history).toHaveLength(20);
    });
  });
});
