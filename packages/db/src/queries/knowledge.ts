/**
 * @file packages/db/src/queries/knowledge.ts
 * @node 10
 * @description Database queries for knowledge records.
 */
import type pg from "pg";
import { query } from "../pool.js";
import type { KnowledgeRecord, KnowledgeStatus } from "@sis/shared";
import { randomUUID } from "crypto";

export async function createKnowledgeRecord(
  incidentId: string,
  originalSymptom: string,
  evidenceBundleId: string | null,
  pool?: pg.Pool,
): Promise<KnowledgeRecord> {
  const { rows } = await query<KnowledgeRecord>(
    `INSERT INTO knowledge_records
       (id, incident_id, original_symptom, evidence_bundle_id, status, version)
     VALUES ($1, $2, $3, $4, 'candidate', 1)
     RETURNING *`,
    [randomUUID(), incidentId, originalSymptom, evidenceBundleId],
    pool,
  );
  const row = rows[0];
  if (!row) throw new Error("Failed to create knowledge record");
  return row;
}

export async function promoteKnowledgeRecord(
  id: string,
  reviewerNotes: string,
  pool?: pg.Pool,
): Promise<KnowledgeRecord> {
  const { rows } = await query<KnowledgeRecord>(
    `UPDATE knowledge_records
     SET status = 'approved', human_review_notes = $1, updated_at = now()
     WHERE id = $2 AND status = 'candidate'
     RETURNING *`,
    [reviewerNotes, id],
    pool,
  );
  const row = rows[0];
  if (!row) throw new Error(`Knowledge record ${id} not found or already approved`);
  return row;
}

export async function supersede(
  oldId: string,
  newRecordId: string,
  pool?: pg.Pool,
): Promise<void> {
  await query(
    "UPDATE knowledge_records SET superseded_by = $1, updated_at = now() WHERE id = $2",
    [newRecordId, oldId],
    pool,
  );
}

export async function getKnowledgeRecordsByIncident(
  incidentId: string,
  pool?: pg.Pool,
): Promise<KnowledgeRecord[]> {
  const { rows } = await query<KnowledgeRecord>(
    "SELECT * FROM knowledge_records WHERE incident_id = $1 ORDER BY version DESC",
    [incidentId],
    pool,
  );
  return rows;
}
