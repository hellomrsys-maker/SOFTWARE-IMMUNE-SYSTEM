/**
 * @file packages/db/src/queries/authorization.ts
 * @node 03.04, 03.04.07
 * @description Database queries for authorization decisions.
 * SECURITY: Every denial record is written to the database BEFORE the denial response
 * is returned to the caller. This is enforced in code, not in a prompt or instruction,
 * so no model-generated text can bypass or defer the audit record write.
 */
import type pg from "pg";
import { query } from "../pool.js";
import type { AuthorizationDecisionRecord, AuthAction, AuthDecision } from "@sis/shared";
import { randomUUID } from "crypto";

export async function recordAuthorizationDecision(
  incidentId: string | null,
  actorId: string,
  action: AuthAction,
  resource: string,
  reason: string,
  decision: AuthDecision,
  expiresAt: Date | null = null,
  pool?: pg.Pool,
): Promise<AuthorizationDecisionRecord> {
  const { rows } = await query<AuthorizationDecisionRecord>(
    `INSERT INTO authorization_decisions
       (id, incident_id, actor_id, action, resource, decision, reason, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [randomUUID(), incidentId, actorId, action, resource, decision, reason, expiresAt],
    pool,
  );
  const row = rows[0];
  if (!row) throw new Error("Failed to record authorization decision");
  return row;
}

export async function listDenials(
  incidentId: string,
  pool?: pg.Pool,
): Promise<AuthorizationDecisionRecord[]> {
  const { rows } = await query<AuthorizationDecisionRecord>(
    "SELECT * FROM authorization_decisions WHERE incident_id = $1 AND decision = 'denied' ORDER BY created_at DESC",
    [incidentId],
    pool,
  );
  return rows;
}
