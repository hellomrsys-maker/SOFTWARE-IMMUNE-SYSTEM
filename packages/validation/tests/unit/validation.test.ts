/**
 * @node 08 — Validation unit tests
 */

import { describe, it, expect } from 'vitest';
import {
  ValidationIdentityBinder,
  SafetyGateChecker,
  ResultAdjudicator,
  type GateResult,
} from '../../src/validation.js';

// ─── Identity Binder ─────────────────────────────────────────────────────────

describe('ValidationIdentityBinder', () => {
  const binder = new ValidationIdentityBinder();
  const base = {
    candidateCommit: 'abc123',
    environmentManifestJson: '{"schema":"exp_001"}',
    acceptanceSuiteHashes: { 'tests/acceptance/checkout-correctness.test.ts': 'deadbeef' },
  };

  it('produces the same hash for identical inputs', () => {
    const a = binder.bind(base);
    const b = binder.bind(base);
    expect(a.identityHash).toBe(b.identityHash);
  });

  it('invalidates binding when commit changes', () => {
    const original = binder.bind(base);
    const valid = binder.validateBinding(original, { ...base, candidateCommit: 'def456' });
    expect(valid).toBe(false);
  });

  it('invalidates binding when manifest changes', () => {
    const original = binder.bind(base);
    const valid = binder.validateBinding(original, {
      ...base, environmentManifestJson: '{"schema":"exp_002"}',
    });
    expect(valid).toBe(false);
  });

  it('invalidates binding when acceptance suite hash changes', () => {
    const original = binder.bind(base);
    const valid = binder.validateBinding(original, {
      ...base, acceptanceSuiteHashes: { 'tests/acceptance/checkout-correctness.test.ts': 'cafebabe' },
    });
    expect(valid).toBe(false);
  });

  it('validates correctly with unchanged inputs', () => {
    const original = binder.bind(base);
    expect(binder.validateBinding(original, base)).toBe(true);
  });
});

// ─── Safety Gates ─────────────────────────────────────────────────────────────

describe('SafetyGateChecker', () => {
  const checker = new SafetyGateChecker();

  it('fails when protected test file hash changes', () => {
    const result = checker.check({
      changedFiles: [{
        path: 'tests/acceptance/checkout-correctness.test.ts',
        currentHash: 'modified-hash',
      }],
      authorizedFiles: ['src/checkout/payment-client.ts'],
      acceptanceSuiteBaselineHashes: {
        'tests/acceptance/checkout-correctness.test.ts': 'original-hash',
      },
      artifactContents: [],
    });
    expect(result.status).toBe('failed');
    expect(result.output).toContain('protected');
  });

  it('passes when no protected files changed', () => {
    const result = checker.check({
      changedFiles: [{ path: 'src/checkout/payment-client.ts', currentHash: 'newhash' }],
      authorizedFiles: ['src/checkout/payment-client.ts'],
      acceptanceSuiteBaselineHashes: {},
      artifactContents: [],
    });
    expect(result.status).toBe('passed');
  });
});

// ─── Result Adjudicator ───────────────────────────────────────────────────────

describe('ResultAdjudicator', () => {
  const adj = new ResultAdjudicator();
  const makeGate = (name: string, status: GateResult['status'], exitCode: number | null, mandatory = true): GateResult =>
    ({ gateName: name, status, exitCode, output: '', mandatory });

  it('returns review_ready when all mandatory gates pass', () => {
    const gates = [
      makeGate('identity', 'passed', 0),
      makeGate('execution', 'passed', 0),
      makeGate('business', 'passed', 0),
      makeGate('safety', 'passed', 0),
      makeGate('performance', 'passed', 0),
    ];
    const result = adj.adjudicate(gates, { maxRetryCount: 3, currentRetryCount: 0 });
    expect(result.status).toBe('review_ready');
  });

  it('returns rejected when any mandatory gate fails', () => {
    const gates = [
      makeGate('identity', 'passed', 0),
      makeGate('execution', 'failed', 1), // FAIL
      makeGate('safety', 'passed', 0),
    ];
    const result = adj.adjudicate(gates, { maxRetryCount: 3, currentRetryCount: 0 });
    expect(result.status).toBe('rejected');
  });

  it('returns rejected on skipped mandatory gate (Rule 19)', () => {
    const gates = [
      makeGate('identity', 'passed', 0),
      makeGate('execution', 'skipped', null), // skipped = rejection
    ];
    const result = adj.adjudicate(gates, { maxRetryCount: 3, currentRetryCount: 0 });
    expect(result.status).toBe('rejected');
    expect(result.limitations.some((l) => l.includes('Rule 19'))).toBe(true);
  });

  it('always includes limitation notices about test scope', () => {
    const result = adj.adjudicate(
      [makeGate('identity', 'passed', 0)],
      { maxRetryCount: 3, currentRetryCount: 0 },
    );
    expect(result.limitations.some((l) => l.includes('correctness proof'))).toBe(true);
  });

  it('rejects when max retry count is reached', () => {
    const result = adj.adjudicate(
      [makeGate('identity', 'passed', 0)],
      { maxRetryCount: 3, currentRetryCount: 3 },
    );
    expect(result.status).toBe('rejected');
  });
});
