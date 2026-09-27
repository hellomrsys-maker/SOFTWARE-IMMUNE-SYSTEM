/**
 * @file packages/shared/src/types/repair.ts
 * @node 07
 * @description Repair candidate and recovery planning types.
 */
import { z } from "zod";

export const RepairCandidateStatusSchema = z.enum([
  "proposed",
  "authorized",
  "applied",
  "rejected",
  "reverted",
]);
export type RepairCandidateStatus = z.infer<typeof RepairCandidateStatusSchema>;

export const RepairCandidateSchema = z.object({
  id: z.string().uuid(),
  incident_id: z.string().uuid(),
  hypothesis_id: z.string().uuid(),
  status: RepairCandidateStatusSchema,
  diff_content: z.string(),
  rationale: z.string(),
  evidence_citations: z.array(z.string().uuid()),
  changed_files: z.array(z.string()),
  candidate_commit: z.string().nullable(),
  recovery_notes: z.string(),
  irreversible_effects: z.array(z.string()),
  // node: 07.05 — Code revert does NOT reverse a completed payment
  revert_does_not_reverse_payments: z.boolean().default(true),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date(),
});
export type RepairCandidate = z.infer<typeof RepairCandidateSchema>;
