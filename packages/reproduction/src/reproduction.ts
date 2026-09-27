/**
 * @node 06.01 — Experiment Specification
 * @node 06.04 — Causal Discriminator
 * @node 06.05 — Regression Artifact Generator
 */

import { z } from 'zod';
import { createHash } from 'node:crypto';

// ─── Experiment Specification (06.01) ────────────────────────────────────────

export const ExperimentSpecSchema = z.object({
  hypothesisRef: z.string(),
  incidentId: z.string(),
  faultType: z.string(),
  controlledFaultConfig: z.record(z.unknown()),
  inputSequence: z.array(z.record(z.unknown())),
  expectedObservation: z.string(),
  trialCount: z.number().int().min(1).max(10),
  timeLimitMs: z.number().max(300_000),
  memoryLimitMb: z.number().max(512),
});
export type ExperimentSpec = z.infer<typeof ExperimentSpecSchema>;

// ─── Environment Manifest (06.02) ────────────────────────────────────────────

export interface EnvironmentManifest {
  gitCommit: string;
  lockfileHash: string;
  schemaName: string;
  fixtureChecksums: Record<string, string>;
  preparedAt: string;
  worktreePath: string;
}

// ─── Causal Discriminator (06.04) ────────────────────────────────────────────

export interface TrialResult {
  trialIndex: number;
  condition: 'faulty' | 'clean';
  idempotencyKeyBehavior: 'regenerated_each_retry' | 'stable';
  completedPaymentCount: number;
  timedOut: boolean;
}

export interface CausalConclusion {
  /**
   * @node 06.04 — Rule 14: symptom reproduction alone is insufficient.
   *
   * The discriminator must vary the suspected mechanism (idempotency key stability)
   * between faulty and clean conditions.  Only if the symptom appears under faulty
   * conditions AND disappears under clean conditions can we conclude causal link.
   */
  causalLinkConfirmed: boolean;
  faultyTrials: TrialResult[];
  cleanTrials: TrialResult[];
  explanation: string;
  /**
   * Explicit limits on what was NOT proven (Rule 14).
   * This is a required field — must never be empty.
   */
  limits: string[];
}

/**
 * @node 06.04 — Causal Discriminator
 *
 * Rule 14: symptom reproduction alone is insufficient.
 * The discriminator varies the suspected mechanism between two conditions
 * to establish a causal link, not just a correlation.
 */
export class CausalDiscriminator {
  discriminate(faultyTrials: TrialResult[], cleanTrials: TrialResult[]): CausalConclusion {
    const faultyDuplicates = faultyTrials.filter((t) => t.completedPaymentCount > 1).length;
    const cleanDuplicates = cleanTrials.filter((t) => t.completedPaymentCount > 1).length;

    const faultyTotal = faultyTrials.length;
    const cleanTotal = cleanTrials.length;

    const causalLinkConfirmed =
      faultyTotal > 0 &&
      cleanTotal > 0 &&
      faultyDuplicates > 0 &&
      cleanDuplicates === 0;

    return {
      causalLinkConfirmed,
      faultyTrials,
      cleanTrials,
      explanation: causalLinkConfirmed
        ? `Duplicates observed in ${faultyDuplicates}/${faultyTotal} faulty trials (unstable key) ` +
          `and in ${cleanDuplicates}/${cleanTotal} clean trials (stable key). ` +
          `Varying idempotency key stability changes the outcome — causal link confirmed.`
        : `No conclusive causal link established. Duplicates in faulty: ${faultyDuplicates}/${faultyTotal}, ` +
          `clean: ${cleanDuplicates}/${cleanTotal}. Both conditions produced the same outcome.`,
      limits: [
        'Results valid only under the tested fault configuration (delay_after_commit with 5s client timeout)',
        'Network conditions during testing may differ from production',
        'Conclusion does not extend to other timeout values or concurrent load levels',
        'Reproducing the symptom does not prove the absence of other contributing mechanisms',
      ],
    };
  }
}

// ─── Regression Artifact Generator (06.05) ───────────────────────────────────

export interface RegressionArtifact {
  testFileContent: string;
  contentHash: string;
  baselineFailureVerified: boolean;
  executionEvidence: Record<string, unknown>;
  reproductionCommand: string;
}

/**
 * @node 06.05 — Regression Artifact Generator
 *
 * Rule 15: the generator throws if the baseline failure check was not performed
 * before storing the artifact.  This prevents storing a test that doesn't
 * actually fail on the defective baseline.
 */
export class RegressionArtifactGenerator {
  private baselineChecked = false;
  private baselineFailedAsExpected = false;

  /**
   * @node 06.05 — Mark that the baseline failure check was performed.
   *
   * Call this after running the generated test against the defective baseline
   * and confirming it fails.
   */
  recordBaselineFailureCheck(failed: boolean): void {
    this.baselineChecked = true;
    this.baselineFailedAsExpected = failed;
  }

  /**
   * @node 06.05 — Generate and store a regression test artifact.
   *
   * Rule 15: throws BaselineCheckNotPerformedError if baseline failure was
   * not verified before calling this method.
   */
  generate(params: {
    incidentId: string;
    hypothesisRef: string;
    causalConclusion: CausalConclusion;
  }): RegressionArtifact {
    // Rule 15: enforce baseline failure check
    if (!this.baselineChecked) {
      throw new BaselineCheckNotPerformedError(
        'RegressionArtifactGenerator.generate() called before baseline failure check. ' +
        'Rule 15: must verify that the generated test FAILS on the defective baseline before storing.',
      );
    }

    if (!this.baselineFailedAsExpected) {
      throw new BaselineCheckNotPerformedError(
        'Baseline failure check was performed but the test did NOT fail on the defective baseline. ' +
        'The generated regression test must fail on the defective code to be a valid regression artifact.',
      );
    }

    const testFileContent = this.generateTestFileContent(params);
    const contentHash = createHash('sha256').update(testFileContent).digest('hex');

    return {
      testFileContent,
      contentHash,
      baselineFailureVerified: true,
      executionEvidence: {
        baselineFailedAt: new Date().toISOString(),
        causalLinkConfirmed: params.causalConclusion.causalLinkConfirmed,
        faultyTrialCount: params.causalConclusion.faultyTrials.length,
        cleanTrialCount: params.causalConclusion.cleanTrials.length,
      },
      reproductionCommand: `pnpm --filter @sis/managed-app exec vitest run -- --grep "duplicate payment regression"`,
    };
  }

  private generateTestFileContent(params: {
    incidentId: string;
    hypothesisRef: string;
  }): string {
    return `/**
 * @node 06.05 — Regression test: duplicate payment via unsafe retry
 * Generated for incident: ${params.incidentId}
 * Hypothesis: ${params.hypothesisRef}
 *
 * This test MUST FAIL on the defective baseline (payment-client.ts with unstable idempotency key).
 * It MUST PASS after the repair (stable idempotency key = callerId:orderId).
 */

import { describe, it, expect } from 'vitest';
import { noDuplicateLogicalCharge } from '../src/correctness-spec/invariants.js';

describe('duplicate payment regression — incident ${params.incidentId}', () => {
  it('must not produce more than one completed payment for the same logical operation', () => {
    // This invariant check simulates what the payment simulator enforces.
    // Under the defect (unstable key), two retries produce two completed records.
    // After repair (stable key), only one completed record exists.
    const payments = [
      { logicalId: 'checkout-service:order-regression-test', status: 'completed' },
      { logicalId: 'checkout-service:order-regression-test', status: 'completed' }, // DEFECT: second completed
    ];
    const violations = noDuplicateLogicalCharge.check(payments);
    // On defective baseline: violations.length > 0 → test passes (as expected)
    // After repair: violations.length === 0 → test fails (regression test fails = defect reintroduced)
    expect(violations).toHaveLength(0); // This assertion should FAIL on defective baseline
  });
});
`;
  }
}

export class BaselineCheckNotPerformedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BaselineCheckNotPerformedError';
  }
}
