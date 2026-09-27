/**
 * @node 09 — API client
 *
 * Typed fetch wrappers for all control-api endpoints.
 * All calls go to /api (proxied by Vite dev server; in production, same origin).
 */

const BASE = '/api';

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ─── Incidents ────────────────────────────────────────────────────────────────

export interface IncidentIntake {
  title: string;
  failureReport: Record<string, unknown>;
  repositoryPath: string;
}

export interface IncidentRef {
  incidentId: string;
  status: string;
  title: string;
}

export const createIncident = (body: IncidentIntake): Promise<IncidentRef> =>
  apiFetch('/incidents', { method: 'POST', body: JSON.stringify(body) });

export const getIncident = (id: string): Promise<IncidentRef> =>
  apiFetch(`/incidents/${id}`);

export const listIncidents = (): Promise<{ incidents: IncidentRef[]; total: number }> =>
  apiFetch('/incidents');

// ─── Evidence ─────────────────────────────────────────────────────────────────

export const getEvidence = (incidentId: string): Promise<{ bundles: unknown[] }> =>
  apiFetch(`/incidents/${incidentId}/evidence`);

// ─── Hypotheses ───────────────────────────────────────────────────────────────

export const getHypotheses = (incidentId: string): Promise<{ hypotheses: unknown[] }> =>
  apiFetch(`/incidents/${incidentId}/hypotheses`);

// ─── Repair ───────────────────────────────────────────────────────────────────

export const getRepairCandidates = (incidentId: string): Promise<{ candidates: unknown[] }> =>
  apiFetch(`/incidents/${incidentId}/repair-candidates`);

// ─── Validation ───────────────────────────────────────────────────────────────

export const getValidations = (incidentId: string): Promise<{ validationRuns: unknown[] }> =>
  apiFetch(`/incidents/${incidentId}/validations`);

// ─── Approval ─────────────────────────────────────────────────────────────────

export interface ApprovalPayload {
  decision: 'approved' | 'rejected' | 'revise';
  notes?: string;
  repairCandidateId?: string;
  validationRunId?: string;
}

export const submitApproval = (incidentId: string, payload: ApprovalPayload): Promise<unknown> =>
  apiFetch(`/incidents/${incidentId}/approve`, { method: 'POST', body: JSON.stringify(payload) });

// ─── Bob status ───────────────────────────────────────────────────────────────

export interface BobStatus {
  enabled: boolean;
  notice: string;
}

export const getBobStatus = (): Promise<BobStatus> => apiFetch('/bob/status');
