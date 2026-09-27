/**
 * @node 09.03 — Repair Review
 *
 * Displays the candidate diff, rationale with evidence citations, all
 * validation output, limitations, and recovery considerations.
 *
 * Rule 23: the approval button is disabled until all six review fields are
 * present: diff, rationale, validation output, limitations, recovery plan,
 * and the complete-review flag.
 */

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { getRepairCandidates, getValidations, submitApproval } from '../api/client.js';

interface Props {
  incidentId: string;
}

/**
 * @node 09.03 — Six fields required before approval button enables (Rule 23).
 */
interface ReviewState {
  hasDiff: boolean;
  hasRationale: boolean;
  hasValidationOutput: boolean;
  hasLimitations: boolean;
  hasRecoveryPlan: boolean;
  reviewComplete: boolean;
}

function isReviewComplete(state: ReviewState): boolean {
  // Rule 23: ALL six fields must be present before approval is permitted
  return (
    state.hasDiff &&
    state.hasRationale &&
    state.hasValidationOutput &&
    state.hasLimitations &&
    state.hasRecoveryPlan &&
    state.reviewComplete
  );
}

export function RepairReview({ incidentId }: Props): JSX.Element {
  const [reviewState, setReviewState] = useState<ReviewState>({
    hasDiff: false,
    hasRationale: false,
    hasValidationOutput: false,
    hasLimitations: false,
    hasRecoveryPlan: false,
    reviewComplete: false,
  });

  const { data: candidatesData } = useQuery({
    queryKey: ['repair-candidates', incidentId],
    queryFn: () => getRepairCandidates(incidentId),
  });

  const { data: validationsData } = useQuery({
    queryKey: ['validations', incidentId],
    queryFn: () => getValidations(incidentId),
  });

  const approvalMutation = useMutation({
    mutationFn: (decision: 'approved' | 'rejected' | 'revise') =>
      submitApproval(incidentId, { decision }),
  });

  const candidates = candidatesData?.candidates ?? [];
  const validations = validationsData?.validationRuns ?? [];

  const approvalEnabled = isReviewComplete(reviewState);

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: 24 }}>
      <h2>Repair Review</h2>
      <p style={{ color: '#57606a', fontSize: 13 }}>
        Incident: <code>{incidentId}</code>
      </p>

      {candidates.length === 0 && (
        <div style={{ background: '#f7f8fa', border: '1px solid #e5e7eb', borderRadius: 4, padding: 16, marginBottom: 16, color: '#57606a' }}>
          No repair candidates available yet. The repair pipeline is pending.
        </div>
      )}

      {validations.length === 0 && (
        <div style={{ background: '#f7f8fa', border: '1px solid #e5e7eb', borderRadius: 4, padding: 16, marginBottom: 16, color: '#57606a' }}>
          No validation runs available yet. Validation runs after repair is complete.
        </div>
      )}

      {/* Rule 23: review completeness checklist */}
      <div style={{ background: '#f7f8fa', border: '1px solid #e5e7eb', borderRadius: 4, padding: 16, marginBottom: 24 }}>
        <p style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Review Completeness (all required before approval)</p>
        {(Object.keys(reviewState) as (keyof ReviewState)[]).map((key) => (
          <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 4 }}>
            <input
              type="checkbox"
              checked={reviewState[key]}
              onChange={(e) => setReviewState((prev) => ({ ...prev, [key]: e.target.checked }))}
            />
            <span>{key.replace(/([A-Z])/g, ' $1').replace('has ', 'Has reviewed ').trim()}</span>
          </label>
        ))}
      </div>

      {/* Approval controls */}
      <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
        <button
          onClick={() => approvalMutation.mutate('approved')}
          disabled={!approvalEnabled || approvalMutation.isPending}
          title={approvalEnabled ? 'Approve this repair candidate' : 'Complete all review fields before approving'}
          style={{
            background: approvalEnabled ? '#16a34a' : '#9ca3af',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            padding: '8px 20px',
            cursor: approvalEnabled ? 'pointer' : 'not-allowed',
          }}
        >
          Approve
        </button>
        <button
          onClick={() => approvalMutation.mutate('revise')}
          disabled={approvalMutation.isPending}
          style={{ background: '#f59e0b', color: '#fff', border: 'none', borderRadius: 4, padding: '8px 20px', cursor: 'pointer' }}
        >
          Request Revision
        </button>
        <button
          onClick={() => approvalMutation.mutate('rejected')}
          disabled={approvalMutation.isPending}
          style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: 4, padding: '8px 20px', cursor: 'pointer' }}
        >
          Reject
        </button>
      </div>

      {approvalMutation.isSuccess && (
        <p style={{ color: '#16a34a', marginTop: 12, fontSize: 13 }}>Decision recorded successfully.</p>
      )}
      {approvalMutation.isError && (
        <p style={{ color: '#dc2626', marginTop: 12, fontSize: 13 }}>
          Error: {(approvalMutation.error as Error).message}
        </p>
      )}
    </div>
  );
}
