/**
 * @node 02.05 — Evidence preparation types and shared schemas.
 *
 * Rule 10: every evidence record must carry originalTimestamp, collectionTimestamp,
 * and clockOrderUncertain.
 */

import { z } from 'zod';

// ─── Timestamped evidence schema ──────────────────────────────────────────────

/**
 * @node 02.05.04 — Timestamped evidence.
 *
 * clockOrderUncertain is true when we cannot guarantee that originalTimestamp
 * precedes collectionTimestamp (e.g., clock skew, log buffering delay).
 */
export const TimestampedEvidenceSchema = z.object({
  originalTimestamp: z.string().datetime().nullable(),
  collectionTimestamp: z.string().datetime(),
  clockOrderUncertain: z.boolean(),
});
export type TimestampedEvidence = z.infer<typeof TimestampedEvidenceSchema>;

// ─── Collection gap ───────────────────────────────────────────────────────────

/**
 * @node 02.05 — Collection gap record.
 *
 * Rule 8: missing telemetry is recorded as a gap, NOT assumed healthy.
 * A gap record is written whenever a collector encounters an error.
 */
export const CollectionGapSchema = z.object({
  sensorId: z.string(),
  collectorType: z.string(),
  reason: z.string(),
  attemptedAt: z.string().datetime(),
});
export type CollectionGap = z.infer<typeof CollectionGapSchema>;

// ─── Evidence record types ────────────────────────────────────────────────────

export const EvidenceRecordTypeSchema = z.enum([
  'log', 'trace', 'metric', 'business_state',
  'repository', 'source_index', 'test_observation',
  'document',
]);
export type EvidenceRecordType = z.infer<typeof EvidenceRecordTypeSchema>;

export const EvidenceRecordSchema = z.object({
  id: z.string().uuid(),
  recordType: EvidenceRecordTypeSchema,
  sourceReference: z.object({
    service: z.string().optional(),
    file: z.string().optional(),
    line: z.number().optional(),
    commit: z.string().optional(),
  }),
  timestamps: TimestampedEvidenceSchema,
  contentHash: z.string().length(64),
  payload: z.record(z.unknown()),
});
export type EvidenceRecord = z.infer<typeof EvidenceRecordSchema>;

// ─── Evidence bundle ──────────────────────────────────────────────────────────

export const EvidenceBundleSchema = z.object({
  id: z.string().uuid(),
  incidentId: z.string().uuid(),
  sourceManifest: z.record(z.unknown()),
  records: z.array(EvidenceRecordSchema),
  collectionGaps: z.array(CollectionGapSchema),
  checksums: z.record(z.string()),
});
export type EvidenceBundle = z.infer<typeof EvidenceBundleSchema>;

// ─── Identity correlation ─────────────────────────────────────────────────────

/**
 * @node 02.05.05 — Identity correlation links.
 *
 * Connects evidence records to incident, trace, request-attempt, and
 * logical business-operation identities.
 */
export interface IdentityCorrelation {
  incidentId: string;
  traceId: string | null;
  requestAttemptId: string | null;
  logicalOperationId: string | null;
}
