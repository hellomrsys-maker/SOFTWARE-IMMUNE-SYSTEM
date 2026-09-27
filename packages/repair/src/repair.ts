/**
 * @node 07 — Repair Subsystem
 *
 * Implements candidate planning, change authorization, payment repair specification,
 * and recovery planning.
 *
 * Rule 16: increasing timeouts without fixing idempotency is rejected.
 * Rule 17: reverting code does not reverse completed payments — explicit warning required.
 */

// ─── Payment Repair Specification (07.02) ────────────────────────────────────

/**
 * @node 07.02 — Payment Repair Specification
 *
 * The idempotency fix: stable logical key = `${callerId}:${orderId}`
 * Uses INSERT … ON CONFLICT for atomic key reservation.
 */
export interface PaymentRepairSpec {
  stableLogicalKey: string; // `${callerId}:${orderId}`
  atomicReservationSql: string;
  concurrencySafeReuse: boolean;
  conflictingPayloadRejection: boolean;
  unknownOutcomeReconciliation: string;
  duplicateRecordHandlingReport: string;
}

export function createPaymentRepairSpec(callerId: string, orderId: string): PaymentRepairSpec {
  return {
    stableLogicalKey: `${callerId}:${orderId}`,
    atomicReservationSql: `INSERT INTO payments (...) ON CONFLICT (caller_id, idempotency_key) DO NOTHING`,
    concurrencySafeReuse: true,
    conflictingPayloadRejection: true,
    unknownOutcomeReconciliation:
      'Query payments WHERE logical_id = stableKey AND status IN (in_progress, completed)',
    duplicateRecordHandlingReport:
      'Any payments with status=completed and same logicalId beyond the first require manual reconciliation by a human operator',
  };
}

// ─── Change Authorizer (07.03) ────────────────────────────────────────────────

/**
 * @node 07.03 — Change Authorizer
 *
 * AUTHORIZATION IS ENFORCED IN CODE, NOT IN PROMPTS.
 * A model prompt cannot grant permission to modify protected files.
 * This class is the enforcement boundary for file-write scope.
 */

export interface ChangeAuthorizationResult {
  allowed: boolean;
  reason: string;
  requiresHumanApproval: boolean;
}

/** @node 07.03 — Files that the repair agent is NEVER allowed to modify. */
export const PROTECTED_FILES = new Set([
  'tests/acceptance/checkout-correctness.test.ts',
  'src/correctness-spec/invariants.ts',
  // validation package is outside repair scope — enforced by package dependency isolation
]);

/** @node 07.03 — Files that require human approval before modification. */
const REQUIRES_APPROVAL_PATTERNS = [/migrations\/.*\.sql$/, /schema\.ts$/];

/** @node 07.03 — Maximum changed lines allowed without additional review. */
const MAX_CHANGED_LINES = 100;

export class ChangeAuthorizer {
  /**
   * @node 07.03 — Check whether a proposed file change is authorized.
   *
   * Note: authorization enforced here in service code, not in a prompt.
   * No model-generated text can bypass this check.
   */
  authorize(params: {
    filePath: string;
    changedLines: number;
    hasApprovalRecord: boolean;
  }): ChangeAuthorizationResult {
    // Protected files: never modifiable by repair agent
    const normalized = params.filePath.replace(/\\/g, '/');
    if (PROTECTED_FILES.has(normalized)) {
      return {
        allowed: false,
        requiresHumanApproval: false,
        reason: `File "${params.filePath}" is protected and cannot be modified by the repair agent`,
      };
    }

    // Migration files: require human approval
    if (REQUIRES_APPROVAL_PATTERNS.some((p) => p.test(normalized))) {
      if (!params.hasApprovalRecord) {
        return {
          allowed: false,
          requiresHumanApproval: true,
          reason: `File "${params.filePath}" is a migration/schema file and requires human approval before modification`,
        };
      }
    }

    // Max changed lines check
    if (params.changedLines > MAX_CHANGED_LINES) {
      return {
        allowed: false,
        requiresHumanApproval: true,
        reason: `Change scope too large: ${params.changedLines} lines exceeds maximum ${MAX_CHANGED_LINES}`,
      };
    }

    return { allowed: true, reason: 'Authorized', requiresHumanApproval: false };
  }
}

// ─── Candidate Planner (07.01) ────────────────────────────────────────────────

export type RepairAlternative = 'fix_idempotency_key' | 'increase_timeout' | 'suppress_error';

export interface RepairCandidate {
  alternative: RepairAlternative;
  selected: boolean;
  rejectionReason: string | null;
  description: string;
}

/**
 * @node 07.01 — Candidate Planner
 *
 * Rule 16: increasing timeouts without fixing idempotency does NOT fix the
 * confirmed mechanism and is rejected.  The root cause is the missing stable
 * idempotency key — a longer timeout merely delays the duplicate charge.
 */
export class CandidatePlanner {
  planCandidates(rootCause: string): RepairCandidate[] {
    const candidates: RepairCandidate[] = [
      {
        alternative: 'fix_idempotency_key',
        selected: true,
        rejectionReason: null,
        description:
          'Derive idempotency key from orderId: `${callerId}:${orderId}`. ' +
          'This fixes the confirmed mechanism — the payment client must send the same key on every retry.',
      },
      {
        alternative: 'increase_timeout',
        selected: false,
        // Rule 16: reject timeout increase — does not fix confirmed mechanism
        rejectionReason:
          'Increasing the timeout without fixing idempotency does not fix the confirmed mechanism. ' +
          'The duplicate charge occurs because each retry generates a new idempotency key. ' +
          'A longer timeout merely delays the duplicate, it does not prevent it. ' +
          'Rule 16: repair must address the confirmed root cause.',
        description: 'Increase payment client timeout from 5s to 30s',
      },
      {
        alternative: 'suppress_error',
        selected: false,
        rejectionReason:
          'Suppressing the error does not fix the underlying duplicate charge. ' +
          'This is a symptom suppression, not a root cause fix.',
        description: 'Catch and suppress duplicate payment errors',
      },
    ];
    return candidates;
  }
}

// ─── Recovery Planner (07.05) ────────────────────────────────────────────────

export interface RecoveryPlan {
  revertProcedure: string;
  migrationReversibility: string;
  persistedDataReconciliation: string;
  /**
   * @node 07.05 — Rule 17: reverting code does not reverse completed payments.
   *
   * This field is REQUIRED and must always be non-empty.
   * Completed payments that were duplicated require manual human reconciliation.
   * The system NEVER automatically initiates refunds or destructive cleanup.
   */
  irreversibleEffectWarning: string;
  autoRefundInitiated: false; // always false — system never initiates refunds
  humanActionRequired: string;
}

/**
 * @node 07.05 — Recovery Planner
 *
 * Rule 17: no auto-refund or destructive cleanup.
 * The recovery plan explicitly records that reverting code does not reverse
 * completed payments.
 */
export class RecoveryPlanner {
  createPlan(params: {
    candidateCommit: string;
    hasMigrations: boolean;
  }): RecoveryPlan {
    return {
      revertProcedure: `git revert ${params.candidateCommit} && git push`,
      migrationReversibility: params.hasMigrations
        ? 'Migrations included in this change require manual down-migration. Review migration files before reverting.'
        : 'No migrations in this change — code revert is sufficient.',
      persistedDataReconciliation:
        'Any duplicate payment records created before this fix was deployed require manual deduplication. ' +
        'Query: SELECT * FROM payments WHERE logical_id IN (SELECT logical_id FROM payments GROUP BY logical_id HAVING COUNT(*) > 1 AND status = \'completed\')',
      // Rule 17: this warning is always present and non-empty
      irreversibleEffectWarning:
        'IMPORTANT: Reverting this code change does NOT reverse any completed payment transactions. ' +
        'Payment records already persisted in the database are not affected by a code revert. ' +
        'Any duplicate charges that occurred must be reconciled separately by a human operator. ' +
        'The system does not initiate any financial compensation automatically.',
      autoRefundInitiated: false, // the system never initiates refunds
      humanActionRequired:
        'A human operator must review and reconcile any duplicate payment records. ' +
        'Contact the payments team before taking any action on affected transactions.',
    };
  }
}
