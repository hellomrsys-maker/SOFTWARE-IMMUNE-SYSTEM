/**
 * @file packages/db/src/reliability.ts
 * @node 11.06
 * @description Reliability safeguards for the background worker.
 *
 * Three guarantees are enforced here:
 *
 *   1. IDEMPOTENT COMMAND WRAPPER — de-duplicates commands by command ID.
 *      If a command with the same ID was already completed, returns the cached
 *      result without re-executing. Prevents duplicate side-effects on restart.
 *
 *   2. WORKFLOW CHECKPOINT — writes checkpoint records so a restarted worker
 *      can resume from the last completed step rather than re-running the full
 *      workflow from scratch.
 *
 *   3. ARTIFACT WRITE FAILURE → STOP — if an artifact write fails (ArtifactWriteError),
 *      the worker MUST stop processing and not continue with stale or missing data.
 *      This function re-throws the error after logging it — the caller must not catch it.
 *
 *   4. DATABASE OUTAGE → STOP AND WAIT — if a DatabaseOutageError is detected,
 *      the worker stops processing and waits for the database to become available.
 *      It does NOT continue operating on in-memory state.
 *
 * WHY CODE, NOT PROMPTS:
 *   These safeguards are implemented as TypeScript service code so that no
 *   model-generated text can bypass them. The worker calls these functions
 *   as middleware around every action — there is no opt-out path.
 */
import type pg from "pg";
import { query } from "./pool.js";
import { DatabaseOutageError, ArtifactWriteError } from "@sis/shared";
import { createLogger } from "@sis/logger";
import { randomUUID } from "crypto";

const log = createLogger("reliability");

// ── Schema types ─────────────────────────────────────────────────────────────

export interface CommandRecord {
  id: string;
  command_id: string;
  incident_id: string | null;
  command_type: string;
  result: unknown;
  completed_at: Date;
  created_at: Date;
}

export interface WorkflowCheckpoint {
  id: string;
  incident_id: string;
  step_name: string;
  step_index: number;
  completed: boolean;
  context: unknown;
  created_at: Date;
  updated_at: Date;
}

// ── Idempotent command wrapper (11.06) ────────────────────────────────────────

/**
 * @node 11.06 — Execute a command exactly once, identified by commandId.
 * If a record with the same commandId already exists in the DB, returns the
 * stored result without re-executing the action.
 *
 * This prevents duplicate side-effects after worker restarts.
 */
export async function executeIdempotent<T>(
  commandId: string,
  commandType: string,
  incidentId: string | null,
  action: () => Promise<T>,
  pool?: pg.Pool,
): Promise<T> {
  // Check for existing completed record
  const { rows } = await query<CommandRecord>(
    "SELECT * FROM command_records WHERE command_id = $1",
    [commandId],
    pool,
  );

  const existing = rows[0];
  if (existing !== undefined) {
    log.debug({ commandId, commandType }, "Idempotent: returning cached result");
    return existing.result as T;
  }

  // Execute the action
  const result = await action();

  // Persist completion record
  await query(
    `INSERT INTO command_records (id, command_id, incident_id, command_type, result)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (command_id) DO NOTHING`,
    [randomUUID(), commandId, incidentId, commandType, JSON.stringify(result)],
    pool,
  );

  log.debug({ commandId, commandType }, "Idempotent: command completed and recorded");
  return result;
}

// ── Workflow checkpoint (11.06) ───────────────────────────────────────────────

/**
 * @node 11.06 — Write a workflow checkpoint after a step completes.
 * The worker reads these on restart to determine which step to resume from.
 */
export async function writeCheckpoint(
  incidentId: string,
  stepName: string,
  stepIndex: number,
  context: unknown,
  pool?: pg.Pool,
): Promise<void> {
  await query(
    `INSERT INTO workflow_checkpoints
       (id, incident_id, step_name, step_index, completed, context)
     VALUES ($1, $2, $3, $4, true, $5)
     ON CONFLICT (incident_id, step_name) DO UPDATE
       SET completed = true, context = $5, step_index = $4, updated_at = now()`,
    [randomUUID(), incidentId, stepName, stepIndex, JSON.stringify(context)],
    pool,
  );
  log.debug({ incidentId, stepName, stepIndex }, "Checkpoint written");
}

/**
 * @node 11.06 — Read the last completed checkpoint for an incident.
 * Returns null if no checkpoints exist (start from the beginning).
 */
export async function readLastCheckpoint(
  incidentId: string,
  pool?: pg.Pool,
): Promise<WorkflowCheckpoint | null> {
  const { rows } = await query<WorkflowCheckpoint>(
    `SELECT * FROM workflow_checkpoints
     WHERE incident_id = $1 AND completed = true
     ORDER BY step_index DESC LIMIT 1`,
    [incidentId],
    pool,
  );
  return rows[0] ?? null;
}

/**
 * @node 11.06 — List all completed checkpoints for an incident in order.
 */
export async function listCheckpoints(
  incidentId: string,
  pool?: pg.Pool,
): Promise<WorkflowCheckpoint[]> {
  const { rows } = await query<WorkflowCheckpoint>(
    `SELECT * FROM workflow_checkpoints
     WHERE incident_id = $1 AND completed = true
     ORDER BY step_index ASC`,
    [incidentId],
    pool,
  );
  return rows;
}

// ── Artifact write failure handler (11.06) ────────────────────────────────────

/**
 * @node 11.06 — Stop the workflow if an artifact write failed.
 * This function MUST be called around every artifact write in the worker.
 * It re-throws the error after logging — the caller MUST NOT catch this.
 *
 * WHY: If an artifact fails to write, continuing would mean the workflow
 * produces results without the required evidence trail. The system must stop
 * explicitly rather than silently continuing with incomplete data.
 */
export function handleArtifactWriteFailure(err: unknown): never {
  if (err instanceof ArtifactWriteError) {
    log.fatal({ err, code: err.code, context: err.context }, "WORKFLOW STOP: artifact write failed — cannot continue");
    throw err; // re-throw — the worker process must handle this by stopping
  }
  throw err; // re-throw all other errors too
}

// ── Database outage handler (11.06) ──────────────────────────────────────────

/**
 * @node 11.06 — Wait for the database to become available after an outage.
 * Polls the DB connection at increasing intervals. Does NOT process events
 * from in-memory state while waiting.
 *
 * Returns only when the DB is reachable again.
 */
export async function waitForDatabaseRecovery(
  pool: pg.Pool,
  maxWaitMs = 300_000, // 5 minutes
  initialIntervalMs = 5_000,
): Promise<void> {
  log.warn("DATABASE OUTAGE detected — worker paused, waiting for recovery");
  let waitedMs = 0;
  let intervalMs = initialIntervalMs;

  while (waitedMs < maxWaitMs) {
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
    waitedMs += intervalMs;

    try {
      const client = await pool.connect();
      client.release();
      log.info({ waitedMs }, "Database recovered — worker resuming");
      return;
    } catch {
      // Still unavailable
      intervalMs = Math.min(intervalMs * 2, 30_000); // exponential backoff, capped at 30s
      log.warn({ waitedMs, nextRetryMs: intervalMs }, "Database still unavailable — continuing to wait");
    }
  }

  // Max wait exceeded — stop the worker process
  log.fatal({ maxWaitMs }, "WORKER STOP: database did not recover within maximum wait time");
  throw new DatabaseOutageError(
    `Database did not recover within ${maxWaitMs}ms — worker process must exit`,
  );
}

/**
 * @node 11.06 — Wrap a worker step with DB outage detection.
 * If the step throws DatabaseOutageError, waits for recovery before propagating.
 * All other errors are re-thrown immediately.
 */
export async function withDatabaseOutageGuard<T>(
  pool: pg.Pool,
  action: () => Promise<T>,
  recoveryOptions?: { maxWaitMs?: number; initialIntervalMs?: number },
): Promise<T> {
  try {
    return await action();
  } catch (err) {
    if (err instanceof DatabaseOutageError) {
      await waitForDatabaseRecovery(
        pool,
        recoveryOptions?.maxWaitMs,
        recoveryOptions?.initialIntervalMs,
      );
      // Retry once after recovery
      return await action();
    }
    throw err;
  }
}
