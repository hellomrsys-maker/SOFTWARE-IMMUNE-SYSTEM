/**
 * @node 09 — API client
 *
 * Typed fetch wrappers for all control-api endpoints.
 * All calls go to /api (proxied by Vite dev server; in production, same origin).
 */

const BASE = '/api';

// In-memory / localStorage fallback when running as a static site (e.g. GitHub Pages)
const DEFAULT_INCIDENTS: IncidentRef[] = [
  {
    incidentId: 'inc-payment-001',
    status: 'repair_ready',
    title: 'Payment simulator idempotency collision under high concurrency',
  },
  {
    incidentId: 'inc-memory-002',
    status: 'investigating',
    title: 'Zero-Bridge atomic memory state vector boundary overflow',
  },
  {
    incidentId: 'inc-diagnostic-003',
    status: 'resolved',
    title: 'Telemetry stream packet jitter causing sensor desync',
  },
];

function getStoredIncidents(): IncidentRef[] {
  try {
    const raw = localStorage.getItem('sis_incidents');
    if (raw) return JSON.parse(raw);
  } catch {
    // fallback
  }
  return DEFAULT_INCIDENTS;
}

function saveStoredIncidents(incidents: IncidentRef[]) {
  try {
    localStorage.setItem('sis_incidents', JSON.stringify(incidents));
  } catch {
    // ignore
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { 'Content-Type': 'application/json', ...init?.headers },
      ...init,
    });
    if (res.ok) {
      return (await res.json()) as T;
    }
  } catch {
    // Network or static hosting fallback
  }

  // Fallback mocks for static site deployment (GitHub Pages)
  if (path === '/bob/status') {
    return {
      enabled: false,
      notice: 'Bob Autonomous Engine in Demo/Standby Mode — Live on GitHub Pages',
    } as unknown as T;
  }

  if (path === '/incidents' && (!init || init.method === 'GET')) {
    const list = getStoredIncidents();
    return { incidents: list, total: list.length } as unknown as T;
  }

  if (path === '/incidents' && init?.method === 'POST') {
    const body = JSON.parse(init.body as string) as IncidentIntake;
    const newInc: IncidentRef = {
      incidentId: `inc-${Date.now().toString(36)}`,
      status: 'investigating',
      title: body.title,
    };
    const list = [newInc, ...getStoredIncidents()];
    saveStoredIncidents(list);
    return newInc as unknown as T;
  }

  if (path.startsWith('/incidents/') && path.endsWith('/evidence')) {
    return {
      bundles: [
        { id: 'ev-01', type: 'log', summary: 'Idempotency key duplicate collision detected at timestamp 14:22:01.849Z' },
        { id: 'ev-02', type: 'metric', summary: 'Error rate spiked to 14.8% on payment-processor pod-04' },
      ],
    } as unknown as T;
  }

  if (path.startsWith('/incidents/') && path.endsWith('/hypotheses')) {
    return {
      hypotheses: [
        { id: 'hyp-01', text: 'Race condition in in-memory map without atomic mutex reservation', score: 0.94 },
      ],
    } as unknown as T;
  }

  if (path.startsWith('/incidents/') && path.endsWith('/repair-candidates')) {
    return {
      candidates: [
        {
          id: 'rep-01',
          patchSummary: 'Add atomic compare-and-swap key locking in idempotency processor',
          confidence: 0.98,
        },
      ],
    } as unknown as T;
  }

  if (path.startsWith('/incidents/') && path.endsWith('/validations')) {
    return {
      validationRuns: [
        { id: 'val-01', status: 'passed', testsRun: 42, passed: 42, failed: 0 },
      ],
    } as unknown as T;
  }

  if (path.startsWith('/incidents/') && path.endsWith('/approve')) {
    return { status: 'recorded' } as unknown as T;
  }

  if (path.startsWith('/incidents/')) {
    const id = path.replace('/incidents/', '');
    const found = getStoredIncidents().find((i) => i.incidentId === id);
    return (found || { incidentId: id, status: 'investigating', title: 'System Investigation' }) as unknown as T;
  }

  throw new Error(`Endpoint ${path} not available`);
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
