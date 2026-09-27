/**
 * @node 04.03 — Hypothesis Adjudicator unit tests
 *
 * Tests:
 * - assignStatus('Supported') with evidence refs → 'Supported'
 * - assignStatus('Supported') with no evidence refs → throws InsufficientEvidenceError
 * - assignStatus('Contradicted') → 'Contradicted'
 * - assignStatus('Insufficient evidence') → 'Insufficient evidence'
 * - Runtime rejection of invalid status value via zod
 * - mergeDuplicateClaims does not increase evidential strength
 */

import { describe, it, expect } from 'vitest';
import {
  HypothesisAdjudicator,
  HypothesisStatusSchema,
  InsufficientEvidenceError,
  type Hypothesis,
  type EvidenceRef,
} from '../../src/hypothesis/adjudicator.js';

const makeHypothesis = (overrides: Partial<Hypothesis> = {}): Hypothesis => ({
  id: 'hyp-001',
  incidentId: 'inc-001',
  title: 'Duplicate payment caused by unsafe retry',
  description: 'The payment client generates a new idempotency key on each retry',
  evidenceRefs: [],
  contradictionRefs: [],
  status: 'Insufficient evidence',
  alternativeExplanations: [],
  experimentRequirements: [],
  createdAt: new Date(),
  ...overrides,
});

const validatedRef: EvidenceRef = { id: 'ref-1', validated: true, recordType: 'business_state' };
const unvalidatedRef: EvidenceRef = { id: 'ref-2', validated: false, recordType: 'log' };

describe('HypothesisStatusSchema', () => {
  it('accepts all four permitted values', () => {
    expect(HypothesisStatusSchema.parse('Supported')).toBe('Supported');
    expect(HypothesisStatusSchema.parse('Contradicted')).toBe('Contradicted');
    expect(HypothesisStatusSchema.parse('Reproduced within stated conditions')).toBe('Reproduced within stated conditions');
    expect(HypothesisStatusSchema.parse('Insufficient evidence')).toBe('Insufficient evidence');
  });

  it('rejects any value outside the four', () => {
    expect(() => HypothesisStatusSchema.parse('Likely')).toThrow();
    expect(() => HypothesisStatusSchema.parse('confirmed')).toThrow();
    expect(() => HypothesisStatusSchema.parse('')).toThrow();
    expect(() => HypothesisStatusSchema.parse(null)).toThrow();
  });
});

describe('HypothesisAdjudicator.assignStatus', () => {
  const adj = new HypothesisAdjudicator();

  it('returns Supported when there is at least one validated evidence ref', () => {
    const hyp = makeHypothesis({ evidenceRefs: ['ref-1'] });
    const status = adj.assignStatus(hyp, 'Supported', {
      evidenceRefs: [validatedRef],
      hasContradictions: false,
      reproduced: false,
    });
    expect(status).toBe('Supported');
  });

  it('throws InsufficientEvidenceError when assigning Supported with no validated refs', () => {
    const hyp = makeHypothesis({ evidenceRefs: [] });
    expect(() =>
      adj.assignStatus(hyp, 'Supported', {
        evidenceRefs: [],
        hasContradictions: false,
        reproduced: false,
      }),
    ).toThrow(InsufficientEvidenceError);
  });

  it('throws InsufficientEvidenceError when all refs are unvalidated', () => {
    const hyp = makeHypothesis({ evidenceRefs: ['ref-2'] });
    expect(() =>
      adj.assignStatus(hyp, 'Supported', {
        evidenceRefs: [unvalidatedRef],
        hasContradictions: false,
        reproduced: false,
      }),
    ).toThrow(InsufficientEvidenceError);
  });

  it('assigns Contradicted without requiring evidence refs', () => {
    const hyp = makeHypothesis();
    const status = adj.assignStatus(hyp, 'Contradicted', {
      evidenceRefs: [],
      hasContradictions: true,
      reproduced: false,
    });
    expect(status).toBe('Contradicted');
  });

  it('assigns Insufficient evidence without refs', () => {
    const hyp = makeHypothesis();
    const status = adj.assignStatus(hyp, 'Insufficient evidence', {
      evidenceRefs: [],
      hasContradictions: false,
      reproduced: false,
    });
    expect(status).toBe('Insufficient evidence');
  });
});

describe('HypothesisAdjudicator.mergeDuplicateClaims — Rule 12', () => {
  const adj = new HypothesisAdjudicator();

  it('merges two identical claims into one (no evidential amplification)', () => {
    const claims = [
      { content: 'retry without idempotency key causes duplicate charge' },
      { content: 'retry without idempotency key causes duplicate charge' }, // duplicate
    ];
    const merged = adj.mergeDuplicateClaims(claims);
    // Two identical Bob outputs are merged — they do NOT count as two independent findings
    expect(merged).toHaveLength(1);
  });

  it('keeps distinct claims', () => {
    const claims = [
      { content: 'claim A' },
      { content: 'claim B' },
    ];
    expect(adj.mergeDuplicateClaims(claims)).toHaveLength(2);
  });
});
