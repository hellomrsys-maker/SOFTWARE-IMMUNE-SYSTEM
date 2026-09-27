/**
 * @node 11.02 — Typed query functions for evidence bundles and records.
 */

import type pg from 'pg';

export interface EvidenceBundle {
  id: string;
  incidentId: string;
  sourceManifest: Record<string, unknown>;
  collectionGaps: unknown[];
  checksums: Record<string, string>;
  artifactPath: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EvidenceRecord {
  id: string;
  bundleId: string;
  recordType: string;
  sourceReference: Record<string, unknown>;
  originalTimestamp: Date | null;
  collectionTimestamp: Date;
  clockOrderUncertain: boolean;
  contentHash: string;
  payload: Record<string, unknown>;
  createdAt: Date;
}

/** @node 11.02 — Insert evidence bundle. */
export async function insertEvidenceBundle(
  client: pg.PoolClient | pg.Pool,
  params: {
    id: string;
    incidentId: string;
    sourceManifest: Record<string, unknown>;
    collectionGaps?: unknown[];
    checksums?: Record<string, string>;
    artifactPath?: string;
  },
): Promise<EvidenceBundle> {
  const res = await client.query<BundleRow>(
    `INSERT INTO evidence_bundles
       (id, incident_id, source_manifest, collection_gaps, checksums, artifact_path)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      params.id, params.incidentId,
      JSON.stringify(params.sourceManifest),
      JSON.stringify(params.collectionGaps ?? []),
      JSON.stringify(params.checksums ?? {}),
      params.artifactPath ?? null,
    ],
  );
  return rowToBundle(res.rows[0]!);
}

/** @node 11.02 — Insert evidence record. */
export async function insertEvidenceRecord(
  client: pg.PoolClient | pg.Pool,
  params: {
    id: string;
    bundleId: string;
    recordType: string;
    sourceReference: Record<string, unknown>;
    originalTimestamp?: Date;
    clockOrderUncertain?: boolean;
    contentHash: string;
    payload: Record<string, unknown>;
  },
): Promise<EvidenceRecord> {
  const res = await client.query<RecordRow>(
    `INSERT INTO evidence_records
       (id, bundle_id, record_type, source_reference, original_timestamp,
        clock_order_uncertain, content_hash, payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [
      params.id, params.bundleId, params.recordType,
      JSON.stringify(params.sourceReference),
      params.originalTimestamp ?? null,
      params.clockOrderUncertain ?? false,
      params.contentHash,
      JSON.stringify(params.payload),
    ],
  );
  return rowToRecord(res.rows[0]!);
}

/** @node 11.02 — Get evidence bundle by ID. */
export async function getEvidenceBundle(
  client: pg.PoolClient | pg.Pool,
  id: string,
): Promise<EvidenceBundle | null> {
  const res = await client.query<BundleRow>(`SELECT * FROM evidence_bundles WHERE id=$1`, [id]);
  return res.rows[0] ? rowToBundle(res.rows[0]) : null;
}

/** @node 11.02 — Get evidence records for a bundle. */
export async function getEvidenceRecords(
  client: pg.PoolClient | pg.Pool,
  bundleId: string,
): Promise<EvidenceRecord[]> {
  const res = await client.query<RecordRow>(
    `SELECT * FROM evidence_records WHERE bundle_id=$1 ORDER BY collection_timestamp`,
    [bundleId],
  );
  return res.rows.map(rowToRecord);
}

type BundleRow = {
  id: string; incident_id: string;
  source_manifest: Record<string, unknown>;
  collection_gaps: unknown[];
  checksums: Record<string, string>;
  artifact_path: string | null;
  created_at: Date; updated_at: Date;
};

type RecordRow = {
  id: string; bundle_id: string; record_type: string;
  source_reference: Record<string, unknown>;
  original_timestamp: Date | null;
  collection_timestamp: Date;
  clock_order_uncertain: boolean;
  content_hash: string;
  payload: Record<string, unknown>;
  created_at: Date;
};

function rowToBundle(row: BundleRow): EvidenceBundle {
  return {
    id: row.id, incidentId: row.incident_id,
    sourceManifest: row.source_manifest,
    collectionGaps: row.collection_gaps,
    checksums: row.checksums,
    artifactPath: row.artifact_path,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function rowToRecord(row: RecordRow): EvidenceRecord {
  return {
    id: row.id, bundleId: row.bundle_id, recordType: row.record_type,
    sourceReference: row.source_reference,
    originalTimestamp: row.original_timestamp,
    collectionTimestamp: row.collection_timestamp,
    clockOrderUncertain: row.clock_order_uncertain,
    contentHash: row.content_hash,
    payload: row.payload,
    createdAt: row.created_at,
  };
}
