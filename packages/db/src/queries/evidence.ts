/**
 * @file packages/db/src/queries/evidence.ts
 * @node 02.05
 * @description Database queries for evidence bundles and records.
 */
import type pg from "pg";
import { query } from "../pool.js";
import type { EvidenceBundle, EvidenceRecord, CollectionGap, EvidenceType } from "@sis/shared";
import { randomUUID } from "crypto";

export async function createEvidenceBundle(
  incidentId: string,
  pool?: pg.Pool,
): Promise<EvidenceBundle> {
  const { rows } = await query<EvidenceBundle>(
    `INSERT INTO evidence_bundles (id, incident_id)
     VALUES ($1, $2) RETURNING *`,
    [randomUUID(), incidentId],
    pool,
  );
  const row = rows[0];
  if (!row) throw new Error("Failed to create evidence bundle");
  return row;
}

export async function addEvidenceRecord(
  bundleId: string,
  evidenceType: EvidenceType,
  sourceRef: string,
  contentHash: string,
  content: unknown,
  originalTimestamp: Date,
  clockOrderUncertain: boolean,
  redacted: boolean,
  pool?: pg.Pool,
): Promise<EvidenceRecord> {
  const { rows } = await query<EvidenceRecord>(
    `INSERT INTO evidence_records
       (id, bundle_id, evidence_type, source_ref, content_hash, content,
        original_timestamp, collection_timestamp, clock_order_uncertain, redacted)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now(), $8, $9)
     RETURNING *`,
    [
      randomUUID(), bundleId, evidenceType, sourceRef, contentHash,
      JSON.stringify(content), originalTimestamp, clockOrderUncertain, redacted,
    ],
    pool,
  );
  const row = rows[0];
  if (!row) throw new Error("Failed to add evidence record");

  // Update bundle's evidence_record_ids list
  await query(
    `UPDATE evidence_bundles
     SET evidence_record_ids = array_append(evidence_record_ids, $1),
         updated_at = now()
     WHERE id = $2`,
    [row.id, bundleId],
    pool,
  );

  return row;
}

/** @node 02.05.06 — Record a collection gap (missing telemetry is a gap, not assumed health) */
export async function addCollectionGap(
  bundleId: string,
  gap: CollectionGap,
  pool?: pg.Pool,
): Promise<void> {
  await query(
    `UPDATE evidence_bundles
     SET collection_gaps = collection_gaps || $1::jsonb,
         updated_at = now()
     WHERE id = $2`,
    [JSON.stringify([gap]), bundleId],
    pool,
  );
}

export async function getEvidenceBundleByIncident(
  incidentId: string,
  pool?: pg.Pool,
): Promise<EvidenceBundle | null> {
  const { rows } = await query<EvidenceBundle>(
    "SELECT * FROM evidence_bundles WHERE incident_id = $1 ORDER BY created_at DESC LIMIT 1",
    [incidentId],
    pool,
  );
  return rows[0] ?? null;
}

export async function getEvidenceRecords(
  bundleId: string,
  pool?: pg.Pool,
): Promise<EvidenceRecord[]> {
  const { rows } = await query<EvidenceRecord>(
    "SELECT * FROM evidence_records WHERE bundle_id = $1 ORDER BY original_timestamp ASC",
    [bundleId],
    pool,
  );
  return rows;
}
