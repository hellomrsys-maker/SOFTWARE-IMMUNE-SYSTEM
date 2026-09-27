/**
 * @file packages/shared/src/types/knowledge.ts
 * @node 10
 * @description Knowledge record types.
 * NOTE: Memory alone never authorizes repair — enforced in @sis/reporter KnowledgeGovernor.
 */
import { z } from "zod";

// node: 10.04
export const KnowledgeStatusSchema = z.enum(["candidate", "approved"]);
export type KnowledgeStatus = z.infer<typeof KnowledgeStatusSchema>;

export const KnowledgeRecordSchema = z.object({
  id: z.string().uuid(),
  incident_id: z.string().uuid(),
  status: KnowledgeStatusSchema,
  version: z.number().int().positive(),
  superseded_by: z.string().uuid().nullable(),
  original_symptom: z.string(),
  evidence_bundle_id: z.string().uuid().nullable(),
  tested_hypotheses: z.array(z.string().uuid()),
  successful_repair_id: z.string().uuid().nullable(),
  rejected_repair_ids: z.array(z.string().uuid()),
  validation_run_id: z.string().uuid().nullable(),
  human_review_notes: z.string().nullable(),
  prevention_artifacts: z.array(z.string()),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date(),
});
export type KnowledgeRecord = z.infer<typeof KnowledgeRecordSchema>;
