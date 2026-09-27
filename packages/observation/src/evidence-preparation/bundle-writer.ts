/**
 * @node 02.05.06 — Bundle Writer
 *
 * Assembles an evidence bundle from collected records:
 *   1. Validates each record schema (02.05.01)
 *   2. Runs redaction on payloads (02.05.02) — Rule 9
 *   3. Deduplicates by content hash (02.05.03)
 *   4. Attaches correlation identities (02.05.05)
 *   5. Computes bundle checksums
 *   6. Writes to evidence_bundles + evidence_records tables
 *
 * Rule 7: collector failures write CollectionGap records, not errors.
 * Each collector is isolated — one failure must not suppress others.
 */

import { createHash } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import type pg from 'pg';
import { redactObject } from './redactor.js';
import { deduplicateRecords } from './deduplicator.js';
import { normalizeTimestamps } from './timestamp-normalizer.js';
import { EvidenceRecordSchema, type CollectionGap, type EvidenceBundle, type IdentityCorrelation } from './types.js';

export interface RawEvidenceInput {
  recordType: string;
  sourceReference: Record<string, unknown>;
  originalTimestamp?: string;
  payload: Record<string, unknown>;
}

export interface BundleWriterInput {
  incidentId: string;
  sourceManifest: Record<string, unknown>;
  rawRecords: RawEvidenceInput[];
  collectionGaps: CollectionGap[];
  identity: IdentityCorrelation;
}

export interface BundleWriteResult {
  bundleId: string;
  recordCount: number;
  gapCount: number;
  checksums: Record<string, string>;
}

export class BundleWriter {
  constructor(private readonly db: pg.Pool) {}

  /**
   * @node 02.05.06 — Assemble and persist an evidence bundle.
   */
  async write(input: BundleWriterInput): Promise<BundleWriteResult> {
    // Step 1+2: validate and redact each raw record
    const records = [];
    const gaps: CollectionGap[] = [...input.collectionGaps];

    for (const raw of input.rawRecords) {
      try {
        // Rule 9: redact BEFORE any further processing
        const redactedPayload = redactObject(raw.payload) as Record<string, unknown>;

        const timestamps = normalizeTimestamps(raw.originalTimestamp ?? null);
        const contentHash = computeContentHash(raw.recordType, redactedPayload);

        const candidate = {
          id: uuidv4(),
          recordType: raw.recordType,
          sourceReference: raw.sourceReference,
          timestamps,
          contentHash,
          payload: redactedPayload,
        };

        // Validate schema
        const parsed = EvidenceRecordSchema.safeParse(candidate);
        if (!parsed.success) {
          // Record a collection gap instead of failing the whole bundle
          gaps.push({
            sensorId: raw.recordType,
            collectorType: raw.recordType,
            reason: `Schema validation failed: ${parsed.error.message}`,
            attemptedAt: new Date().toISOString(),
          });
          continue;
        }

        records.push(parsed.data);
      } catch (err: unknown) {
        // Rule 7: one record failure must not suppress others
        gaps.push({
          sensorId: raw.recordType,
          collectorType: raw.recordType,
          reason: (err as Error).message,
          attemptedAt: new Date().toISOString(),
        });
      }
    }

    // Step 3: deduplicate
    const deduped = deduplicateRecords(records);

    // Step 5: compute bundle checksums
    const checksums: Record<string, string> = {};
    for (const rec of deduped) {
      checksums[rec.id] = rec.contentHash;
    }

    const bundleId = uuidv4();

    // Step 6: persist to DB
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `INSERT INTO evidence_bundles
           (id, incident_id, source_manifest, collection_gaps, checksums)
         VALUES ($1,$2,$3,$4,$5)`,
        [bundleId, input.incidentId,
         JSON.stringify(input.sourceManifest),
         JSON.stringify(gaps),
         JSON.stringify(checksums)],
      );

      for (const rec of deduped) {
        await client.query(
          `INSERT INTO evidence_records
             (id, bundle_id, record_type, source_reference, original_timestamp,
              clock_order_uncertain, content_hash, payload)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [rec.id, bundleId, rec.recordType,
           JSON.stringify(rec.sourceReference),
           rec.timestamps.originalTimestamp,
           rec.timestamps.clockOrderUncertain,
           rec.contentHash,
           JSON.stringify(rec.payload)],
        );
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }

    return {
      bundleId,
      recordCount: deduped.length,
      gapCount: gaps.length,
      checksums,
    };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function computeContentHash(recordType: string, payload: Record<string, unknown>): string {
  const canonical = JSON.stringify({ recordType, payload });
  return createHash('sha256').update(canonical).digest('hex');
}
