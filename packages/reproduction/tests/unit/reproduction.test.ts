/**
 * @node 06.04 — Causal Discriminator tests
 * @node 06.05 — Regression Artifact Generator tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  CausalDiscriminator,
  RegressionArtifactGenerator,
  BaselineCheckNotPerformedError,
  type TrialResult,
} from '../../src/reproduction.js';

const faultyTrial = (index: number): TrialResult => ({
  trialIndex: index,
  condition: 'faulty',
  idempotencyKeyBehavior: 'regenerated_each_retry',
  completedPaymentCount: 2, // duplicate charge
  timedOut: false,
});

const cleanTrial = (index: number): TrialResult => ({
  trialIndex: index,
  condition: 'clean',
  idempotencyKeyBehavior: 'stable',
  completedPaymentCount: 1, // no duplicate
  timedOut: false,
});

describe('CausalDiscriminator', () => {
  const disc = new CausalDiscriminator();

  it('confirms causal link when faulty has duplicates and clean does not', () => {
    const result = disc.discriminate([faultyTrial(1), faultyTrial(2)], [cleanTrial(1), cleanTrial(2)]);
    expect(result.causalLinkConfirmed).toBe(true);
    expect(result.limits.length).toBeGreaterThan(0); // Rule 14: limits required
  });

  it('records no causal conclusion when both conditions produce same result', () => {
    // Both conditions produce duplicates — mechanism is not the distinguishing factor
    const result = disc.discriminate([faultyTrial(1)], [{ ...cleanTrial(1), completedPaymentCount: 2 }]);
    expect(result.causalLinkConfirmed).toBe(false);
  });

  it('records no causal conclusion when no trials are provided', () => {
    const result = disc.discriminate([], []);
    expect(result.causalLinkConfirmed).toBe(false);
  });

  it('always includes explicit limits (Rule 14)', () => {
    const result = disc.discriminate([faultyTrial(1)], [cleanTrial(1)]);
    expect(result.limits.length).toBeGreaterThan(0);
    expect(result.limits.some((l) => l.includes('tested'))).toBe(true);
  });
});

describe('RegressionArtifactGenerator', () => {
  let gen: RegressionArtifactGenerator;

  beforeEach(() => {
    gen = new RegressionArtifactGenerator();
  });

  it('throws BaselineCheckNotPerformedError if generate() called before baseline check', () => {
    const disc = new CausalDiscriminator();
    const conclusion = disc.discriminate([faultyTrial(1)], [cleanTrial(1)]);

    expect(() => gen.generate({
      incidentId: 'inc-1',
      hypothesisRef: 'hyp-1',
      causalConclusion: conclusion,
    })).toThrow(BaselineCheckNotPerformedError);
  });

  it('throws if baseline check was performed but test did NOT fail', () => {
    const disc = new CausalDiscriminator();
    const conclusion = disc.discriminate([faultyTrial(1)], [cleanTrial(1)]);

    gen.recordBaselineFailureCheck(false); // test passed — wrong!
    expect(() => gen.generate({
      incidentId: 'inc-1',
      hypothesisRef: 'hyp-1',
      causalConclusion: conclusion,
    })).toThrow(BaselineCheckNotPerformedError);
  });

  it('generates artifact with SHA-256 hash after successful baseline check', () => {
    const disc = new CausalDiscriminator();
    const conclusion = disc.discriminate([faultyTrial(1)], [cleanTrial(1)]);

    gen.recordBaselineFailureCheck(true);
    const artifact = gen.generate({
      incidentId: 'inc-1',
      hypothesisRef: 'hyp-1',
      causalConclusion: conclusion,
    });

    expect(artifact.baselineFailureVerified).toBe(true);
    expect(artifact.contentHash).toHaveLength(64);
    expect(artifact.reproductionCommand).toContain('vitest');
  });
});
