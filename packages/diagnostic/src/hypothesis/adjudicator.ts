/**
 * @node 04.03 — Hypothesis Adjudicator
 *
 * Manages hypothesis status assignment with EXACTLY four permitted values.
 * Any other value is a compile-time AND runtime error.
 *
 * Rule 11: 'Supported' requires at least one validated evidence reference.
 * Rule 12: duplicate agent outputs do NOT increase evidential strength.
 * Rule 13: status is a zod enum — no other values permitted at runtime.
 */

import { z } from 'zod';
import { createHash } from 'node:crypto';

// ─── Hypothesis status — exactly four values ──────────────────────────────────

/**
 * @node 04.03.07 — Hypothesis status type.
 *
 * These are the ONLY four permitted values.  Any attempt to assign a different
 * status is rejected at compile time (TypeScript union) and at runtime (zod enum).
 *
 * Rule 13: no other values permitted.
 */
export const HypothesisStatusSchema = z.enum([
  'Supported',
  'Contradicted',
  'Reproduced within stated conditions',
  'Insufficient evidence',
]);
export type HypothesisStatus = z.infer<typeof HypothesisStatusSchema>;

// ─── Hypothesis types ─────────────────────────────────────────────────────────

export interface Hypothesis {
  id: string;
  incidentId: string;
  title: string;
  description: string;
  /** IDs of validated evidence records that support this hypothesis */
  evidenceRefs: string[];
  /** IDs of evidence records that contradict this hypothesis */
  contradictionRefs: string[];
  status: HypothesisStatus;
  alternativeExplanations: AlternativeExplanation[];
  experimentRequirements: ExperimentRequirement[];
  createdAt: Date;
}

export interface AlternativeExplanation {
  description: string;
  evidenceRefs: string[];
  status: HypothesisStatus;
}

export interface ExperimentRequirement {
  description: string;
  faultType: string;
  variableMechanism: string;
  expectedObservation: string;
}

export interface EvidenceRef {
  id: string;
  validated: boolean;
  recordType: string;
}

// ─── Hypothesis Adjudicator ───────────────────────────────────────────────────

export class HypothesisAdjudicator {
  /**
   * @node 04.03.01 — Validate that all evidence refs exist in the bundle
   * and are marked as validated.
   */
  validateEvidenceRefs(hypothesis: Hypothesis, availableRefs: EvidenceRef[]): string[] {
    const missing: string[] = [];
    const refMap = new Map(availableRefs.map((r) => [r.id, r]));

    for (const refId of hypothesis.evidenceRefs) {
      const ref = refMap.get(refId);
      if (!ref) {
        missing.push(`Evidence ref "${refId}" not found in bundle`);
      } else if (!ref.validated) {
        missing.push(`Evidence ref "${refId}" is not validated`);
      }
    }
    return missing;
  }

  /**
   * @node 04.03.02 — Find evidence records that contradict the hypothesis.
   *
   * Returns IDs of contradicting records.
   */
  checkContradictions(
    hypothesis: Hypothesis,
    evidenceRecords: Array<{ id: string; payload: Record<string, unknown> }>,
  ): string[] {
    return evidenceRecords
      .filter((r) => hypothesis.contradictionRefs.includes(r.id))
      .map((r) => r.id);
  }

  /**
   * @node 04.03.03 — Identify evidence types not yet collected.
   */
  checkMissingEvidence(
    hypothesis: Hypothesis,
    collectedTypes: string[],
    requiredTypes: string[],
  ): string[] {
    return requiredTypes.filter((t) => !collectedTypes.includes(t));
  }

  /**
   * @node 04.03.04 — Register an alternative explanation.
   */
  registerAlternative(
    hypothesis: Hypothesis,
    alternative: AlternativeExplanation,
  ): Hypothesis {
    return {
      ...hypothesis,
      alternativeExplanations: [...hypothesis.alternativeExplanations, alternative],
    };
  }

  /**
   * @node 04.03.05 — Merge duplicate claims by content hash.
   *
   * Rule 12: agreement between agents without independent evidence is NOT confirmation.
   * Two identical outputs are merged into one — they do NOT count as two separate
   * pieces of evidence.  Evidence strength comes from independent observations,
   * not from how many agents repeat the same claim.
   */
  mergeDuplicateClaims<T extends { content: string }>(claims: T[]): T[] {
    const seen = new Set<string>();
    return claims.filter((c) => {
      const hash = createHash('sha256').update(c.content).digest('hex');
      if (seen.has(hash)) return false;
      seen.add(hash);
      return true;
    });
  }

  /**
   * @node 04.03.06 — Generate experiment requirements from a hypothesis.
   */
  generateExperimentRequirements(hypothesis: Hypothesis): ExperimentRequirement[] {
    // Default requirement: reproduce under faulty vs clean conditions
    return [
      {
        description: `Reproduce "${hypothesis.title}" by varying the suspected mechanism`,
        faultType: 'delay_after_commit',
        variableMechanism: 'idempotency_key_stability',
        expectedObservation: 'duplicate completed payment record for same logicalId',
      },
    ];
  }

  /**
   * @node 04.03.07 — Assign a validated status to a hypothesis.
   *
   * Rule 11: 'Supported' requires at least one validated evidence reference.
   * Rule 13: only four values permitted — enforced by TypeScript + zod.
   *
   * Throws if:
   *   - the proposed status is not in the four-value enum (runtime zod guard)
   *   - 'Supported' is proposed with zero evidence refs
   */
  assignStatus(
    hypothesis: Hypothesis,
    proposedStatus: HypothesisStatus,
    params: {
      evidenceRefs: EvidenceRef[];
      hasContradictions: boolean;
      reproduced: boolean;
    },
  ): HypothesisStatus {
    // Runtime enforcement of Rule 13 (belt-and-suspenders alongside TypeScript)
    HypothesisStatusSchema.parse(proposedStatus);

    // Rule 11: Supported requires at least one validated evidence ref
    if (proposedStatus === 'Supported') {
      const validatedRefs = params.evidenceRefs.filter((r) => r.validated);
      if (validatedRefs.length === 0) {
        throw new InsufficientEvidenceError(
          `Cannot assign 'Supported' status: hypothesis "${hypothesis.id}" has no validated evidence references. ` +
          'Rule 11: Supported status requires at least one validated evidence reference.',
        );
      }
    }

    return proposedStatus;
  }
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export class InsufficientEvidenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InsufficientEvidenceError';
  }
}
