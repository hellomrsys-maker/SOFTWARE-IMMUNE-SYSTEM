/**
 * @file packages/bob-client/src/simulation.ts
 * @node 04.04
 * @description Local simulation data for Bob API fallback mode.
 * Returns clean, locally simulated mock data structures that mirror the real API response shapes.
 * Used when BOB_API_TOKEN is missing or when a live fetch fails.
 */
import { randomUUID } from "crypto";
import type { BobInvestigateResponse, BobRepairResponse, BobInvestigateRequest, BobRepairRequest } from "./types.js";

export function simulateInvestigateResponse(
  request: BobInvestigateRequest,
): BobInvestigateResponse {
  const baseFindings = {
    repository: [
      {
        finding_id: randomUUID(),
        category: "retry_implementation",
        description: "Payment client generates a new idempotency key on each retry attempt. This means each retry is treated as a new payment by the server.",
        evidence_refs: [],
        confidence: "high" as const,
        suggested_next_action: "Inspect payment-client.ts — idempotency key must be stable across retries",
      },
      {
        finding_id: randomUUID(),
        category: "timeout_handling",
        description: "When AbortController fires, the client retries without checking if the previous attempt committed. The server-side idempotency processor cannot deduplicate because the key changed.",
        evidence_refs: [],
        confidence: "high" as const,
        suggested_next_action: "Generate a stable logical key = callerId + ':' + orderId before the retry loop",
      },
    ],
    runtime: [
      {
        finding_id: randomUUID(),
        category: "duplicate_payment",
        description: "Multiple payment records found for the same order ID with different idempotency keys — consistent with retry-with-unstable-key behavior.",
        evidence_refs: [],
        confidence: "high" as const,
        suggested_next_action: "Query payments table for order_id — count > 1 confirms duplicate",
      },
    ],
    contract_test: [
      {
        finding_id: randomUUID(),
        category: "missing_test",
        description: "No existing test verifies that retries after a timeout do not create duplicate payments. Propose a new regression test with fault injection.",
        evidence_refs: [],
        confidence: "medium" as const,
        suggested_next_action: "Add test: activate delayed_response_after_commit fault, submit payment, assert payment_count == 1",
      },
    ],
    coordinate: [
      {
        finding_id: randomUUID(),
        category: "coordination",
        description: "Root cause identified: unstable idempotency key in payment-client.ts. Repair spec: use stable key = callerId:orderId declared before the retry loop.",
        evidence_refs: [],
        confidence: "high" as const,
        suggested_next_action: "Proceed to repair phase with payment-spec 07.02",
      },
    ],
  };

  const taskType = request.task_type;
  const findings = baseFindings[taskType] ?? baseFindings.coordinate;

  return {
    task_id: randomUUID(),
    task_type: taskType,
    status: "simulated",
    findings,
    candidate_hypotheses: [
      "Payment client generates a new idempotency key on each retry — server treats each retry as a new charge",
    ],
    discriminating_tests: [
      "Activate delayed_response_after_commit fault, submit checkout, confirm payment_count == 1",
    ],
    next_actions: [
      "Fix idempotency key to be stable across retries: const key = `${callerId}:${orderId}`",
    ],
    simulation_mode: true,
    simulation_notice: "Bob API is running in simulation mode. Results are pre-computed for evaluation.",
  };
}

export function simulateRepairResponse(
  _request: BobRepairRequest,
): BobRepairResponse {
  const diff = `--- a/packages/managed-app/src/checkout/payment-client.ts
+++ b/packages/managed-app/src/checkout/payment-client.ts
@@ -58,10 +58,10 @@
+  // node: 07.02 — Stable logical key across attempts (the fix)
+  const idempotencyKey = \`\${config.callerId}:\${orderId}\`;
+
   for (let attempt = 1; attempt <= config.maxRetries + 1; attempt++) {
-    // DEFECT: A new random UUID is generated on EVERY attempt.
-    const idempotencyKey = randomUUID(); // BUG: new key on each attempt
-
     const body = JSON.stringify({`;

  return {
    task_id: randomUUID(),
    status: "simulated",
    diff_content: diff,
    rationale: "The idempotency key must be stable across all retry attempts for the same logical payment. Moving the key declaration outside the loop and deriving it from callerId+orderId ensures the server can deduplicate retries correctly.",
    changed_files: ["packages/managed-app/src/checkout/payment-client.ts"],
    simulation_mode: true,
    simulation_notice: "Bob API is running in simulation mode. Repair diff is pre-computed for evaluation.",
  };
}
