/**
 * @file packages/shared/src/types/incidents.ts
 * @node 03.02
 * @description Incident state machine types.
 */
import { z } from "zod";

// node: 03.02.01 — Incident states
export const IncidentStateSchema = z.enum([
  "created",
  "observing",
  "diagnosing",
  "reproducing",
  "repairing",
  "validating",
  "review_ready",
  "rejected",
  "escalated",
  "abstained",
]);
export type IncidentState = z.infer<typeof IncidentStateSchema>;

// node: 03.02
export const IncidentSchema = z.object({
  id: z.string().uuid(),
  fingerprint: z.string(),
  state: IncidentStateSchema,
  repository_path: z.string(),
  failure_report: z.string(),
  metadata: z.record(z.unknown()).optional(),
  active_repair_lease_id: z.string().uuid().nullable(),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date(),
});
export type Incident = z.infer<typeof IncidentSchema>;

export const CreateIncidentInputSchema = z.object({
  repository_path: z.string().min(1),
  failure_report: z.string().min(1),
  metadata: z.record(z.unknown()).optional(),
});
export type CreateIncidentInput = z.infer<typeof CreateIncidentInputSchema>;

// node: 03.02.02 — Valid state transitions (hardcoded — not configurable at runtime)
export const VALID_TRANSITIONS: Readonly<Record<IncidentState, readonly IncidentState[]>> = {
  created: ["observing"],
  observing: ["diagnosing", "escalated", "abstained"],
  diagnosing: ["reproducing", "escalated", "abstained"],
  reproducing: ["repairing", "escalated", "abstained"],
  repairing: ["validating", "escalated"],
  validating: ["review_ready", "rejected", "repairing", "escalated"],
  review_ready: ["escalated"],
  rejected: [],
  escalated: [],
  abstained: [],
} as const;
