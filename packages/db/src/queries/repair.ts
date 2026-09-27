/**
 * @file packages/db/src/queries/repair.ts
 * @node 07
 * @description Database queries for repair candidates and validation runs.
 */
import type pg from "pg";
import { query } from "../pool.js";
import type { RepairCandidate, RepairCandidateStatus, ValidationRun, GateResult } from "@sis/shared";
import { randomUUID } from "crypto";

export async function createRepairCandidate(
  incidentId: string,
  hypothesisId: string,
  diffContent: string,
  rationale: string,
  changedFiles: string[],
  evidenceCitations: string[],
  pool?: pg.Pool,
): Promise<RepairCandidate> {
  const { rows } = await query<RepairCandidate>(
    `INSERT INTO repair_candidates
       (id, incident_id, hypothesis_id, diff_content, rationale, changed_files, evidence_citations)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      randomUUID(), incidentId, hypothesisId, diffContent, rationale,
      changedFiles, evidenceCitations,
    ],
    pool,
  );
  const row = rows[0];
  if (!row) throw new Error("Failed to create repair candidate");
  return row;
}

export async function updateRepairCandidateStatus(
  id: string,
  status: RepairCandidateStatus,
  candidateCommit?: string,
  pool?: pg.Pool,
): Promise<RepairCandidate> {
  const { rows } = await query<RepairCandidate>(
    `UPDATE repair_candidates
     SET status = $1, candidate_commit = COALESCE($2, candidate_commit), updated_at = now()
     WHERE id = $3 RETURNING *`,
    [status, candidateCommit ?? null, id],
    pool,
  );
  const row = rows[0];
  if (!row) throw new Error(`Repair candidate ${id} not found`);
  return row;
}

export async function getRepairCandidatesByIncident(
  incidentId: string,
  pool?: pg.Pool,
): Promise<RepairCandidate[]> {
  const { rows } = await query<RepairCandidate>(
    "SELECT * FROM repair_candidates WHERE incident_id = $1 ORDER BY created_at DESC",
    [incidentId],
    pool,
  );
  return rows;
}

export async function createValidationRun(
  incidentId: string,
  repairCandidateId: string,
  candidateCommit: string,
  environmentManifestHash: string,
  acceptanceSuiteHash: string,
  bindingHash: string,
  pool?: pg.Pool,
): Promise<ValidationRun> {
  const { rows } = await query<ValidationRun>(
    `INSERT INTO validation_runs
       (id, incident_id, repair_candidate_id, candidate_commit,
        environment_manifest_hash, acceptance_suite_hash, binding_hash, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'in_progress')
     RETURNING *`,
    [
      randomUUID(), incidentId, repairCandidateId, candidateCommit,
      environmentManifestHash, acceptanceSuiteHash, bindingHash,
    ],
    pool,
  );
  const row = rows[0];
  if (!row) throw new Error("Failed to create validation run");
  return row;
}

export async function updateValidationRunStatus(
  id: string,
  status: "review_ready" | "rejected",
  gateResults: GateResult[],
  limitations: string[],
  pool?: pg.Pool,
): Promise<ValidationRun> {
  const { rows } = await query<ValidationRun>(
    `UPDATE validation_runs
     SET status = $1, gate_results = $2, limitations = $3, updated_at = now()
     WHERE id = $4 RETURNING *`,
    [status, JSON.stringify(gateResults), limitations, id],
    pool,
  );
  const row = rows[0];
  if (!row) throw new Error(`Validation run ${id} not found`);
  return row;
}
