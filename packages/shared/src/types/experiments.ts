/**
 * @file packages/shared/src/types/experiments.ts
 * @node 06
 * @description Experiment specification and reproduction types.
 */
import { z } from "zod";

// node: 06.01 — Experiment specification
export const ExperimentSpecSchema = z.object({
  hypothesis_id: z.string().uuid(),
  hypothesis_claim: z.string(),
  env_vars: z.record(z.string()),
  controlled_fault: z.string(),          // fault type to activate
  input_sequence: z.array(z.unknown()),  // ordered requests to submit
  expected_observation: z.string(),
  time_limit_seconds: z.number().positive(),
  resource_limit_mb: z.number().positive(),
  trial_count: z.number().int().positive().default(3),
});
export type ExperimentSpec = z.infer<typeof ExperimentSpecSchema>;

export const ExperimentStatusSchema = z.enum([
  "pending",
  "running",
  "reproduced",
  "not_reproduced",
  "error",
]);
export type ExperimentStatus = z.infer<typeof ExperimentStatusSchema>;

// node: 06 — Experiment record
export const ExperimentSchema = z.object({
  id: z.string().uuid(),
  incident_id: z.string().uuid(),
  hypothesis_id: z.string().uuid(),
  spec: ExperimentSpecSchema,
  status: ExperimentStatusSchema,
  environment_manifest: z.record(z.unknown()).nullable(),
  trial_results: z.array(z.unknown()),
  causal_conclusion: z.string().nullable(),
  causal_conclusion_limits: z.array(z.string()),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date(),
});
export type Experiment = z.infer<typeof ExperimentSchema>;

// node: 06.05 — Regression test artifact
export const RegressionTestSchema = z.object({
  id: z.string().uuid(),
  incident_id: z.string().uuid(),
  experiment_id: z.string().uuid(),
  test_content: z.string(),
  test_file_path: z.string(),
  content_hash: z.string(),   // SHA-256 of test_content
  verified_fails_on_defective_baseline: z.boolean(),
  execution_evidence: z.string(),
  reproduction_command: z.string(),
  created_at: z.coerce.date(),
});
export type RegressionTest = z.infer<typeof RegressionTestSchema>;
