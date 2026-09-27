/**
 * @node 01.02.02 — Idempotency Processor unit tests
 *
 * Tests for:
 *   - Request fingerprinting
 *   - Idempotency key scoping
 *   - Conflicting payload detection
 *
 * Note: Tests that require a real database connection (concurrent duplicates,
 * atomic reservation) are covered by integration tests.  These unit tests
 * validate the pure-logic functions.
 */

import { describe, it, expect } from 'vitest';
import {
  computeRequestFingerprint,
  scopeIdempotencyKey,
  ConflictingPayloadError,
} from '../../src/payment-simulator/idempotency.js';
import type { PaymentRequest } from '../../src/correctness-spec/invariants.js';

const baseReq: PaymentRequest = {
  logicalId: 'checkout-service:order-123',
  idempotencyKey: 'key-abc',
  callerId: 'checkout-service',
  operation: 'payment.create',
  amount: 99.99,
  currency: 'USD',
};

// ─── Fingerprinting ───────────────────────────────────────────────────────────

describe('computeRequestFingerprint', () => {
  it('produces the same fingerprint for identical requests', () => {
    const a = computeRequestFingerprint(baseReq);
    const b = computeRequestFingerprint({ ...baseReq });
    expect(a).toBe(b);
  });

  it('produces different fingerprints when amount differs', () => {
    const a = computeRequestFingerprint(baseReq);
    const b = computeRequestFingerprint({ ...baseReq, amount: 199.99 });
    expect(a).not.toBe(b);
  });

  it('produces different fingerprints when currency differs', () => {
    const a = computeRequestFingerprint(baseReq);
    const b = computeRequestFingerprint({ ...baseReq, currency: 'EUR' });
    expect(a).not.toBe(b);
  });

  it('produces a 64-character hex string (SHA-256)', () => {
    const fp = computeRequestFingerprint(baseReq);
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does NOT include idempotencyKey in fingerprint', () => {
    // The fingerprint is a payload identity, not a key identity.
    // Two requests with different idempotency keys but same payload should have
    // the same fingerprint — enabling conflicting payload detection.
    const a = computeRequestFingerprint({ ...baseReq, idempotencyKey: 'key-1' });
    const b = computeRequestFingerprint({ ...baseReq, idempotencyKey: 'key-2' });
    expect(a).toBe(b);
  });
});

// ─── Key scoping ──────────────────────────────────────────────────────────────

describe('scopeIdempotencyKey', () => {
  it('scopes the key to caller and operation', () => {
    const scoped = scopeIdempotencyKey('caller-A', 'payment.create', 'my-key');
    expect(scoped).toBe('caller-A:payment.create:my-key');
  });

  it('produces different scoped keys for different callers with same base key', () => {
    const a = scopeIdempotencyKey('caller-A', 'payment.create', 'key');
    const b = scopeIdempotencyKey('caller-B', 'payment.create', 'key');
    expect(a).not.toBe(b);
  });

  it('produces different scoped keys for different operations with same caller', () => {
    const a = scopeIdempotencyKey('caller-A', 'payment.create', 'key');
    const b = scopeIdempotencyKey('caller-A', 'payment.refund', 'key');
    expect(a).not.toBe(b);
  });
});

// ─── ConflictingPayloadError ──────────────────────────────────────────────────

describe('ConflictingPayloadError', () => {
  it('is an Error with name ConflictingPayloadError', () => {
    const err = new ConflictingPayloadError('test', {
      existing: 'fp-old',
      incoming: 'fp-new',
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ConflictingPayloadError');
    expect(err.fingerprints.existing).toBe('fp-old');
    expect(err.fingerprints.incoming).toBe('fp-new');
  });
});
