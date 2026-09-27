/**
 * @node 03.02 — Incident State Machine
 *
 * Manages valid state transitions for incidents.  The allowed-transition table
 * is a hardcoded constant — it cannot be modified by any runtime configuration
 * or model-generated instruction.
 *
 * States: created → observing → diagnosing → reproducing → repairing →
 *         validating → review_ready | rejected | escalated | abstained
 */

import { v4 as uuidv4 } from 'uuid';
import type pg from 'pg';

// ─── State enum ───────────────────────────────────────────────────────────────

/** @node 03.02 — All permitted incident states. */
export const INCIDENT_STATES = [
  'created', 'observing', 'diagnosing', 'reproducing',
  'repairing', 'validating', 'review_ready',
  'rejected', 'escalated', 'abstained',
] as const;

export type IncidentState = typeof INCIDENT_STATES[number];

/**
 * @node 03.02 — Hardcoded allowed-transition table.
 *
 * This is a compile-time constant.  No runtime code path can modify it.
 * Any attempted transition not listed here is rejected with InvalidTransitionError.
 */
export const ALLOWED_TRANSITIONS: Readonly<Record<IncidentState, readonly IncidentState[]>> = {
  created:      ['observing', 'abstained'],
  observing:    ['diagnosing', 'escalated', 'abstained'],
  diagnosing:   ['reproducing', 'repairing', 'rejected', 'escalated', 'abstained'],
  reproducing:  ['repairing', 'rejected', 'escalated', 'abstained'],
  repairing:    ['validating', 'rejected', 'escalated'],
  validating:   ['review_ready', 'repairing', 'rejected', 'escalated'],
  review_ready: [],     // terminal — human takes over
  rejected:     [],     // terminal
  escalated:    [],     // terminal
  abstained:    [],     // terminal
} as const;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface IncidentRecord {
  id: string;
  fingerprint: string;
  status: IncidentState;
  title: string;
  failureReport: Record<string, unknown>;
  repositoryPath: string;
  actorId: string;
  retryCount: number;
  createdAt: Date;
  updatedAt: Date;
}

// ─── State Machine ────────────────────────────────────────────────────────────

export class IncidentStateMachine {
  constructor(private readonly db: pg.Pool) {}

  /**
   * @node 03.02.01 — Create a new incident with deduplication by fingerprint.
   *
   * If an incident with the same fingerprint already exists and is not terminal,
   * returns the existing incident (idempotent creation).
   */
  async createIncident(params: {
    fingerprint: string;
    title: string;
    failureReport: Record<string, unknown>;
    repositoryPath: string;
    actorId: string;
  }): Promise<{ incident: IncidentRecord; created: boolean }> {
    // Deduplication: check for existing non-terminal incident
    const existing = await this.db.query<IncidentRow>(
      `SELECT * FROM incidents WHERE fingerprint=$1
       AND status NOT IN ('review_ready','rejected','escalated','abstained')
       LIMIT 1`,
      [params.fingerprint],
    );
    if (existing.rows[0]) {
      return { incident: rowToIncident(existing.rows[0]), created: false };
    }

    const id = uuidv4();
    const res = await this.db.query<IncidentRow>(
      `INSERT INTO incidents
         (id, fingerprint, status, title, failure_report, repository_path, actor_id)
       VALUES ($1,$2,'created',$3,$4,$5,$6)
       RETURNING *`,
      [id, params.fingerprint, params.title,
       JSON.stringify(params.failureReport), params.repositoryPath, params.actorId],
    );
    return { incident: rowToIncident(res.rows[0]!), created: true };
  }

  /**
   * @node 03.02.02 — Transition an incident to a new state.
   *
   * Validates against the hardcoded ALLOWED_TRANSITIONS table.
   * Throws InvalidTransitionError for any disallowed transition.
   * Persists a transition audit record on success.
   */
  async transition(
    incidentId: string,
    newState: IncidentState,
    actorId: string,
    reason?: string,
  ): Promise<IncidentRecord> {
    const current = await this.getIncident(incidentId);
    if (!current) throw new Error(`Incident not found: ${incidentId}`);

    const allowed = ALLOWED_TRANSITIONS[current.status];
    if (!allowed.includes(newState)) {
      throw new InvalidTransitionError(
        `Cannot transition incident ${incidentId} from '${current.status}' to '${newState}'`,
        current.status,
        newState,
      );
    }

    // Perform transition + audit log atomically
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');

      const res = await client.query<IncidentRow>(
        `UPDATE incidents SET status=$2, updated_at=now() WHERE id=$1 RETURNING *`,
        [incidentId, newState],
      );

      await client.query(
        `INSERT INTO incident_transitions (incident_id, from_status, to_status, actor_id, reason)
         VALUES ($1,$2,$3,$4,$5)`,
        [incidentId, current.status, newState, actorId, reason ?? null],
      );

      await client.query('COMMIT');
      return rowToIncident(res.rows[0]!);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  /** @node 03.02.03 — Get an incident by ID. */
  async getIncident(id: string): Promise<IncidentRecord | null> {
    const res = await this.db.query<IncidentRow>(`SELECT * FROM incidents WHERE id=$1`, [id]);
    return res.rows[0] ? rowToIncident(res.rows[0]) : null;
  }

  /**
   * @node 03.02.07 — Recover stalled incidents.
   *
   * Returns incidents that have been in a non-terminal state for more than
   * `staleMinutes` without being updated.  Callers decide whether to
   * re-enqueue or escalate.
   */
  async recoverStalled(staleMinutes = 60): Promise<IncidentRecord[]> {
    const res = await this.db.query<IncidentRow>(
      `SELECT * FROM incidents
       WHERE status NOT IN ('review_ready','rejected','escalated','abstained')
         AND updated_at < now()-($1||' minutes')::interval`,
      [staleMinutes],
    );
    return res.rows.map(rowToIncident);
  }
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export class InvalidTransitionError extends Error {
  constructor(
    message: string,
    public readonly from: IncidentState,
    public readonly to: IncidentState,
  ) {
    super(message);
    this.name = 'InvalidTransitionError';
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

type IncidentRow = {
  id: string; fingerprint: string; status: IncidentState;
  title: string; failure_report: Record<string, unknown>;
  repository_path: string; actor_id: string; retry_count: number;
  created_at: Date; updated_at: Date;
};

function rowToIncident(row: IncidentRow): IncidentRecord {
  return {
    id: row.id, fingerprint: row.fingerprint, status: row.status,
    title: row.title, failureReport: row.failure_report,
    repositoryPath: row.repository_path, actorId: row.actor_id,
    retryCount: row.retry_count,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
