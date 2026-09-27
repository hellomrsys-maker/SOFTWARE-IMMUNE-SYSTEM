/**
 * @node 01.04 — Invariants unit tests
 *
 * Tests for all three correctness invariants:
 *   01.04.04 — no_duplicate_logical_charge
 *   01.04.05 — amount_currency_consistency
 *   01.04.06 — timeout_uncertainty_preservation
 *
 * IMPORTANT (01.04.07): These tests must not be modified by the repair agent.
 * The safety gate checker (08.04) compares the hash of this file against a
 * stored baseline and rejects any candidate that modifies it.
 */

import { describe, it, expect } from 'vitest';
import {
  noDuplicateLogicalCharge,
  amountCurrencyConsistency,
  timeoutUncertaintyPreservation,
} from '../../src/correctness-spec/invariants.js';

// ─── 01.04.04 — No duplicate logical charge ──────────────────────────────────

describe('noDuplicateLogicalCharge', () => {
  it('returns no violations when each logicalId has exactly one completed payment', () => {
    const payments = [
      { logicalId: 'caller:order-1', status: 'completed' },
      { logicalId: 'caller:order-2', status: 'completed' },
    ];
    expect(noDuplicateLogicalCharge.check(payments)).toHaveLength(0);
  });

  it('returns a violation when a single logicalId has two completed payments', () => {
    const payments = [
      { logicalId: 'caller:order-1', status: 'completed' },
      { logicalId: 'caller:order-1', status: 'completed' },
    ];
    const violations = noDuplicateLogicalCharge.check(payments);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.invariant).toBe('no_duplicate_logical_charge');
    expect(violations[0]?.evidence).toMatchObject({ logicalId: 'caller:order-1', completedCount: 2 });
  });

  it('ignores in_progress and failed records in the duplicate count', () => {
    const payments = [
      { logicalId: 'caller:order-1', status: 'completed' },
      { logicalId: 'caller:order-1', status: 'in_progress' },
      { logicalId: 'caller:order-1', status: 'failed' },
    ];
    expect(noDuplicateLogicalCharge.check(payments)).toHaveLength(0);
  });

  it('detects three completed records for the same logicalId', () => {
    const payments = [
      { logicalId: 'caller:order-X', status: 'completed' },
      { logicalId: 'caller:order-X', status: 'completed' },
      { logicalId: 'caller:order-X', status: 'completed' },
    ];
    const violations = noDuplicateLogicalCharge.check(payments);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.evidence).toMatchObject({ completedCount: 3 });
  });
});

// ─── 01.04.05 — Amount and currency consistency ───────────────────────────────

describe('amountCurrencyConsistency', () => {
  it('returns no violations when amount and currency match', () => {
    const violations = amountCurrencyConsistency.check(
      { amount: 99.99, currency: 'USD' },
      { amount: 99.99, currency: 'USD' },
    );
    expect(violations).toHaveLength(0);
  });

  it('returns a violation when amounts differ', () => {
    const violations = amountCurrencyConsistency.check(
      { amount: 100, currency: 'USD' },
      { amount: 99, currency: 'USD' },
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.invariant).toBe('amount_currency_consistency');
  });

  it('returns a violation when currencies differ', () => {
    const violations = amountCurrencyConsistency.check(
      { amount: 50, currency: 'USD' },
      { amount: 50, currency: 'EUR' },
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.invariant).toBe('amount_currency_consistency');
  });

  it('returns two violations when both amount and currency differ', () => {
    const violations = amountCurrencyConsistency.check(
      { amount: 100, currency: 'USD' },
      { amount: 200, currency: 'GBP' },
    );
    expect(violations).toHaveLength(2);
  });
});

// ─── 01.04.06 — Timeout uncertainty preservation ─────────────────────────────

describe('timeoutUncertaintyPreservation', () => {
  it('returns no violations when timeout results in uncertain_outcome', () => {
    const violations = timeoutUncertaintyPreservation.check('uncertain_outcome', 'timeout');
    expect(violations).toHaveLength(0);
  });

  it('returns a violation when timeout results in confirmed', () => {
    const violations = timeoutUncertaintyPreservation.check('confirmed', 'timeout');
    expect(violations).toHaveLength(1);
    expect(violations[0]?.invariant).toBe('timeout_uncertainty_preservation');
    expect(violations[0]?.evidence).toMatchObject({ orderStatus: 'confirmed', paymentOutcome: 'timeout' });
  });

  it('returns a violation when timeout results in pending', () => {
    const violations = timeoutUncertaintyPreservation.check('pending', 'timeout');
    expect(violations).toHaveLength(1);
  });

  it('returns no violations for confirmed outcome when order is confirmed', () => {
    // Non-timeout outcomes do not trigger this invariant
    const violations = timeoutUncertaintyPreservation.check('confirmed', 'confirmed');
    expect(violations).toHaveLength(0);
  });

  it('returns no violations for failed outcome regardless of order status', () => {
    const violations = timeoutUncertaintyPreservation.check('uncertain_outcome', 'failed');
    expect(violations).toHaveLength(0);
  });
});
