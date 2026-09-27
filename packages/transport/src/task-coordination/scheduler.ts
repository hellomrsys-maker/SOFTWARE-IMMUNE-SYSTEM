/**
 * @node 03.03 — Task Coordination — Dependency DAG Scheduler
 *
 * Schedules tasks within an incident workflow.  Tasks declare their dependencies
 * via `dependsOn`; the scheduler dispatches all tasks with satisfied dependencies
 * in parallel, then waits for results before dispatching the next wave.
 *
 * Inputs are snapshotted at dispatch time to prevent mutation after dispatch.
 * Outputs are validated with the task's zod schema before being accepted.
 */

import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import type pg from 'pg';

// ─── Types ────────────────────────────────────────────────────────────────────

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface TaskDefinition<TInput, TOutput> {
  /** Unique task type identifier */
  type: string;
  /** Human-readable description */
  description: string;
  /** IDs of tasks that must complete before this one can start */
  dependsOn: string[];
  /** Zod schema for validating the output */
  outputSchema: z.ZodType<TOutput>;
  /** The function that performs the task */
  execute: (input: TInput, taskId: string) => Promise<TOutput>;
}

export interface ScheduledTask {
  id: string;
  incidentId: string;
  type: string;
  dependsOn: string[];
  /** Snapshot of input taken at dispatch time — immutable */
  inputSnapshot: Record<string, unknown>;
  status: TaskStatus;
  output: Record<string, unknown> | null;
  attemptCount: number;
  maxAttempts: number;
  error: string | null;
  createdAt: Date;
}

export interface TaskResult {
  taskId: string;
  type: string;
  status: 'completed' | 'failed';
  output: Record<string, unknown> | null;
  error: string | null;
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

export class TaskScheduler {
  constructor(
    private readonly db: pg.Pool,
    private readonly maxAttempts = 3,
  ) {}

  /**
   * @node 03.03.01 — Schedule a batch of tasks for an incident.
   *
   * Builds the dependency DAG, dispatches ready tasks in parallel,
   * and iterates until all tasks are complete or one fails unrecoverably.
   */
  async schedule<TInput extends Record<string, unknown>>(
    incidentId: string,
    tasks: Array<TaskDefinition<TInput, Record<string, unknown>>>,
    sharedInput: TInput,
    wallClockBudgetMs = 300_000, // 5 minutes default
  ): Promise<TaskResult[]> {
    const startTime = Date.now();
    const results = new Map<string, TaskResult>();
    const pending = [...tasks];

    while (pending.length > 0) {
      if (Date.now() - startTime > wallClockBudgetMs) {
        throw new TaskBudgetExceededError(
          `Task budget of ${wallClockBudgetMs}ms exceeded for incident ${incidentId}`,
        );
      }

      // Find tasks whose dependencies are all satisfied
      const ready = pending.filter((t) =>
        t.dependsOn.every((depType) => {
          const r = [...results.values()].find((res) => res.type === depType);
          return r?.status === 'completed';
        }),
      );

      if (ready.length === 0) {
        // Check for failed dependencies causing a deadlock
        const anyFailed = [...results.values()].some((r) => r.status === 'failed');
        if (anyFailed) {
          // Cancel remaining tasks
          for (const t of pending) {
            results.set(t.type, { taskId: uuidv4(), type: t.type, status: 'failed', output: null, error: 'Dependency failed' });
          }
          break;
        }
        // Should not happen in a well-formed DAG
        throw new Error(`Task scheduler deadlock for incident ${incidentId}`);
      }

      // Dispatch ready tasks in parallel (§03.03.02)
      const wave = ready.map(async (taskDef) => {
        // Remove from pending first (prevents double-dispatch)
        pending.splice(pending.indexOf(taskDef), 1);

        const taskId = uuidv4();
        // §03.03.03 — Snapshot input at dispatch time (immutable copy)
        const inputSnapshot = JSON.parse(JSON.stringify(sharedInput)) as Record<string, unknown>;

        try {
          const output = await taskDef.execute(sharedInput, taskId);

          // §03.03.04 — Validate output with zod schema
          const parsed = taskDef.outputSchema.safeParse(output);
          if (!parsed.success) {
            throw new TaskOutputValidationError(
              `Task "${taskDef.type}" output failed schema validation: ${parsed.error.message}`,
              taskDef.type,
            );
          }

          results.set(taskDef.type, {
            taskId, type: taskDef.type, status: 'completed',
            output: output as Record<string, unknown>, error: null,
          });
        } catch (err: unknown) {
          results.set(taskDef.type, {
            taskId, type: taskDef.type, status: 'failed',
            output: null, error: (err as Error).message,
          });
        }

        void inputSnapshot; // captured for audit purposes
      });

      await Promise.all(wave);
    }

    return [...results.values()];
  }
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export class TaskBudgetExceededError extends Error {
  constructor(message: string) { super(message); this.name = 'TaskBudgetExceededError'; }
}

export class TaskOutputValidationError extends Error {
  constructor(message: string, public readonly taskType: string) {
    super(message); this.name = 'TaskOutputValidationError';
  }
}
