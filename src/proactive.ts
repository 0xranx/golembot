import type { StreamEvent } from './engine.js';
import type { TaskRecord, TaskExecution, TaskStore } from './task-store.js';
import type { Scheduler, ScheduledTaskDef } from './scheduler.js';
import type { ChannelAdapter } from './channel.js';

// ---------------------------------------------------------------------------
// Minimal assistant interface (subset of what createAssistant returns)
// ---------------------------------------------------------------------------

interface ChatAssistant {
  chat(message: string, opts: { sessionKey: string }): AsyncIterable<StreamEvent>;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface ProactiveCoordinatorOpts {
  assistant: ChatAssistant;
  taskStore: TaskStore;
  adapters: Map<string, ChannelAdapter>;
  scheduler: Scheduler;
  verbose?: boolean;
}

// ---------------------------------------------------------------------------
// Coordinator
// ---------------------------------------------------------------------------

export class ProactiveCoordinator {
  private assistant: ChatAssistant;
  private taskStore: TaskStore;
  private adapters: Map<string, ChannelAdapter>;
  private scheduler: Scheduler;
  private verbose: boolean;

  constructor(opts: ProactiveCoordinatorOpts) {
    this.assistant = opts.assistant;
    this.taskStore = opts.taskStore;
    this.adapters = opts.adapters;
    this.scheduler = opts.scheduler;
    this.verbose = opts.verbose ?? false;
  }

  /** Register all enabled tasks with the scheduler and start ticking. */
  start(tasks: TaskRecord[]): void {
    for (const task of tasks) {
      this.scheduler.addTask(task, async (def) => {
        await this.executeTask(def as TaskRecord);
      });
    }
  }

  /** Stop all scheduled timers. */
  stop(): void {
    this.scheduler.stop();
  }

  /** Manually trigger a task by id. Returns the reply text or throws. */
  async runTask(taskId: string): Promise<string> {
    const task = await this.taskStore.getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    return this.executeTask(task);
  }

  // ── Internal ────────────────────────────────────────────

  private async executeTask(task: TaskRecord): Promise<string> {
    const startedAt = new Date().toISOString();
    const t0 = Date.now();

    let reply = '';
    let costUsd: number | undefined;
    let durationMs: number | undefined;
    let error: string | undefined;

    try {
      const stream = this.assistant.chat(task.prompt, {
        sessionKey: `task:${task.id}`,
      });

      for await (const event of stream) {
        if (event.type === 'text') {
          reply += event.content;
        } else if (event.type === 'done') {
          costUsd = event.costUsd;
          durationMs = event.durationMs;
        }
      }

      // Deliver to channel if target is configured
      if (task.target) {
        const adapter = this.adapters.get(task.target.channel);
        if (adapter?.send) {
          await adapter.send(task.target.chatId, reply.trim());
        }
      }
    } catch (err: unknown) {
      error = err instanceof Error ? err.message : String(err);
    }

    const completedAt = new Date().toISOString();
    const wallMs = durationMs ?? (Date.now() - t0);
    const status: 'success' | 'error' = error ? 'error' : 'success';

    // Record execution history
    const exec: TaskExecution = {
      taskId: task.id,
      taskName: task.name,
      startedAt,
      completedAt,
      status,
      reply: error ? '' : reply.trim(),
      durationMs: wallMs,
      costUsd,
      error,
    };
    await this.taskStore.recordExecution(exec);

    // Update task runtime state
    await this.taskStore.updateTask(task.id, {
      lastRun: completedAt,
      lastStatus: status,
      lastError: error,
    });

    if (this.verbose) {
      const cost = costUsd != null ? ` $${costUsd.toFixed(4)}` : '';
      const summary = error
        ? `[task:${task.id}] ${task.name} FAILED (${wallMs}ms): ${error}`
        : `[task:${task.id}] ${task.name} OK (${wallMs}ms${cost}) ${reply.length} chars`;
      console.log(summary);
    }

    if (error) throw new Error(error);
    return reply.trim();
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createProactiveCoordinator(
  opts: ProactiveCoordinatorOpts,
): ProactiveCoordinator {
  return new ProactiveCoordinator(opts);
}
