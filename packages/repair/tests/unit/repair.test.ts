/**
 * @node 07 — Repair unit tests
 */

import { describe, it, expect } from 'vitest';
import {
  ChangeAuthorizer,
  CandidatePlanner,
  RecoveryPlanner,
  PROTECTED_FILES,
} from '../../src/repair.js';

describe('ChangeAuthorizer', () => {
  const auth = new ChangeAuthorizer();

  it('rejects modification of protected acceptance test file', () => {
    const result = auth.authorize({
      filePath: 'tests/acceptance/checkout-correctness.test.ts',
      changedLines: 5,
      hasApprovalRecord: false,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('protected');
  });

  it('rejects modification of correctness-spec invariants', () => {
    const result = auth.authorize({
      filePath: 'src/correctness-spec/invariants.ts',
      changedLines: 2,
      hasApprovalRecord: false,
    });
    expect(result.allowed).toBe(false);
  });

  it('requires human approval for migration files', () => {
    const result = auth.authorize({
      filePath: 'migrations/001_create_table.sql',
      changedLines: 10,
      hasApprovalRecord: false,
    });
    expect(result.allowed).toBe(false);
    expect(result.requiresHumanApproval).toBe(true);
  });

  it('allows migration with approval record', () => {
    const result = auth.authorize({
      filePath: 'migrations/001_create_table.sql',
      changedLines: 10,
      hasApprovalRecord: true,
    });
    expect(result.allowed).toBe(true);
  });

  it('rejects changes exceeding max line budget', () => {
    const result = auth.authorize({
      filePath: 'src/checkout/payment-client.ts',
      changedLines: 150,
      hasApprovalRecord: false,
    });
    expect(result.allowed).toBe(false);
    expect(result.requiresHumanApproval).toBe(true);
  });

  it('allows small authorized change to source file', () => {
    const result = auth.authorize({
      filePath: 'src/checkout/payment-client.ts',
      changedLines: 5,
      hasApprovalRecord: false,
    });
    expect(result.allowed).toBe(true);
  });
});

describe('CandidatePlanner — Rule 16', () => {
  const planner = new CandidatePlanner();

  it('selects fix_idempotency_key as the only valid repair', () => {
    const candidates = planner.planCandidates('unstable_idempotency_key');
    const selected = candidates.filter((c) => c.selected);
    expect(selected).toHaveLength(1);
    expect(selected[0]?.alternative).toBe('fix_idempotency_key');
  });

  it('rejects increase_timeout — does not fix confirmed mechanism (Rule 16)', () => {
    const candidates = planner.planCandidates('unstable_idempotency_key');
    const timeout = candidates.find((c) => c.alternative === 'increase_timeout');
    expect(timeout?.selected).toBe(false);
    expect(timeout?.rejectionReason).toContain('Rule 16');
  });

  it('rejects suppress_error — symptom suppression not root cause fix', () => {
    const candidates = planner.planCandidates('unstable_idempotency_key');
    const suppress = candidates.find((c) => c.alternative === 'suppress_error');
    expect(suppress?.selected).toBe(false);
  });
});

describe('RecoveryPlanner — Rule 17', () => {
  const planner = new RecoveryPlanner();

  it('always includes irreversibleEffectWarning (Rule 17)', () => {
    const plan = planner.createPlan({ candidateCommit: 'abc123', hasMigrations: false });
    expect(plan.irreversibleEffectWarning).toBeTruthy();
    expect(plan.irreversibleEffectWarning.length).toBeGreaterThan(20);
  });

  it('never initiates auto-refund', () => {
    const plan = planner.createPlan({ candidateCommit: 'abc123', hasMigrations: false });
    expect(plan.autoRefundInitiated).toBe(false);
  });

  it('requires human action', () => {
    const plan = planner.createPlan({ candidateCommit: 'abc123', hasMigrations: true });
    expect(plan.humanActionRequired).toBeTruthy();
  });
});
