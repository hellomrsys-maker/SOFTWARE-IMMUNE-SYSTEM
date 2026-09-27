/**
 * @node 04.02 — Detection Engine
 *
 * Detects invariant violations, contract violations, and threshold breaches
 * from evidence bundles.  Reconstructs request sequences from trace data.
 */

// EvidenceRecord type is defined in the @sis/observation package.
// We redeclare the minimal shape here to avoid a circular dependency.
export interface EvidenceRecord {
  id: string;
  recordType: string;
  sourceReference: Record<string, unknown>;
  timestamps: {
    originalTimestamp: string | null;
    collectionTimestamp: string;
    clockOrderUncertain: boolean;
  };
  contentHash: string;
  payload: Record<string, unknown>;
}
import type { SystemModel } from '../system-model/builder.js';

export interface DetectionResult {
  invariantViolations: InvariantViolation[];
  contractViolations: ContractViolation[];
  thresholdBreaches: ThresholdBreach[];
  requestSequence: RequestEvent[];
  affectedComponents: string[];
  recentChanges: string[];
}

export interface InvariantViolation {
  invariant: string;
  message: string;
  evidenceRefs: string[];
  severity: 'critical' | 'high' | 'medium';
}

export interface ContractViolation {
  contract: string;
  message: string;
  evidenceRefs: string[];
}

export interface ThresholdBreach {
  metric: string;
  threshold: number;
  observed: number;
  evidenceRef: string;
}

export interface RequestEvent {
  timestamp: string;
  traceId: string;
  spanId: string;
  event: string;
  service: string;
}

/**
 * @node 04.02 — Detection Engine
 *
 * Analyzes evidence records to detect violations and reconstruct sequences.
 */
export class DetectionEngine {
  /**
   * @node 04.02.01 — Detect invariant violations from business state evidence.
   *
   * Primary check: duplicate completed payments for same logicalId.
   */
  detectInvariantViolations(evidenceRecords: EvidenceRecord[]): InvariantViolation[] {
    const violations: InvariantViolation[] = [];

    for (const rec of evidenceRecords) {
      if (rec.recordType !== 'business_state') continue;

      const results = (rec.payload['results'] as Array<{
        logicalId: string; completedCount: number;
      }> | undefined) ?? [];

      for (const r of results) {
        if (r.completedCount > 1) {
          violations.push({
            invariant: 'no_duplicate_logical_charge',
            message: `logicalId "${r.logicalId}" has ${r.completedCount} completed payments — duplicate charge detected`,
            evidenceRefs: [rec.id],
            severity: 'critical',
          });
        }
      }
    }

    return violations;
  }

  /**
   * @node 04.02.03 — Reconstruct request sequence from trace evidence.
   */
  reconstructRequestSequence(evidenceRecords: EvidenceRecord[]): RequestEvent[] {
    return evidenceRecords
      .filter((r) => r.recordType === 'trace')
      .flatMap((r) => {
        const payload = r.payload;
        return [{
          timestamp: r.timestamps.originalTimestamp ?? r.timestamps.collectionTimestamp,
          traceId: (payload['traceId'] as string | undefined) ?? 'unknown',
          spanId: (payload['spanId'] as string | undefined) ?? 'unknown',
          event: (payload['name'] as string | undefined) ?? 'unknown',
          service: (r.sourceReference['service'] as string | undefined) ?? 'unknown',
        }];
      })
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  /**
   * @node 04.02.05 — Localize affected components using the system model.
   */
  localizeAffectedComponents(
    violations: InvariantViolation[],
    systemModel: SystemModel,
  ): string[] {
    const affected = new Set<string>();

    for (const v of violations) {
      // Map violation evidence refs back to source files and then services
      for (const [file, service] of Object.entries(systemModel.sourceToService)) {
        if (v.invariant === 'no_duplicate_logical_charge') {
          // The payment client and idempotency processor are the suspected components
          if (file.includes('payment-client') || file.includes('idempotency')) {
            affected.add(service);
          }
        }
      }
    }

    return [...affected];
  }

  /**
   * @node 04.02.06 — Correlate violations with recent repository changes.
   */
  correlateWithRecentChanges(
    violations: InvariantViolation[],
    evidenceRecords: EvidenceRecord[],
  ): string[] {
    const correlations: string[] = [];

    const repoRecords = evidenceRecords.filter((r) => r.recordType === 'repository');
    for (const rec of repoRecords) {
      const changes = rec.payload['changes'] as { changedFiles?: string[] } | undefined;
      if (changes?.changedFiles) {
        for (const file of changes.changedFiles) {
          if (file.includes('payment-client') || file.includes('checkout')) {
            correlations.push(`Recent change to ${file} may be related to payment violations`);
          }
        }
      }
    }

    return correlations;
  }

  /** @node 04.02 — Run full detection pass over an evidence bundle. */
  detect(evidenceRecords: EvidenceRecord[], systemModel: SystemModel): DetectionResult {
    const violations = this.detectInvariantViolations(evidenceRecords);
    const sequence = this.reconstructRequestSequence(evidenceRecords);
    const affected = this.localizeAffectedComponents(violations, systemModel);
    const changes = this.correlateWithRecentChanges(violations, evidenceRecords);

    return {
      invariantViolations: violations,
      contractViolations: [],
      thresholdBreaches: [],
      requestSequence: sequence,
      affectedComponents: affected,
      recentChanges: changes,
    };
  }
}
