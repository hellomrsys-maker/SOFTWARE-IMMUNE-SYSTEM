/**
 * @node 11.02 — Typed query functions for incidents and incident transitions.
 */

import type pg from 'pg';

export type IncidentStatus =
  | 'created' | 'observing' | 'diagnosing' | 'reproducing'
  | 'repairing' | 'validating' | 'review_ready'
  | 'rejected' | 'escalated' | 'abstained';

export interface Incident {
  id: string;
  fingerprint: string;
  status: IncidentStatus;
  title: string;
  failureReport: Record<string, unknown>;
  repositoryPath: string;
  actorId: string;
  retryCount: number;
  createdAt: Date;
  updatedAt: Date;
}

/** @node 11.02 — Insert a new incident record. */
export async function insertIncident(
  client: pg.PoolClient | pg.Pool,
  params: {
    id: string;
    fingerprint: string;
    title: string;
    failureReport: Record<string, unknown>;
    repositoryPath: string;
    actorId: string;
  },
): Promise<Incident> {
  const res = await client.query<{
    id: string; fingerprint: string; status: IncidentStatus;
    title: string; failure_report: Record<string, unknown>;
    repository_path: string; actor_id: string; retry_count: number;
    created_at: Date; updated_at: Date;
  }>(
    `INSERT INTO incidents (id, fingerprint, status, title, failure_report, repository_path, actor_id)
     VALUES ($1, $2, 'created', $3, $4, $5, $6)
     RETURNING *`,
    [params.id, params.fingerprint, params.title,
     JSON.stringify(params.failureReport), params.repositoryPath, params.actorId],
  );
  return rowToIncident(res.rows[0]!);
}

/** @node 11.02 — Fetch incident by ID. */
export async function getIncident(
  client: pg.PoolClient | pg.Pool,
  id: string,
): Promise<Incident | null> {
  const res = await client.query<{
    id: string; fingerprint: string; status: IncidentStatus;
    title: string; failure_report: Record<string, unknown>;
    repository_path: string; actor_id: string; retry_count: number;
    created_at: Date; updated_at: Date;
  }>(`SELECT * FROM incidents WHERE id = $1`, [id]);
  return res.rows[0] ? rowToIncident(res.rows[0]) : null;
}

/** @node 11.02 — Fetch incident by fingerprint (for deduplication). */
export async function getIncidentByFingerprint(
  client: pg.PoolClient | pg.Pool,
  fingerprint: string,
): Promise<Incident | null> {
  const res = await client.query<{
    id: string; fingerprint: string; status: IncidentStatus;
    title: string; failure_report: Record<string, unknown>;
    repository_path: string; actor_id: string; retry_count: number;
    created_at: Date; updated_at: Date;
  }>(`SELECT * FROM incidents WHERE fingerprint = $1 LIMIT 1`, [fingerprint]);
  return res.rows[0] ? rowToIncident(res.rows[0]) : null;
}

/** @node 11.02 — Update incident status and bump retry_count. */
export async function updateIncidentStatus(
  client: pg.PoolClient | pg.Pool,
  id: string,
  status: IncidentStatus,
  incrementRetry = false,
): Promise<Incident | null> {
  const res = await client.query<{
    id: string; fingerprint: string; status: IncidentStatus;
    title: string; failure_report: Record<string, unknown>;
    repository_path: string; actor_id: string; retry_count: number;
    created_at: Date; updated_at: Date;
  }>(
    `UPDATE incidents
     SET status = $2, retry_count = retry_count + $3, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, status, incrementRetry ? 1 : 0],
  );
  return res.rows[0] ? rowToIncident(res.rows[0]) : null;
}

/** @node 11.02 — Insert an incident state transition record. */
export async function insertIncidentTransition(
  client: pg.PoolClient | pg.Pool,
  params: { incidentId: string; fromStatus: string; toStatus: string; actorId: string; reason?: string },
): Promise<void> {
  await client.query(
    `INSERT INTO incident_transitions (incident_id, from_status, to_status, actor_id, reason)
     VALUES ($1, $2, $3, $4, $5)`,
    [params.incidentId, params.fromStatus, params.toStatus, params.actorId, params.reason ?? null],
  );
}

/** @node 11.02 — Find stalled incidents (stuck for > staleMinutes). */
export async function findStalledIncidents(
  client: pg.PoolClient | pg.Pool,
  staleMinutes = 60,
): Promise<Incident[]> {
  const res = await client.query<{
    id: string; fingerprint: string; status: IncidentStatus;
    title: string; failure_report: Record<string, unknown>;
    repository_path: string; actor_id: string; retry_count: number;
    created_at: Date; updated_at: Date;
  }>(
    `SELECT * FROM incidents
     WHERE status NOT IN ('review_ready','rejected','escalated','abstained')
       AND updated_at < now() - ($1 || ' minutes')::interval`,
    [staleMinutes],
  );
  return res.rows.map(rowToIncident);
}

function rowToIncident(row: {
  id: string; fingerprint: string; status: IncidentStatus;
  title: string; failure_report: Record<string, unknown>;
  repository_path: string; actor_id: string; retry_count: number;
  created_at: Date; updated_at: Date;
}): Incident {
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
