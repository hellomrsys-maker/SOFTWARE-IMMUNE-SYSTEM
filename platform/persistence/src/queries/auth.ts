/**
 * @node 11.02 — Typed query functions for authorization decisions.
 */

import type pg from 'pg';

export type AuthDecision = 'allowed' | 'denied';
export type PermissionType = 'read' | 'workspace_write' | 'approved_command' | 'network' | 'approval';

export interface AuthorizationDecisionRecord {
  id: string;
  incidentId: string | null;
  actorId: string;
  permissionType: PermissionType;
  resource: string;
  decision: AuthDecision;
  reason: string | null;
  createdAt: Date;
}

/**
 * @node 11.02 — Persist an authorization decision.
 *
 * IMPORTANT: Denial records are written BEFORE the denial is returned to the caller.
 * If this write fails, the operation must still be denied (fail-safe).
 * This is the audit boundary for §03.04 Rule 4.
 */
export async function insertAuthDecision(
  client: pg.PoolClient | pg.Pool,
  params: {
    id: string;
    incidentId?: string;
    actorId: string;
    permissionType: PermissionType;
    resource: string;
    decision: AuthDecision;
    reason?: string;
  },
): Promise<AuthorizationDecisionRecord> {
  const res = await client.query<{
    id: string; incident_id: string | null; actor_id: string;
    permission_type: PermissionType; resource: string;
    decision: AuthDecision; reason: string | null; created_at: Date;
  }>(
    `INSERT INTO authorization_decisions
       (id, incident_id, actor_id, permission_type, resource, decision, reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [
      params.id, params.incidentId ?? null, params.actorId,
      params.permissionType, params.resource, params.decision, params.reason ?? null,
    ],
  );
  const row = res.rows[0]!;
  return {
    id: row.id, incidentId: row.incident_id, actorId: row.actor_id,
    permissionType: row.permission_type, resource: row.resource,
    decision: row.decision, reason: row.reason, createdAt: row.created_at,
  };
}

/** @node 11.02 — Get recent auth decisions for an incident (for audit review). */
export async function getAuthDecisions(
  client: pg.PoolClient | pg.Pool,
  incidentId: string,
): Promise<AuthorizationDecisionRecord[]> {
  const res = await client.query<{
    id: string; incident_id: string | null; actor_id: string;
    permission_type: PermissionType; resource: string;
    decision: AuthDecision; reason: string | null; created_at: Date;
  }>(
    `SELECT * FROM authorization_decisions WHERE incident_id=$1 ORDER BY created_at DESC`,
    [incidentId],
  );
  return res.rows.map((row) => ({
    id: row.id, incidentId: row.incident_id, actorId: row.actor_id,
    permissionType: row.permission_type, resource: row.resource,
    decision: row.decision, reason: row.reason, createdAt: row.created_at,
  }));
}
