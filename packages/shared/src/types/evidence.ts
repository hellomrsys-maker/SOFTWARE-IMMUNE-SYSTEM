/**
 * @file packages/shared/src/types/evidence.ts
 * @node 02.05
 * @description Evidence bundle types with timestamp normalization and collection gap tracking.
 */
import { z } from "zod";

// node: 02.05.04 — Timestamped evidence with clock uncertainty
export const TimestampedEvidenceSchema = z.object({
  originalTimestamp: z.coerce.date(),
  collectionTimestamp: z.coerce.date(),
  clockOrderUncertain: z.boolean(),
});
export type TimestampedEvidence = z.infer<typeof TimestampedEvidenceSchema>;

// node: 02.05.06 — Collection gap (missing telemetry is a gap, not assumed health)
export const CollectionGapSchema = z.object({
  sensor_type: z.string(),
  reason: z.string(),
  occurred_at: z.coerce.date(),
});
export type CollectionGap = z.infer<typeof CollectionGapSchema>;

// node: 02.05 — Evidence record types
export const EvidenceTypeSchema = z.enum([
  "log",
  "trace",
  "metric",
  "business_state",
  "source_file",
  "git_diff",
  "test_result",
  "document",
]);
export type EvidenceType = z.infer<typeof EvidenceTypeSchema>;

export const EvidenceRecordSchema = z.object({
  id: z.string().uuid(),
  bundle_id: z.string().uuid(),
  evidence_type: EvidenceTypeSchema,
  source_ref: z.string(),
  content_hash: z.string(),
  content: z.unknown(),
  original_timestamp: z.coerce.date(),
  collection_timestamp: z.coerce.date(),
  clock_order_uncertain: z.boolean(),
  redacted: z.boolean(),
  created_at: z.coerce.date(),
});
export type EvidenceRecord = z.infer<typeof EvidenceRecordSchema>;

// node: 02.05.06 — Evidence bundle
export const EvidenceBundleSchema = z.object({
  id: z.string().uuid(),
  incident_id: z.string().uuid(),
  source_manifest: z.array(z.string()),
  evidence_record_ids: z.array(z.string().uuid()),
  collection_gaps: z.array(CollectionGapSchema),
  artifact_checksums: z.record(z.string()),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date(),
});
export type EvidenceBundle = z.infer<typeof EvidenceBundleSchema>;
