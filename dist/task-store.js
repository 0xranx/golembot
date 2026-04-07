import { randomBytes } from 'node:crypto';
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const GOLEM_DIR = '.golem';
const TASKS_FILE = 'tasks.json';
const HISTORY_FILE = 'tasks-history.jsonl';
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function tasksPath(dir) {
    return join(dir, GOLEM_DIR, TASKS_FILE);
}
function historyPath(dir) {
    return join(dir, GOLEM_DIR, HISTORY_FILE);
}
function generateId() {
    return randomBytes(4).toString('hex'); // 8-char hex
}
// ---------------------------------------------------------------------------
// TaskStore
// ---------------------------------------------------------------------------
export class TaskStore {
    dir;
    constructor(dir) {
        this.dir = dir;
    }
    // -- Task CRUD -----------------------------------------------------------
    async load() {
        try {
            const raw = await readFile(tasksPath(this.dir), 'utf-8');
            const data = JSON.parse(raw);
            return Array.isArray(data) ? data : [];
        }
        catch {
            return [];
        }
    }
    async save(tasks) {
        const golemDir = join(this.dir, GOLEM_DIR);
        await mkdir(golemDir, { recursive: true });
        const target = tasksPath(this.dir);
        const tmp = `${target}.tmp`;
        await writeFile(tmp, `${JSON.stringify(tasks, null, 2)}\n`, 'utf-8');
        await rename(tmp, target);
    }
    async addTask(task) {
        if (!task.id) {
            task.id = generateId();
        }
        const tasks = await this.load();
        tasks.push(task);
        await this.save(tasks);
    }
    async removeTask(id) {
        const tasks = await this.load();
        const idx = tasks.findIndex((t) => t.id === id);
        if (idx === -1)
            return false;
        tasks.splice(idx, 1);
        await this.save(tasks);
        return true;
    }
    async getTask(id) {
        const tasks = await this.load();
        return tasks.find((t) => t.id === id);
    }
    async updateTask(id, patch) {
        const tasks = await this.load();
        const idx = tasks.findIndex((t) => t.id === id);
        if (idx === -1)
            return false;
        tasks[idx] = { ...tasks[idx], ...patch, id }; // id is immutable
        await this.save(tasks);
        return true;
    }
    async listTasks() {
        return this.load();
    }
    // -- Config merge --------------------------------------------------------
    async mergeConfigTasks(configTasks) {
        const stored = await this.load();
        const _configNames = new Set(configTasks.map((t) => t.name));
        const now = new Date().toISOString();
        // Index stored config-created tasks by name
        const storedConfigByName = new Map();
        const nonConfigTasks = [];
        for (const t of stored) {
            if (t.createdBy === 'config') {
                storedConfigByName.set(t.name, t);
            }
            else {
                nonConfigTasks.push(t);
            }
        }
        const mergedConfigTasks = [];
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
            }
            else {
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
    async recordExecution(exec) {
        const line = `${JSON.stringify(exec)}\n`;
        const path = historyPath(this.dir);
        try {
            await appendFile(path, line, 'utf-8');
        }
        catch (e) {
            if (e.code === 'ENOENT') {
                await mkdir(join(this.dir, GOLEM_DIR), { recursive: true });
                await appendFile(path, line, 'utf-8');
            }
        }
    }
    async getHistory(taskId, limit = 20) {
        let raw;
        try {
            raw = await readFile(historyPath(this.dir), 'utf-8');
        }
        catch {
            return [];
        }
        const entries = [];
        for (const line of raw.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed)
                continue;
            try {
                const parsed = JSON.parse(trimmed);
                if (parsed.taskId === taskId) {
                    entries.push(parsed);
                }
            }
            catch {
                // skip malformed lines
            }
        }
        // Most recent first, limited
        return entries.reverse().slice(0, limit);
    }
}
//# sourceMappingURL=task-store.js.map