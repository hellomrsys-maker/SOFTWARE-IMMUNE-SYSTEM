/**
 * @node 01.04 — Correctness Specification
 *
 * Canonical type definitions, invariant descriptors, and assertion helpers for the
 * managed application.  These types are consumed by the protected acceptance tests
 * (01.04.07) and by the validation subsystem (08.03).
 *
 * IMPORTANT: This file must not be modified by the repair agent.
 * Any modification is detected by the safety gate checker (08.04).
 */

import { z } from 'zod';

// ─── Order state machine ────────────────────────────────────────────────────

/** @node 01.04.02 — Order transition rules */
export const OrderStatus = z.enum([
  'pending',
  'attempted',
  'confirmed',
  'uncertain_outcome',
]);
export type OrderStatus = z.infer<typeof OrderStatus>;

/** @node 01.04.01 — API contract: checkout request */
export const CheckoutRequestSchema = z.object({
  customerId: z.string().min(1),
  amount: z.number().positive(),
  currency: z.string().length(3),
  orderId: z.string().uuid().optional(), // caller-supplied idempotency hint
});
export type CheckoutRequest = z.infer<typeof CheckoutRequestSchema>;

/** @node 01.04.01 — API contract: checkout response */
export const CheckoutResponseSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('confirmed'),
    orderId: z.string().uuid(),
    paymentId: z.string().uuid(),
  }),
  z.object({
    status: z.literal('uncertain_outcome'),
    orderId: z.string().uuid(),
    message: z.string(),
  }),
  z.object({
    status: z.literal('failed'),
    orderId: z.string().uuid().optional(),
    message: z.string(),
  }),
]);
export type CheckoutResponse = z.infer<typeof CheckoutResponseSchema>;

// ─── Payment state machine ──────────────────────────────────────────────────

/** @node 01.04.02 — Payment transition rules */
export const PaymentStatus = z.enum(['in_progress', 'completed', 'failed']);
export type PaymentStatus = z.infer<typeof PaymentStatus>;

/** @node 01.04.01 — API contract: payment request */
export const PaymentRequestSchema = z.object({
  logicalId: z.string().min(1),   // stable business identity (callerId:orderId)
  idempotencyKey: z.string().min(1),
  callerId: z.string().min(1),
  operation: z.string().min(1),
  amount: z.number().positive(),
  currency: z.string().length(3),
});
export type PaymentRequest = z.infer<typeof PaymentRequestSchema>;

/** @node 01.04.01 — API contract: payment response */
export const PaymentResponseSchema = z.object({
  paymentId: z.string().uuid(),
  status: PaymentStatus,
  amount: z.number().positive(),
  currency: z.string().length(3),
  idempotencyKey: z.string(),
  createdAt: z.string().datetime(),
});
export type PaymentResponse = z.infer<typeof PaymentResponseSchema>;

// ─── Invariant descriptors ──────────────────────────────────────────────────

/**
 * @node 01.04.04 — No-duplicate-logical-charge invariant.
 *
 * For any single logical business operation (identified by callerId + orderId),
 * there must be at most ONE payment record in a 'completed' state.
 * Violation indicates a duplicate charge.
 */
export interface NoDuplicateLogicalChargeInvariant {
  readonly name: 'no_duplicate_logical_charge';
  readonly description: string;
  check(payments: Array<{ logicalId: string; status: string }>): InvariantViolation[];
}

/**
 * @node 01.04.05 — Amount and currency consistency invariant.
 *
 * The amount and currency of a completed payment must exactly match the original
 * order.  Partial charges or currency mismatches are violations.
 */
export interface AmountCurrencyConsistencyInvariant {
  readonly name: 'amount_currency_consistency';
  readonly description: string;
  check(order: { amount: number; currency: string }, payment: { amount: number; currency: string }): InvariantViolation[];
}

/**
 * @node 01.04.06 — Timeout uncertainty preservation invariant.
 *
 * When a payment request times out before a definitive server response is received,
 * the order must transition to 'uncertain_outcome', NOT to 'confirmed' or 'failed'.
 * Silently resolving a timeout as either outcome is a violation.
 */
export interface TimeoutUncertaintyPreservationInvariant {
  readonly name: 'timeout_uncertainty_preservation';
  readonly description: string;
  check(orderStatus: OrderStatus, paymentOutcome: 'timeout' | 'confirmed' | 'failed'): InvariantViolation[];
}

/** Represents a detected invariant violation */
export interface InvariantViolation {
  readonly invariant: string;
  readonly message: string;
  readonly evidence: Record<string, unknown>;
}

// ─── Invariant implementations ──────────────────────────────────────────────

/** @node 01.04.04 */
export const noDuplicateLogicalCharge: NoDuplicateLogicalChargeInvariant = {
  name: 'no_duplicate_logical_charge',
  description:
    'For any single logical business operation (callerId + orderId), at most one ' +
    'payment record may exist in a completed state.  A second completed record for ' +
    'the same logicalId indicates a duplicate charge.',
  check(payments) {
    const violations: InvariantViolation[] = [];
    const completedByLogicalId = new Map<string, number>();

    for (const p of payments) {
      if (p.status === 'completed') {
        const count = (completedByLogicalId.get(p.logicalId) ?? 0) + 1;
        completedByLogicalId.set(p.logicalId, count);
      }
    }

    for (const [logicalId, count] of completedByLogicalId) {
      if (count > 1) {
        violations.push({
          invariant: 'no_duplicate_logical_charge',
          message: `logicalId "${logicalId}" has ${count} completed payment records — duplicate charge detected`,
          evidence: { logicalId, completedCount: count },
        });
      }
    }

    return violations;
  },
};

/** @node 01.04.05 */
export const amountCurrencyConsistency: AmountCurrencyConsistencyInvariant = {
  name: 'amount_currency_consistency',
  description:
    'The amount and currency of a completed payment must exactly match the original order.',
  check(order, payment) {
    const violations: InvariantViolation[] = [];

    if (order.amount !== payment.amount) {
      violations.push({
        invariant: 'amount_currency_consistency',
        message: `Order amount ${order.amount} does not match payment amount ${payment.amount}`,
        evidence: { orderAmount: order.amount, paymentAmount: payment.amount },
      });
    }

    if (order.currency !== payment.currency) {
      violations.push({
        invariant: 'amount_currency_consistency',
        message: `Order currency "${order.currency}" does not match payment currency "${payment.currency}"`,
        evidence: { orderCurrency: order.currency, paymentCurrency: payment.currency },
      });
    }

    return violations;
  },
};

/** @node 01.04.06 */
export const timeoutUncertaintyPreservation: TimeoutUncertaintyPreservationInvariant = {
  name: 'timeout_uncertainty_preservation',
  description:
    'When a payment request times out, the order must be in uncertain_outcome state. ' +
    'Resolving a timeout to confirmed or failed without authoritative server response is a violation.',
  check(orderStatus, paymentOutcome) {
    const violations: InvariantViolation[] = [];

    if (paymentOutcome === 'timeout' && orderStatus !== 'uncertain_outcome') {
      violations.push({
        invariant: 'timeout_uncertainty_preservation',
        message:
          `Payment outcome was 'timeout' but order status is '${orderStatus}' ` +
          `instead of 'uncertain_outcome'`,
        evidence: { orderStatus, paymentOutcome },
      });
    }

    return violations;
  },
};

/** All invariants — consumed by acceptance tests and validation subsystem */
export const ALL_INVARIANTS = [
  noDuplicateLogicalCharge,
  amountCurrencyConsistency,
  timeoutUncertaintyPreservation,
] as const;
