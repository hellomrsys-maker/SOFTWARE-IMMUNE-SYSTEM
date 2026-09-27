/**
 * @file packages/shared/src/types/authorization.ts
 * @node 03.04
 * @description Authorization engine types.
 * SECURITY NOTE: Authorization is enforced in TypeScript service code, not in prompts or
 * model-generated instructions. This file defines the types that the authorization engine
 * uses to record every decision before it is returned to the caller.
 */
import { z } from "zod";

export const AuthDecisionSchema = z.enum(["allowed", "denied"]);
export type AuthDecision = z.infer<typeof AuthDecisionSchema>;

export const AuthActionSchema = z.enum([
  "read",
  "workspace_write",
  "execute_command",
  "network_access",
  "approve",
]);
export type AuthAction = z.infer<typeof AuthActionSchema>;

// node: 03.04.07 — Denial audit record
export const AuthorizationDecisionRecordSchema = z.object({
  id: z.string().uuid(),
  incident_id: z.string().uuid().nullable(),
  actor_id: z.string(),
  action: AuthActionSchema,
  resource: z.string(),
  decision: AuthDecisionSchema,
  reason: z.string(),
  expires_at: z.coerce.date().nullable(),
  created_at: z.coerce.date(),
});
export type AuthorizationDecisionRecord = z.infer<typeof AuthorizationDecisionRecordSchema>;
