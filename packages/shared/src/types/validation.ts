/**
 * @file packages/shared/src/types/validation.ts
 * @node 08
 * @description Validation gate result types.
 */
import { z } from "zod";

// node: 08.06
export const ValidationStatusSchema = z.enum(["review_ready", "rejected", "in_progress"]);
export type ValidationStatus = z.infer<typeof ValidationStatusSchema>;

export const GateNameSchema = z.enum([
  "build_and_typecheck",       // 08.02.01
  "existing_test_suite",       // 08.02.02
  "original_failure_scenario", // 08.02.03
  "new_regression_test",       // 08.02.04
  "baseline_comparison",       // 08.02.05
  "business_correctness",      // 08.03
  "safety_and_scope",          // 08.04
  "bounded_performance",       // 08.05
]);
export type GateName = z.infer<typeof GateNameSchema>;

export const GateResultSchema = z.object({
  gate: GateNameSchema,
  passed: z.boolean(),
  skipped: z.boolean().default(false),
  exit_code: z.number().nullable(),
  output: z.string(),
  failure_reason: z.string().nullable(),
  infrastructure_error: z.boolean().default(false),
});
export type GateResult = z.infer<typeof GateResultSchema>;

// node: 08.01 — Validation identity binding
export const ValidationRunSchema = z.object({
  id: z.string().uuid(),
  incident_id: z.string().uuid(),
  repair_candidate_id: z.string().uuid(),
  candidate_commit: z.string(),
  environment_manifest_hash: z.string(),
  acceptance_suite_hash: z.string(),
  binding_hash: z.string(),   // SHA-256 of the three above combined
  status: ValidationStatusSchema,
  gate_results: z.array(GateResultSchema),
  limitations: z.array(z.string()),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date(),
});
export type ValidationRun = z.infer<typeof ValidationRunSchema>;
