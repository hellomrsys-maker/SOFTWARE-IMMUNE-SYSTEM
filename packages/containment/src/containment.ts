/**
 * @node 05.01 — Impact Assessor
 * @node 05.02 — Mitigation Selector
 * @node 05.03 — Mitigation Verifier
 */

// ─── Impact Assessor ─────────────────────────────────────────────────────────

export interface ImpactAssessment {
  incidentId: string;
  affectedEndpoints: string[];
  operationType: string;
  knownAffectedRecords: string[];
  /**
   * @node 05.01 — Unknown impact is explicitly recorded, never assumed absent.
   * When the full scope cannot be determined, this is true with an explanation.
   */
  unknownImpact: boolean;
  unknownImpactExplanation: string | null;
  assessedAt: string;
}

export function assessImpact(params: {
  incidentId: string;
  logicalIds: string[];
  knownDuplicatePaymentIds: string[];
  canDetermineFullScope: boolean;
}): ImpactAssessment {
  return {
    incidentId: params.incidentId,
    affectedEndpoints: ['/checkout', '/payments'],
    operationType: 'payment.create',
    knownAffectedRecords: params.knownDuplicatePaymentIds,
    unknownImpact: !params.canDetermineFullScope,
    unknownImpactExplanation: !params.canDetermineFullScope
      ? 'Cannot determine full scope of duplicate charges without complete log coverage'
      : null,
    assessedAt: new Date().toISOString(),
  };
}

// ─── Mitigation Catalog ───────────────────────────────────────────────────────

export interface MitigationAction {
  id: string;
  description: string;
  reversible: boolean;
  preconditions: string[];
  requiresApproval: boolean;
  expectedBenefit: string;
  availabilityTradeOff: string;
  expiryDurationMs: number;
  reversalCommand: string;
}

/** @node 05.02 — Predefined reversible mitigation catalog. */
export const MITIGATION_CATALOG: readonly MitigationAction[] = [
  {
    id: 'disable-fault-injection',
    description: 'Disable active fault injection configuration',
    reversible: true,
    preconditions: ['fault_injection_active'],
    requiresApproval: false,
    expectedBenefit: 'Stops artificially induced failures',
    availabilityTradeOff: 'None — removes injected fault only',
    expiryDurationMs: 0, // permanent until re-activated
    reversalCommand: 'POST /fault-injection/activate',
  },
  {
    id: 'circuit-breaker-open',
    description: 'Open circuit breaker on payment endpoint to prevent further charges',
    reversible: true,
    preconditions: ['duplicate_charge_detected'],
    requiresApproval: true,
    expectedBenefit: 'Prevents additional duplicate charges while fix is prepared',
    availabilityTradeOff: 'Payment processing unavailable until circuit breaker closes',
    expiryDurationMs: 30 * 60 * 1000, // 30 minutes
    reversalCommand: 'POST /circuit-breaker/close',
  },
] as const;

export class MitigationSelector {
  selectForIncident(
    impact: ImpactAssessment,
    currentState: Record<string, unknown>,
  ): MitigationAction[] {
    return MITIGATION_CATALOG.filter((action) =>
      action.preconditions.every((pre) => {
        if (pre === 'fault_injection_active') return currentState['faultInjectionActive'] === true;
        if (pre === 'duplicate_charge_detected') return impact.knownAffectedRecords.length > 0;
        return false;
      }),
    );
  }
}

// ─── Mitigation Verifier ─────────────────────────────────────────────────────

export interface MitigationResult {
  actionId: string;
  appliedAt: string;
  preActionState: Record<string, unknown>;
  postActionState: Record<string, unknown>;
  adverseEffectDetected: boolean;
  adverseEffectDescription: string | null;
  reversed: boolean;
  escalated: boolean;
}

export class MitigationVerifier {
  /**
   * @node 05.03 — Verify a mitigation action was applied without adverse effects.
   *
   * If adverse effects are detected, the action is reversed.
   * If reversal fails, the incident is escalated.
   */
  async verify(params: {
    actionId: string;
    preActionState: Record<string, unknown>;
    postActionState: Record<string, unknown>;
    adverseEffectCheck: (pre: Record<string, unknown>, post: Record<string, unknown>) => boolean;
    reverseAction: () => Promise<void>;
    escalate: () => Promise<void>;
  }): Promise<MitigationResult> {
    const adverseEffect = params.adverseEffectCheck(
      params.preActionState,
      params.postActionState,
    );

    let reversed = false;
    let escalated = false;

    if (adverseEffect) {
      try {
        await params.reverseAction();
        reversed = true;
      } catch {
        await params.escalate();
        escalated = true;
      }
    }

    return {
      actionId: params.actionId,
      appliedAt: new Date().toISOString(),
      preActionState: params.preActionState,
      postActionState: params.postActionState,
      adverseEffectDetected: adverseEffect,
      adverseEffectDescription: adverseEffect ? 'Post-action state indicates adverse effect' : null,
      reversed,
      escalated,
    };
  }
}
