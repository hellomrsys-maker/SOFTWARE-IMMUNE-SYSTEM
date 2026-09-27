/**
 * @file packages/shared/src/types/hypotheses.ts
 * @node 04.03
 * @description Hypothesis adjudication types.
 * IMPORTANT: Exactly four status values are permitted — enforced by zod enum and TypeScript union.
 * No other values may be added without changing this file and all status-assignment logic.
 */
import { z } from "zod";

// node: 04.03.07 — Exactly four permitted diagnostic statuses
export const HypothesisStatusSchema = z.enum([
  "Supported",
  "Contradicted",
  "Reproduced within stated conditions",
  "Insufficient evidence",
]);
export type HypothesisStatus = z.infer<typeof HypothesisStatusSchema>;

export const HypothesisSchema = z.object({
  id: z.string().uuid(),
  incident_id: z.string().uuid(),
  claim: z.string(),
  status: HypothesisStatusSchema,
  evidence_refs: z.array(z.string().uuid()),  // must be non-empty for "Supported"
  contradicting_evidence_refs: z.array(z.string().uuid()),
  missing_evidence_types: z.array(z.string()),
  alternative_explanations: z.array(z.string()),
  experiment_requirements: z.array(z.string()),
  is_duplicate: z.boolean().default(false),
  duplicate_of: z.string().uuid().nullable(),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date(),
});
export type Hypothesis = z.infer<typeof HypothesisSchema>;
