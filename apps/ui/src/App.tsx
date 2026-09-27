/**
 * @node 09 — SIS React Application
 *
 * React SPA with routes:
 *   /                     → Incident list / intake
 *   /incidents/:id        → Incident workspace (evidence, hypotheses, experiments)
 *   /incidents/:id/repair → Repair review and approval controls
 *
 * Bob integration status banner is always rendered at the top so developers
 * immediately see if Bob is running in stub mode (Rule 3).
 */

import { BrowserRouter, Routes, Route, Link, useParams, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { BobStatusBanner } from './components/BobStatusBanner.js';
import { IntakeForm } from './intake/IntakeForm.js';
import { RepairReview } from './repair-review/RepairReview.js';
import { listIncidents } from './api/client.js';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

// ─── Pages ────────────────────────────────────────────────────────────────────

function IncidentListPage(): JSX.Element {
  const navigate = useNavigate();
  const { data } = useQuery({ queryKey: ['incidents'], queryFn: listIncidents });

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Software Immune System</h1>
      <p style={{ color: '#57606a', fontSize: 13, marginBottom: 24 }}>
        Autonomous debugging and repair platform — all deployments require human approval.
      </p>

      <h2 style={{ fontSize: 16, marginBottom: 12 }}>Active Incidents</h2>
      {(data?.incidents ?? []).length === 0 ? (
        <p style={{ color: '#57606a', fontSize: 13, marginBottom: 24 }}>
          No incidents yet. File one below to begin.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {(data?.incidents ?? []).map((inc) => (
            <li key={inc.incidentId} style={{ borderBottom: '1px solid #e5e7eb', padding: '8px 0' }}>
              <Link to={`/incidents/${inc.incidentId}`} style={{ color: '#3b82d4' }}>
                {inc.title}
              </Link>{' '}
              <span style={{ fontSize: 12, color: '#57606a' }}>({inc.status})</span>
            </li>
          ))}
        </ul>
      )}

      <hr style={{ margin: '24px 0', borderColor: '#e5e7eb' }} />
      <IntakeForm onCreated={(id) => void navigate(`/incidents/${id}`)} />
    </div>
  );
}

function IncidentWorkspacePage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  if (!id) return <p>Missing incident ID</p>;

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: 24 }}>
      <p style={{ fontSize: 13, marginBottom: 16 }}>
        <Link to="/" style={{ color: '#3b82d4' }}>← All Incidents</Link>
      </p>
      <h2>Incident Workspace</h2>
      <p style={{ color: '#57606a', fontSize: 13 }}>
        Incident: <code>{id}</code>
      </p>
      <p style={{ fontSize: 13, color: '#57606a', marginTop: 16 }}>
        Evidence browser, hypothesis panel, and experiment results will appear here as the
        investigation progresses.
      </p>
      <div style={{ marginTop: 24 }}>
        <Link
          to={`/incidents/${id}/repair`}
          style={{ background: '#3b82d4', color: '#fff', textDecoration: 'none', borderRadius: 4, padding: '8px 16px', fontSize: 13 }}
        >
          View Repair Review →
        </Link>
      </div>
    </div>
  );
}

function RepairReviewPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  if (!id) return <p>Missing incident ID</p>;

  return (
    <>
      <p style={{ fontSize: 13, padding: '16px 24px 0', maxWidth: 760, margin: '0 auto' }}>
        <Link to={`/incidents/${id}`} style={{ color: '#3b82d4' }}>← Incident Workspace</Link>
      </p>
      <RepairReview incidentId={id} />
    </>
  );
}

// ─── Root App ─────────────────────────────────────────────────────────────────

export default function App(): JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        {/* Rule 3: Bob status banner always rendered — amber when disabled */}
        <BobStatusBanner />
        <Routes>
          <Route path="/" element={<IncidentListPage />} />
          <Route path="/incidents/:id" element={<IncidentWorkspacePage />} />
          <Route path="/incidents/:id/repair" element={<RepairReviewPage />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
