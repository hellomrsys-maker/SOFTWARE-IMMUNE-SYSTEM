/**
 * @node 11.02 — Typed query functions for validation runs and approval records.
 */

import type pg from 'pg';

export type ValidationStatus = 'pending' | 'running' | 'review_ready' | 'rejected' | 'infra_error';

export interface ValidationRun {
  id: string;
  incidentId: string;
  repairCandidateId: string | null;
  identityHash: string;
  candidateCommit: string;
  environmentManifestHash: string;
  acceptanceSuiteHash: string;
  gateResults: unknown[];
  status: ValidationStatus;
  limitations: string[];
  createdAt: Date;
  updatedAt: Date;
}

/** @node 11.02 — Insert a validation run. */
export async function insertValidationRun(
  client: pg.PoolClient | pg.Pool,
  params: {
    id: string;
    incidentId: string;
    repairCandidateId?: string;
    identityHash: string;
    candidateCommit: string;
    environmentManifestHash: string;
    acceptanceSuiteHash: string;
  },
): Promise<ValidationRun> {
  const res = await client.query<VRunRow>(
    `INSERT INTO validation_runs
       (id, incident_id, repair_candidate_id, identity_hash, candidate_commit,
        environment_manifest_hash, acceptance_suite_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [
      params.id, params.incidentId, params.repairCandidateId ?? null,
      params.identityHash, params.candidateCommit,
      params.environmentManifestHash, params.acceptanceSuiteHash,
    ],
  );
  return rowToRun(res.rows[0]!);
}

/** @node 11.02 — Update validation run status and gate results. */
export async function updateValidationRun(
  client: pg.PoolClient | pg.Pool,
  id: string,
  update: { status?: ValidationStatus; gateResults?: unknown[]; limitations?: string[] },
): Promise<void> {
  const sets: string[] = ['updated_at=now()'];
  const vals: unknown[] = [id];
  let i = 2;
  if (update.status) { sets.push(`status=$${i++}`); vals.push(update.status); }
  if (update.gateResults) { sets.push(`gate_results=$${i++}`); vals.push(JSON.stringify(update.gateResults)); }
  if (update.limitations) { sets.push(`limitations=$${i++}`); vals.push(update.limitations); }
  await client.query(`UPDATE validation_runs SET ${sets.join(',')} WHERE id=$1`, vals);
}

/** @node 11.02 — Get validation run by ID. */
export async function getValidationRun(
  client: pg.PoolClient | pg.Pool,
  id: string,
): Promise<ValidationRun | null> {
  const res = await client.query<VRunRow>(`SELECT * FROM validation_runs WHERE id=$1`, [id]);
  return res.rows[0] ? rowToRun(res.rows[0]) : null;
}

type VRunRow = {
  id: string; incident_id: string; repair_candidate_id: string | null;
  identity_hash: string; candidate_commit: string;
  environment_manifest_hash: string; acceptance_suite_hash: string;
  gate_results: unknown[]; status: ValidationStatus;
  limitations: string[]; created_at: Date; updated_at: Date;
};

function rowToRun(row: VRunRow): ValidationRun {
  return {
    id: row.id, incidentId: row.incident_id, repairCandidateId: row.repair_candidate_id,
    identityHash: row.identity_hash, candidateCommit: row.candidate_commit,
    environmentManifestHash: row.environment_manifest_hash,
    acceptanceSuiteHash: row.acceptance_suite_hash,
    gateResults: row.gate_results, status: row.status,
    limitations: row.limitations,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
