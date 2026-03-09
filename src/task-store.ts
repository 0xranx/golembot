import { readFile, writeFile, mkdir, appendFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { ScheduledTaskDef, TaskTarget } from './scheduler.js';

export type { ScheduledTaskDef, TaskTarget } from './scheduler.js';

// ---------------------------------------------------------------------------
// Stored records
// ---------------------------------------------------------------------------

export interface TaskRecord extends ScheduledTaskDef {
  createdAt: string;       // ISO timestamp
  createdBy?: string;      // 'config' | 'im' | 'api'
  lastRun?: string;        // ISO timestamp
  lastStatus?: 'success' | 'error';
  lastError?: string;
}

export interface TaskExecution {
  taskId: string;
  taskName: string;
  startedAt: string;
  completedAt: string;
  status: 'success' | 'error';
  reply: string;           // agent's response text
  durationMs: number;
  costUsd?: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GOLEM_DIR = '.golem';
const TASKS_FILE = 'tasks.json';
const HISTORY_FILE = 'tasks-history.jsonl';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tasksPath(dir: string): string {
  return join(dir, GOLEM_DIR, TASKS_FILE);
}

function historyPath(dir: string): string {
  return join(dir, GOLEM_DIR, HISTORY_FILE);
}

function generateId(): string {
  return randomBytes(4).toString('hex'); // 8-char hex
}

// ---------------------------------------------------------------------------
// TaskStore
// ---------------------------------------------------------------------------

export class TaskStore {
  private dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  // -- Task CRUD -----------------------------------------------------------

  async load(): Promise<TaskRecord[]> {
    try {
      const raw = await readFile(tasksPath(this.dir), 'utf-8');
      const data = JSON.parse(raw);
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  async save(tasks: TaskRecord[]): Promise<void> {
    const golemDir = join(this.dir, GOLEM_DIR);
    await mkdir(golemDir, { recursive: true });
    const target = tasksPath(this.dir);
    const tmp = target + '.tmp';
    await writeFile(tmp, JSON.stringify(tasks, null, 2) + '\n', 'utf-8');
    await rename(tmp, target);
  }

  async addTask(task: TaskRecord): Promise<void> {
    if (!task.id) {
      task.id = generateId();
    }
    const tasks = await this.load();
    tasks.push(task);
    await this.save(tasks);
  }

  async removeTask(id: string): Promise<boolean> {
    const tasks = await this.load();
    const idx = tasks.findIndex(t => t.id === id);
    if (idx === -1) return false;
    tasks.splice(idx, 1);
    await this.save(tasks);
    return true;
  }

  async getTask(id: string): Promise<TaskRecord | undefined> {
    const tasks = await this.load();
    return tasks.find(t => t.id === id);
  }

  async updateTask(id: string, patch: Partial<TaskRecord>): Promise<boolean> {
    const tasks = await this.load();
    const idx = tasks.findIndex(t => t.id === id);
    if (idx === -1) return false;
    tasks[idx] = { ...tasks[idx], ...patch, id }; // id is immutable
    await this.save(tasks);
    return true;
  }

  async listTasks(): Promise<TaskRecord[]> {
    return this.load();
  }

  // -- Config merge --------------------------------------------------------

  async mergeConfigTasks(configTasks: ScheduledTaskDef[]): Promise<TaskRecord[]> {
    const stored = await this.load();
    const configNames = new Set(configTasks.map(t => t.name));
    const now = new Date().toISOString();

    // Index stored config-created tasks by name
    const storedConfigByName = new Map<string, TaskRecord>();
    const nonConfigTasks: TaskRecord[] = [];

    for (const t of stored) {
      if (t.createdBy === 'config') {
        storedConfigByName.set(t.name, t);
      } else {
        nonConfigTasks.push(t);
      }
    }

    const mergedConfigTasks: TaskRecord[] = [];
    for (const ct of configTasks) {
      const existing = storedConfigByName.get(ct.name);
      if (existing) {
        // Update mutable fields from config, preserve runtime state
        mergedConfigTasks.push({
          ...existing,
          schedule: ct.schedule,
          prompt: ct.prompt,
          target: ct.target,
          enabled: ct.enabled,
        });
      } else {
        // New config task
        mergedConfigTasks.push({
          ...ct,
          id: ct.id || generateId(),
          createdAt: now,
          createdBy: 'config',
        });
      }
    }

    // Stale config tasks (in store but no longer in config) are dropped.
    // Non-config tasks are kept untouched.
    const result = [...mergedConfigTasks, ...nonConfigTasks];
    await this.save(result);
    return result;
  }

  // -- Execution history ---------------------------------------------------

  async recordExecution(exec: TaskExecution): Promise<void> {
    const line = JSON.stringify(exec) + '\n';
    const path = historyPath(this.dir);
    try {
      await appendFile(path, line, 'utf-8');
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        await mkdir(join(this.dir, GOLEM_DIR), { recursive: true });
        await appendFile(path, line, 'utf-8');
      }
    }
  }

  async getHistory(taskId: string, limit = 20): Promise<TaskExecution[]> {
    let raw: string;
    try {
      raw = await readFile(historyPath(this.dir), 'utf-8');
    } catch {
      return [];
    }

    const entries: TaskExecution[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as TaskExecution;
        if (parsed.taskId === taskId) {
          entries.push(parsed);
        }
      } catch {
        // skip malformed lines
      }
    }

    // Most recent first, limited
    return entries.reverse().slice(0, limit);
  }
}
