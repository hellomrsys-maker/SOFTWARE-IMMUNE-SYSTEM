/**
 * @node 10 — Knowledge Governance unit tests
 *
 * Rules 25 and 26:
 * - authorizeRepairFromMemory ALWAYS returns denied
 * - Candidate records cannot authorize anything
 * - Promotion requires human approval
 * - Superseded records are marked
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { KnowledgeGovernor, IncidentRecorder } from '../../src/knowledge.js';

describe('KnowledgeGovernor.authorizeRepairFromMemory — Rule 25', () => {
  const governor = new KnowledgeGovernor([]);

  it('always returns authorized=false', () => {
    const result = governor.authorizeRepairFromMemory();
    expect(result.authorized).toBe(false);
  });

  it('reason mentions Rule 25', () => {
    const result = governor.authorizeRepairFromMemory();
    expect(result.reason).toContain('Rule 25');
  });

  it('returns false even when called multiple times', () => {
    expect(governor.authorizeRepairFromMemory().authorized).toBe(false);
    expect(governor.authorizeRepairFromMemory().authorized).toBe(false);
    expect(governor.authorizeRepairFromMemory().authorized).toBe(false);
  });
});

describe('KnowledgeGovernor.promote', () => {
  let recorder: IncidentRecorder;
  let governor: KnowledgeGovernor;

  beforeEach(() => {
    recorder = new IncidentRecorder();
    const record = recorder.record({
      id: 'rec-1',
      incidentId: 'inc-1',
      failureSignature: 'duplicate-payment:unstable-idempotency-key',
      component: 'checkout-service',
    });
    governor = new KnowledgeGovernor([record]);
  });

  it('promotes candidate to approved with approval record ID', () => {
    const promoted = governor.promote('rec-1', 'approval-record-123');
    expect(promoted.status).toBe('approved');
    expect(promoted.version).toBe(2);
  });

  it('throws without approval record ID', () => {
    expect(() => governor.promote('rec-1', '')).toThrow();
  });
});

describe('KnowledgeGovernor.supersede', () => {
  let recorder: IncidentRecorder;
  let governor: KnowledgeGovernor;

  beforeEach(() => {
    recorder = new IncidentRecorder();
    const record = recorder.record({
      id: 'rec-1',
      incidentId: 'inc-1',
      failureSignature: 'sig-1',
      component: 'svc-1',
    });
    governor = new KnowledgeGovernor([record]);
  });

  it('marks record as superseded', () => {
    const superseded = governor.supersede('rec-1', 'rec-2');
    expect(superseded.status).toBe('superseded');
    expect(superseded.supersededBy).toBe('rec-2');
  });
});
