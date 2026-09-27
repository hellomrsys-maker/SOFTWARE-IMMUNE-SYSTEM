/**
 * @node 10 — Verified Knowledge Subsystem
 *
 * @node 10.01 — Incident Recorder
 * @node 10.02 — Prevention Artifact Generator
 * @node 10.03 — Retrieval Engine
 * @node 10.04 — Knowledge Governance
 *
 * Rule 25: memory alone never authorizes repair — current evidence and validation required.
 * Rule 26: retrieved knowledge provides guidance only.
 */

import { createHash } from 'node:crypto';

// ─── Types ────────────────────────────────────────────────────────────────────

export type KnowledgeStatus = 'candidate' | 'approved' | 'superseded';

export interface KnowledgeRecord {
  id: string;
  incidentId: string | null;
  failureSignature: string;
  component: string;
  contractRef: string | null;
  repoVersion: string | null;
  successfulRepairRef: string | null;
  rejectedRepairRefs: string[];
  testedHypothesisRefs: string[];
  status: KnowledgeStatus;
  version: number;
  supersededBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RetrievalResult {
  record: KnowledgeRecord;
  matchScore: number;
  guidance: string;
  evidenceProvenance: string;
  applicabilityWarning: string | null;
}

// ─── Incident Recorder (10.01) ────────────────────────────────────────────────

export class IncidentRecorder {
  private records: KnowledgeRecord[] = [];

  record(params: {
    id: string;
    incidentId: string;
    failureSignature: string;
    component: string;
    contractRef?: string;
    repoVersion?: string;
    successfulRepairRef?: string;
    rejectedRepairRefs?: string[];
    testedHypothesisRefs?: string[];
  }): KnowledgeRecord {
    const record: KnowledgeRecord = {
      id: params.id,
      incidentId: params.incidentId,
      failureSignature: params.failureSignature,
      component: params.component,
      contractRef: params.contractRef ?? null,
      repoVersion: params.repoVersion ?? null,
      successfulRepairRef: params.successfulRepairRef ?? null,
      rejectedRepairRefs: params.rejectedRepairRefs ?? [],
      testedHypothesisRefs: params.testedHypothesisRefs ?? [],
      status: 'candidate',
      version: 1,
      supersededBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.records.push(record);
    return record;
  }

  getAll(): KnowledgeRecord[] {
    return this.records;
  }
}

// ─── Prevention Artifact Generator (10.02) ───────────────────────────────────

export interface PreventionArtifacts {
  regressionTestRef: string;
  apiClarificationMarkdown: string;
  operationalRunbookUpdate: string;
  monitoringRuleSuggestion: string;
  preventiveChangesForReview: string[];
}

export function generatePreventionArtifacts(record: KnowledgeRecord): PreventionArtifacts {
  return {
    regressionTestRef: `regression_tests/${record.incidentId}`,
    apiClarificationMarkdown:
      `## Payment Client Idempotency Requirement\n\n` +
      `The payment client MUST derive its idempotency key from the logical business operation identity ` +
      `(\`${'{callerId}:${orderId}'}\`) rather than generating a new UUID on each attempt. ` +
      `This ensures that retries after a timeout do not cause duplicate charges.\n`,
    operationalRunbookUpdate:
      `## Duplicate Payment Alert\n\n` +
      `If a duplicate payment alert fires:\n` +
      `1. Identify the affected logical IDs from the alert\n` +
      `2. Query \`SELECT * FROM payments WHERE logical_id = '<affected-id>' AND status = 'completed'\`\n` +
      `3. Escalate to the payments team for manual reconciliation\n` +
      `4. Do NOT issue refunds without explicit authorization\n`,
    monitoringRuleSuggestion:
      `Alert: duplicate_payment_cardinality\n` +
      `Condition: COUNT(payments WHERE logical_id = X AND status = 'completed') > 1\n` +
      `Severity: CRITICAL\n` +
      `Action: page on-call payments engineer immediately\n`,
    preventiveChangesForReview: [
      'Add idempotency key format validation at payment simulator ingress',
      'Add integration test: retry after timeout must not create duplicate charge',
      'Document stable idempotency key derivation in payment client API specification',
    ],
  };
}

// ─── Retrieval Engine (10.03) ─────────────────────────────────────────────────

export class RetrievalEngine {
  constructor(private readonly records: KnowledgeRecord[]) {}

  /**
   * @node 10.03 — Retrieve applicable knowledge records for an incoming failure.
   *
   * Matches by failure signature, component, and repository version.
   * Returns applicabilityWarning when the repo version differs.
   */
  retrieve(params: {
    failureSignature: string;
    component: string;
    repoVersion?: string;
  }): RetrievalResult[] {
    return this.records
      .filter((r) => r.status === 'approved')
      .filter((r) =>
        r.failureSignature === params.failureSignature ||
        r.component === params.component,
      )
      .map((r) => ({
        record: r,
        matchScore: r.failureSignature === params.failureSignature ? 1.0 : 0.5,
        guidance:
          `Known issue in ${r.component}: ${r.failureSignature}. ` +
          (r.successfulRepairRef
            ? `Successful repair documented in ${r.successfulRepairRef}.`
            : 'No repair on record.'),
        evidenceProvenance: `Knowledge record ${r.id} from incident ${r.incidentId}`,
        applicabilityWarning:
          params.repoVersion && r.repoVersion && params.repoVersion !== r.repoVersion
            ? `Knowledge record was validated against repo version ${r.repoVersion}; ` +
              `current version is ${params.repoVersion}. Verify applicability before proceeding.`
            : null,
      }));
  }
}

// ─── Knowledge Governance (10.04) ─────────────────────────────────────────────

export interface RepairAuthorizationResult {
  authorized: false;
  reason: string;
}

/**
 * @node 10.04 — Knowledge Governor
 *
 * Rule 25: memory alone never authorizes repair.
 * `authorizeRepairFromMemory()` ALWAYS returns denied.
 *
 * This is an invariant, not a policy.  It cannot be configured or overridden.
 * Repair authorization requires current evidence and a completed validation run.
 */
export class KnowledgeGovernor {
  private records: KnowledgeRecord[];

  constructor(records: KnowledgeRecord[] = []) {
    this.records = records;
  }

  /**
   * @node 10.04 — Promote a candidate record to approved status.
   *
   * Requires a human approval record ID.
   */
  promote(recordId: string, approvalRecordId: string): KnowledgeRecord {
    const record = this.records.find((r) => r.id === recordId);
    if (!record) throw new Error(`Knowledge record not found: ${recordId}`);
    if (!approvalRecordId) throw new Error('Human approval record ID is required for promotion');

    record.status = 'approved';
    record.version += 1;
    record.updatedAt = new Date();
    return record;
  }

  /** @node 10.04 — Mark a record as superseded by a newer record. */
  supersede(recordId: string, supersededById: string): KnowledgeRecord {
    const record = this.records.find((r) => r.id === recordId);
    if (!record) throw new Error(`Knowledge record not found: ${recordId}`);

    record.status = 'superseded';
    record.supersededBy = supersededById;
    record.updatedAt = new Date();
    return record;
  }

  /**
   * @node 10.04 — Rule 25: Memory alone NEVER authorizes repair.
   *
   * This method always returns denied.  No matter what is in the knowledge store,
   * current evidence collection and a completed validation run are required.
   *
   * This is not a configurable policy — it is a hard invariant.
   */
  authorizeRepairFromMemory(): RepairAuthorizationResult {
    // Rule 25: this always returns Denied. Always. No exceptions. No configuration overrides this.
    return {
      authorized: false,
      reason:
        'Memory alone never authorizes repair — current evidence and validation required. ' +
        'Rule 25 (§10.04): knowledge records provide guidance only, not authorization.',
    };
  }
}
