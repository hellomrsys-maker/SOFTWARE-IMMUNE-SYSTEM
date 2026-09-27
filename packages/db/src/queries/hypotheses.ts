/**
 * @file packages/db/src/queries/hypotheses.ts
 * @node 04.03
 * @description Database queries for hypothesis records.
 */
import type pg from "pg";
import { query } from "../pool.js";
import type { Hypothesis, HypothesisStatus } from "@sis/shared";
import { randomUUID } from "crypto";

export async function createHypothesis(
  incidentId: string,
  claim: string,
  pool?: pg.Pool,
): Promise<Hypothesis> {
  const { rows } = await query<Hypothesis>(
    `INSERT INTO hypotheses (id, incident_id, claim, status)
     VALUES ($1, $2, $3, 'Insufficient evidence')
     RETURNING *`,
    [randomUUID(), incidentId, claim],
    pool,
  );
  const row = rows[0];
  if (!row) throw new Error("Failed to create hypothesis");
  return row;
}

export async function updateHypothesisStatus(
  id: string,
  status: HypothesisStatus,
  evidenceRefs: string[],
  contradictingRefs: string[],
  pool?: pg.Pool,
): Promise<Hypothesis> {
  const { rows } = await query<Hypothesis>(
    `UPDATE hypotheses
     SET status = $1,
         evidence_refs = $2,
         contradicting_evidence_refs = $3,
         updated_at = now()
     WHERE id = $4
     RETURNING *`,
    [status, evidenceRefs, contradictingRefs, id],
    pool,
  );
  const row = rows[0];
  if (!row) throw new Error(`Hypothesis ${id} not found`);
  return row;
}

export async function getHypothesesByIncident(
  incidentId: string,
  pool?: pg.Pool,
): Promise<Hypothesis[]> {
  const { rows } = await query<Hypothesis>(
    "SELECT * FROM hypotheses WHERE incident_id = $1 ORDER BY created_at ASC",
    [incidentId],
    pool,
  );
  return rows;
}
