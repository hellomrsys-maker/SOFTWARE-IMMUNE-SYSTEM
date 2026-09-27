/**
 * @node 05 — Containment unit tests
 */

import { describe, it, expect } from 'vitest';
import {
  assessImpact,
  MitigationSelector,
  MitigationVerifier,
} from '../../src/containment.js';

describe('assessImpact', () => {
  it('records unknownImpact=true when full scope cannot be determined', () => {
    const assessment = assessImpact({
      incidentId: 'inc-1',
      logicalIds: ['caller:order-1'],
      knownDuplicatePaymentIds: ['pay-1'],
      canDetermineFullScope: false,
    });
    expect(assessment.unknownImpact).toBe(true);
    expect(assessment.unknownImpactExplanation).not.toBeNull();
  });

  it('records unknownImpact=false when full scope is determined', () => {
    const assessment = assessImpact({
      incidentId: 'inc-1',
      logicalIds: ['caller:order-1'],
      knownDuplicatePaymentIds: ['pay-1'],
      canDetermineFullScope: true,
    });
    expect(assessment.unknownImpact).toBe(false);
    expect(assessment.unknownImpactExplanation).toBeNull();
  });
});

describe('MitigationSelector', () => {
  it('selects circuit-breaker action when duplicate charge detected', () => {
    const selector = new MitigationSelector();
    const impact = assessImpact({
      incidentId: 'inc-1',
      logicalIds: ['caller:order-1'],
      knownDuplicatePaymentIds: ['pay-1'],
      canDetermineFullScope: false,
    });
    const selected = selector.selectForIncident(impact, {});
    expect(selected.some((a) => a.id === 'circuit-breaker-open')).toBe(true);
  });
});

describe('MitigationVerifier', () => {
  it('detects adverse effect and triggers reversal', async () => {
    const verifier = new MitigationVerifier();
    let reversed = false;

    const result = await verifier.verify({
      actionId: 'circuit-breaker-open',
      preActionState: { errorRate: 0.01 },
      postActionState: { errorRate: 0.9 }, // much worse — adverse effect
      adverseEffectCheck: (pre, post) =>
        (post['errorRate'] as number) > (pre['errorRate'] as number) * 5,
      reverseAction: async () => { reversed = true; },
      escalate: async () => undefined,
    });

    expect(result.adverseEffectDetected).toBe(true);
    expect(result.reversed).toBe(true);
    expect(reversed).toBe(true);
  });

  it('does not reverse when no adverse effect', async () => {
    const verifier = new MitigationVerifier();
    let reversed = false;

    const result = await verifier.verify({
      actionId: 'disable-fault-injection',
      preActionState: { errorRate: 0.5 },
      postActionState: { errorRate: 0.01 },
      adverseEffectCheck: () => false,
      reverseAction: async () => { reversed = true; },
      escalate: async () => undefined,
    });

    expect(result.adverseEffectDetected).toBe(false);
    expect(result.reversed).toBe(false);
    expect(reversed).toBe(false);
  });
});
