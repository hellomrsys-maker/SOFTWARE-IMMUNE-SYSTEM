/**
 * @node 03.02 — Incident State Machine
 *
 * Manages incident lifecycle with a hardcoded allowed-transition table.
 * Deduplicates incidents by fingerprint.  Records every state transition in
 * `incident_transitions`.  Restart recovery reads latest state from DB.
 *
 * Allowed transitions:
 *   created      → observing
 *   observing    → diagnosing | escalated | abstained
 *   diagnosing   → reproducing | escalated | abstained
 *   reproducing  → repairing | escalated | abstained
 *   repairing    → validating | escalated | abstained
 *   validating   → review_ready | rejected | escalated | abstained
 *   review_ready → (terminal)
 *   rejected     → repairing (retry) | (terminal)
 *   escalated    → (terminal)
 *   abstained    → (terminal)
 *
 * Limitation: concurrent state transitions from multiple processes require
 * optimistic locking (not implemented here); a race could produce inconsistent
 * transition logs.
 */

import type { Pool } from 'pg';

// ─── Types ────────────────────────────────────────────────────────────────────

export type IncidentStatus =
  | 'created'
  | 'observing'
  | 'diagnosing'
  | 'reproducing'
  | 'repairing'
  | 'validating'
  | 'review_ready'
  | 'rejected'
  | 'escalated'
  | 'abstained';

export interface Incident {
  id: string;
  fingerprint: string;
  status: IncidentStatus;
  title: string;
  failureReport: unknown;
  repositoryPath: string;
  actorId: string;
  retryCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateIncidentOptions {
  fingerprint: string;
  title: string;
  failureReport: unknown;
  repositoryPath: string;
  actorId: string;
}

// ─── Transition table ─────────────────────────────────────────────────────────

/** @node 03.02.01 — Hardcoded allowed-transition table */
const ALLOWED_TRANSITIONS: Record<IncidentStatus, readonly IncidentStatus[]> = {
  created:      ['observing'],
  observing:    ['diagnosing', 'escalated', 'abstained'],
  diagnosing:   ['reproducing', 'escalated', 'abstained'],
  reproducing:  ['repairing', 'escalated', 'abstained'],
  repairing:    ['validating', 'escalated', 'abstained'],
  validating:   ['review_ready', 'rejected', 'escalated', 'abstained'],
  review_ready: [],
  rejected:     ['repairing'],
  escalated:    [],
  abstained:    [],
};

// ─── IncidentStateMachine ─────────────────────────────────────────────────────

/**
 * @node 03.02 — IncidentStateMachine
 */
export class IncidentStateMachine {
  constructor(private readonly db: Pool) {}

  /**
   * @node 03.02.02 — Create a new incident.
   *
   * If an incident with the same fingerprint already exists, returns the existing
   * incident without creating a duplicate (deduplication).
   */
  async createOrGet(options: CreateIncidentOptions): Promise<Incident> {
    // Deduplication check
    const existing = await this.db.query<IncidentRow>(
      `SELECT * FROM incidents WHERE fingerprint = $1 LIMIT 1`,
      [options.fingerprint],
    );
    if (existing.rows[0]) return rowToIncident(existing.rows[0]);

    const result = await this.db.query<IncidentRow>(
      `INSERT INTO incidents (fingerprint, status, title, failure_report, repository_path, actor_id)
       VALUES ($1, 'created', $2, $3, $4, $5)
       ON CONFLICT (fingerprint) DO NOTHING
       RETURNING *`,
      [
        options.fingerprint,
        options.title,
        JSON.stringify(options.failureReport),
        options.repositoryPath,
        options.actorId,
      ],
    );
    if (result.rows[0]) return rowToIncident(result.rows[0]);

    // ON CONFLICT hit — fetch the existing row
    const fetched = await this.db.query<IncidentRow>(
      `SELECT * FROM incidents WHERE fingerprint = $1`,
      [options.fingerprint],
    );
    const row = fetched.rows[0];
    if (!row) throw new Error('IncidentStateMachine: failed to create or fetch incident');
    return rowToIncident(row);
  }

  /**
   * @node 03.02.03 — Transition an incident to a new status.
   *
   * Throws IllegalTransitionError if the transition is not in the allowed table.
   * Records the transition in `incident_transitions`.
   */
  async transition(
    incidentId: string,
    toStatus: IncidentStatus,
    actorId: string,
    reason?: string,
  ): Promise<Incident> {
    const current = await this.getById(incidentId);
    if (!current) throw new Error(`Incident ${incidentId} not found`);

    const allowed = ALLOWED_TRANSITIONS[current.status];
    if (!allowed.includes(toStatus)) {
      throw new IllegalTransitionError(current.status, toStatus);
    }

    // Record transition log
    await this.db.query(
      `INSERT INTO incident_transitions (incident_id, from_status, to_status, actor_id, reason)
       VALUES ($1, $2, $3, $4, $5)`,
      [incidentId, current.status, toStatus, actorId, reason ?? null],
    );

    // Update incident status
    const updated = await this.db.query<IncidentRow>(
      `UPDATE incidents
       SET status = $2, updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [incidentId, toStatus],
    );
    const row = updated.rows[0];
    if (!row) throw new Error(`Incident ${incidentId} not found after update`);
    return rowToIncident(row);
  }

  /** @node 03.02.04 — Fetch an incident by ID. */
  async getById(id: string): Promise<Incident | null> {
    const result = await this.db.query<IncidentRow>(
      `SELECT * FROM incidents WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? rowToIncident(result.rows[0]) : null;
  }

  /** @node 03.02.05 — List incidents by status. */
  async listByStatus(status: IncidentStatus): Promise<Incident[]> {
    const result = await this.db.query<IncidentRow>(
      `SELECT * FROM incidents WHERE status = $1 ORDER BY created_at ASC`,
      [status],
    );
    return result.rows.map(rowToIncident);
  }

  /**
   * @node 03.02.06 — Recovery: load all in-progress incidents on worker restart.
   * Returns incidents in non-terminal states that need to resume processing.
   */
  async loadInProgress(): Promise<Incident[]> {
    const result = await this.db.query<IncidentRow>(
      `SELECT * FROM incidents
       WHERE status NOT IN ('review_ready', 'rejected', 'escalated', 'abstained')
       ORDER BY created_at ASC`,
    );
    return result.rows.map(rowToIncident);
  }
}

// ─── Errors ───────────────────────────────────────────────────────────────────

/** @node 03.02.01 — Thrown when a state transition is not in the allowed table. */
export class IllegalTransitionError extends Error {
  constructor(
    public readonly from: IncidentStatus,
    public readonly to: IncidentStatus,
  ) {
    super(`Illegal incident transition: ${from} → ${to}`);
    this.name = 'IllegalTransitionError';
  }
}

// ─── Internal row type ────────────────────────────────────────────────────────

interface IncidentRow {
  id: string;
  fingerprint: string;
  status: IncidentStatus;
  title: string;
  failure_report: unknown;
  repository_path: string;
  actor_id: string;
  retry_count: number;
  created_at: Date;
  updated_at: Date;
}

function rowToIncident(row: IncidentRow): Incident {
  return {
    id: row.id,
    fingerprint: row.fingerprint,
    status: row.status,
    title: row.title,
    failureReport: row.failure_report,
    repositoryPath: row.repository_path,
    actorId: row.actor_id,
    retryCount: row.retry_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** @node 03.02.01 — Export transition table for validation (used by tests) */
export { ALLOWED_TRANSITIONS };
