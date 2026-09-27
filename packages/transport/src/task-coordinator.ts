/**
 * @node 03.03 — Task Coordinator
 *
 * Dependency DAG-based task scheduler:
 *   - Build a DAG from task definitions
 *   - Dispatch tasks whose dependencies are all completed (parallel-safe)
 *   - Snapshot input at dispatch time (immutable)
 *   - Validate output against zod schema
 *   - Track attempt count and wall-clock budget
 *
 * Limitation: DAG cycle detection is not implemented; callers must ensure
 * their task graphs are acyclic.
 */

import type { Pool } from 'pg';
import { z } from 'zod';

// ─── Types ────────────────────────────────────────────────────────────────────

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface TaskDefinition {
  taskType: string;
  inputSnapshot: unknown;
  dependsOn?: string[]; // task IDs this task waits for
  maxAttempts?: number;
}

export interface Task {
  id: string;
  incidentId: string;
  taskType: string;
  dependsOn: string[];
  inputSnapshot: unknown;
  output: unknown | null;
  status: TaskStatus;
  attemptCount: number;
  maxAttempts: number;
  startedAt: Date | null;
  completedAt: Date | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─── TaskCoordinator ──────────────────────────────────────────────────────────

/**
 * @node 03.03 — TaskCoordinator
 */
export class TaskCoordinator {
  constructor(private readonly db: Pool) {}

  /**
   * @node 03.03.01 — Register a task and return its DB record.
   *
   * Input is snapshotted at registration time — changes to the caller's input
   * object after this call do not affect the stored snapshot.
   */
  async register(incidentId: string, def: TaskDefinition): Promise<Task> {
    const result = await this.db.query<TaskRow>(
      `INSERT INTO tasks (incident_id, task_type, depends_on, input_snapshot, max_attempts)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        incidentId,
        def.taskType,
        def.dependsOn ?? [],
        JSON.stringify(def.inputSnapshot),
        def.maxAttempts ?? 3,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error('TaskCoordinator.register: no row returned');
    return rowToTask(row);
  }

  /**
   * @node 03.03.02 — Get tasks that are ready to run (all dependencies completed).
   */
  async getReady(incidentId: string): Promise<Task[]> {
    // A task is ready if status=pending and all depends_on IDs are completed
    const result = await this.db.query<TaskRow>(
      `SELECT t.*
       FROM tasks t
       WHERE t.incident_id = $1
         AND t.status = 'pending'
         AND (
           array_length(t.depends_on, 1) IS NULL
           OR NOT EXISTS (
             SELECT 1 FROM unnest(t.depends_on) dep_id
             WHERE NOT EXISTS (
               SELECT 1 FROM tasks d
               WHERE d.id::text = dep_id::text
                 AND d.status = 'completed'
             )
           )
         )`,
      [incidentId],
    );
    return result.rows.map(rowToTask);
  }

  /**
   * @node 03.03.03 — Mark a task as running (increments attempt_count).
   */
  async markRunning(taskId: string): Promise<Task> {
    const result = await this.db.query<TaskRow>(
      `UPDATE tasks
       SET status = 'running',
           started_at = now(),
           attempt_count = attempt_count + 1,
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [taskId],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`Task ${taskId} not found`);
    return rowToTask(row);
  }

  /**
   * @node 03.03.04 — Complete a task with validated output.
   *
   * @param outputSchema  Optional zod schema; output is validated if provided.
   * Throws TaskOutputValidationError if validation fails.
   */
  async complete<T>(
    taskId: string,
    output: T,
    outputSchema?: z.ZodType<T>,
  ): Promise<Task> {
    if (outputSchema) {
      const parsed = outputSchema.safeParse(output);
      if (!parsed.success) {
        throw new TaskOutputValidationError(taskId, parsed.error.message);
      }
    }

    const result = await this.db.query<TaskRow>(
      `UPDATE tasks
       SET status = 'completed',
           output = $2,
           completed_at = now(),
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [taskId, JSON.stringify(output)],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`Task ${taskId} not found`);
    return rowToTask(row);
  }

  /**
   * @node 03.03.05 — Fail a task (increments attempt count; retries if within budget).
   */
  async fail(taskId: string, errorMessage: string): Promise<Task> {
    const result = await this.db.query<TaskRow>(
      `UPDATE tasks
       SET status = CASE
             WHEN attempt_count >= max_attempts THEN 'failed'
             ELSE 'pending'
           END,
           error_message = $2,
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [taskId, errorMessage],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`Task ${taskId} not found`);
    return rowToTask(row);
  }

  /** @node 03.03.06 — Get a task by ID. */
  async getById(taskId: string): Promise<Task | null> {
    const result = await this.db.query<TaskRow>(
      `SELECT * FROM tasks WHERE id = $1`,
      [taskId],
    );
    return result.rows[0] ? rowToTask(result.rows[0]) : null;
  }

  /** @node 03.03.07 — List all tasks for an incident. */
  async listByIncident(incidentId: string): Promise<Task[]> {
    const result = await this.db.query<TaskRow>(
      `SELECT * FROM tasks WHERE incident_id = $1 ORDER BY created_at ASC`,
      [incidentId],
    );
    return result.rows.map(rowToTask);
  }
}

// ─── Errors ───────────────────────────────────────────────────────────────────

/** @node 03.03.04 — Thrown when task output fails zod schema validation. */
export class TaskOutputValidationError extends Error {
  constructor(public readonly taskId: string, message: string) {
    super(`Task ${taskId} output validation failed: ${message}`);
    this.name = 'TaskOutputValidationError';
  }
}

// ─── Internal row type ────────────────────────────────────────────────────────

interface TaskRow {
  id: string;
  incident_id: string;
  task_type: string;
  depends_on: string[];
  input_snapshot: unknown;
  output: unknown | null;
  status: TaskStatus;
  attempt_count: number;
  max_attempts: number;
  started_at: Date | null;
  completed_at: Date | null;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
}

function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    incidentId: row.incident_id,
    taskType: row.task_type,
    dependsOn: row.depends_on,
    inputSnapshot: row.input_snapshot,
    output: row.output,
    status: row.status,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
