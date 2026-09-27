/**
 * @node 11.06 — Reliability safeguards
 *
 * Provides:
 *   - Idempotent command wrapper (dedup by command ID)
 *   - Workflow checkpoint writer/reader
 *   - Artifact-write failure handler
 *   - DB outage waiter
 *
 * Limitation: command deduplication is in-process only; a distributed system
 * would need a persistent dedup store.
 */

import type { Pool } from 'pg';
import type { Logger } from 'pino';

// ─── Idempotent command wrapper ───────────────────────────────────────────────

/**
 * @node 11.06.01 — Idempotent command wrapper.
 *
 * Deduplicates command execution within the same process by commandId.
 * If a command with the same ID has already completed successfully, the
 * stored result is returned without re-executing.
 *
 * Limitation: in-process dedup only; restarted processes will re-execute.
 */
export class IdempotentCommandWrapper {
  private readonly results = new Map<string, unknown>();

  /**
   * @node 11.06.01 — Execute fn if commandId not yet seen; return stored result otherwise.
   */
  async execute<T>(commandId: string, fn: () => Promise<T>): Promise<T> {
    if (this.results.has(commandId)) {
      return this.results.get(commandId) as T;
    }
    const result = await fn();
    this.results.set(commandId, result);
    return result;
  }

  /** @node 11.06.01 — Clear all stored results (for testing / after restart). */
  clear(): void {
    this.results.clear();
  }

  /** @node 11.06.01 — Check whether a commandId has already been executed. */
  has(commandId: string): boolean {
    return this.results.has(commandId);
  }
}

// ─── Workflow checkpoint ───────────────────────────────────────────────────────

export interface WorkflowCheckpoint {
  incidentId: string;
  stepName: string;
  stepOutput: unknown;
  savedAt: Date;
}

/**
 * @node 11.06.02 — Write a workflow checkpoint so processing can resume
 * after a crash.  Checkpoints are stored as JSON in a PostgreSQL JSONB column.
 *
 * Limitation: no encryption of checkpoint data; do not store sensitive material.
 */
export async function writeCheckpoint(
  pool: Pool,
  checkpoint: WorkflowCheckpoint,
): Promise<void> {
  await pool.query(
    `INSERT INTO workflow_checkpoints (incident_id, step_name, step_output, saved_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (incident_id, step_name)
     DO UPDATE SET step_output = $3, saved_at = $4`,
    [
      checkpoint.incidentId,
      checkpoint.stepName,
      JSON.stringify(checkpoint.stepOutput),
      checkpoint.savedAt,
    ],
  );
}

/**
 * @node 11.06.02 — Read the latest checkpoint for an incident step.
 * Returns null if no checkpoint exists.
 */
export async function readCheckpoint(
  pool: Pool,
  incidentId: string,
  stepName: string,
): Promise<WorkflowCheckpoint | null> {
  const result = await pool.query<{
    incident_id: string;
    step_name: string;
    step_output: unknown;
    saved_at: Date;
  }>(
    `SELECT incident_id, step_name, step_output, saved_at
     FROM workflow_checkpoints
     WHERE incident_id = $1 AND step_name = $2
     LIMIT 1`,
    [incidentId, stepName],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    incidentId: row.incident_id,
    stepName: row.step_name,
    stepOutput: row.step_output,
    savedAt: row.saved_at,
  };
}

// ─── Artifact-write failure handler ───────────────────────────────────────────

/**
 * @node 11.06.03 — Artifact-write failure handler.
 *
 * When an artifact write fails the workflow must stop immediately.  Partial
 * artifact writes must not be used as inputs.  This handler logs the error
 * and calls stopWorker() to halt the worker process.
 */
export function handleArtifactWriteFailure(
  err: Error,
  context: { incidentId: string; artifactId: string },
  logger: Logger,
  stopWorker: () => void,
): void {
  logger.fatal({ err, ...context }, 'Artifact write failed — stopping worker (node: 11.06.03)');
  stopWorker();
}

// ─── DB outage waiter ─────────────────────────────────────────────────────────

/**
 * @node 11.06.04 — Wait for the DB to become available again.
 *
 * Polls `pool.query('SELECT 1')` with exponential backoff.  Calls stopWorker()
 * if maxWaitMs elapses without a successful connection.
 *
 * Limitation: does not implement circuit-breaker semantics; just a simple retry loop.
 */
export async function waitForDb(
  pool: Pool,
  logger: Logger,
  stopWorker: () => void,
  maxWaitMs = 60_000,
  baseDelayMs = 500,
): Promise<void> {
  const deadline = Date.now() + maxWaitMs;
  let attempt = 0;

  while (Date.now() < deadline) {
    try {
      await pool.query('SELECT 1');
      return; // DB is available
    } catch (err) {
      attempt += 1;
      const delayMs = Math.min(baseDelayMs * 2 ** attempt, 10_000);
      logger.warn({ attempt, delayMs }, 'DB unavailable — waiting before retry (node: 11.06.04)');
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
  }

  logger.fatal({ maxWaitMs }, 'DB did not recover within wait window — stopping worker');
  stopWorker();
}
