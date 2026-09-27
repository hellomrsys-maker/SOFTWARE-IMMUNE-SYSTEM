/**
 * @node 01.04.07 — Protected Acceptance Tests
 *
 * These tests exercise the correctness specification end-to-end.  They are
 * "protected" in the sense that:
 *
 *   1. The safety gate checker (08.04) computes the SHA-256 hash of this file
 *      at the start of a validation run and compares it against the hash stored
 *      when the incident was submitted.
 *   2. Any modification — including weakening assertions, removing test cases,
 *      or adding skips — causes 08.04 to fail the validation run.
 *   3. The repair agent's file-write scope explicitly excludes this directory.
 *
 * IMPORTANT: Do not modify, skip, or delete any test in this file.
 * IMPORTANT: Do not add `.skip`, `.todo`, or reduce assertion strictness.
 *
 * These tests use only the pure invariant functions (no database required).
 * Integration-level acceptance tests that require a running managed-app are
 * co-located in tests/acceptance/integration/.
 */

import { describe, it, expect } from 'vitest';
import {
  noDuplicateLogicalCharge,
  amountCurrencyConsistency,
  timeoutUncertaintyPreservation,
  ALL_INVARIANTS,
} from '../../src/correctness-spec/invariants.js';

// ─── Acceptance: no duplicate logical charge ──────────────────────────────────

describe('[PROTECTED] no_duplicate_logical_charge acceptance', () => {
  it('MUST detect two completed records for the same logical operation as a duplicate charge', () => {
    const violation = noDuplicateLogicalCharge.check([
      { logicalId: 'checkout-service:order-abc', status: 'completed' },
      { logicalId: 'checkout-service:order-abc', status: 'completed' },
    ]);
    // This assertion is the PRIMARY correctness check for the duplicate-payment defect.
    // It must remain strict: exactly one violation, correct invariant name.
    expect(violation).toHaveLength(1);
    expect(violation[0]?.invariant).toBe('no_duplicate_logical_charge');
  });

  it('MUST allow exactly one completed record per logical operation', () => {
    const violations = noDuplicateLogicalCharge.check([
      { logicalId: 'checkout-service:order-abc', status: 'completed' },
    ]);
    expect(violations).toHaveLength(0);
  });

  it('MUST treat different logicalIds independently', () => {
    const violations = noDuplicateLogicalCharge.check([
      { logicalId: 'checkout-service:order-1', status: 'completed' },
      { logicalId: 'checkout-service:order-2', status: 'completed' },
    ]);
    expect(violations).toHaveLength(0);
  });
});

// ─── Acceptance: amount and currency consistency ──────────────────────────────

describe('[PROTECTED] amount_currency_consistency acceptance', () => {
  it('MUST reject a payment with a lower amount than the order', () => {
    const violations = amountCurrencyConsistency.check(
      { amount: 100.00, currency: 'USD' },
      { amount: 50.00, currency: 'USD' },
    );
    expect(violations.length).toBeGreaterThanOrEqual(1);
    expect(violations.some((v) => v.invariant === 'amount_currency_consistency')).toBe(true);
  });

  it('MUST reject a payment with a different currency than the order', () => {
    const violations = amountCurrencyConsistency.check(
      { amount: 100.00, currency: 'USD' },
      { amount: 100.00, currency: 'GBP' },
    );
    expect(violations.length).toBeGreaterThanOrEqual(1);
  });

  it('MUST accept a payment matching the order exactly', () => {
    const violations = amountCurrencyConsistency.check(
      { amount: 49.99, currency: 'EUR' },
      { amount: 49.99, currency: 'EUR' },
    );
    expect(violations).toHaveLength(0);
  });
});

// ─── Acceptance: timeout uncertainty preservation ─────────────────────────────

describe('[PROTECTED] timeout_uncertainty_preservation acceptance', () => {
  it('MUST require uncertain_outcome when payment times out', () => {
    // This is the critical invariant that proves the defect: the order must not
    // be silently resolved to 'confirmed' when a timeout occurs.
    const violations = timeoutUncertaintyPreservation.check('uncertain_outcome', 'timeout');
    expect(violations).toHaveLength(0);
  });

  it('MUST flag confirmed order status after timeout as a violation', () => {
    const violations = timeoutUncertaintyPreservation.check('confirmed', 'timeout');
    expect(violations).toHaveLength(1);
  });

  it('MUST flag attempted order status after timeout as a violation', () => {
    const violations = timeoutUncertaintyPreservation.check('attempted', 'timeout');
    expect(violations).toHaveLength(1);
  });
});

// ─── Acceptance: ALL_INVARIANTS completeness ──────────────────────────────────

describe('[PROTECTED] ALL_INVARIANTS registry', () => {
  it('MUST contain all three required invariants', () => {
    const names = ALL_INVARIANTS.map((inv) => inv.name);
    expect(names).toContain('no_duplicate_logical_charge');
    expect(names).toContain('amount_currency_consistency');
    expect(names).toContain('timeout_uncertainty_preservation');
  });

  it('MUST have exactly three invariants (no undocumented additions)', () => {
    expect(ALL_INVARIANTS).toHaveLength(3);
  });
});
