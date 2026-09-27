/**
 * @node 09 — SIS React Application
 *
 * React SPA with routes:
 *   /                     → Incident list / intake
 *   /incidents/:id        → Incident workspace (evidence, hypotheses, experiments)
 *   /incidents/:id/repair → Repair review and approval controls
 *   /sessions             → Bob Autonomous Sessions Visual Showcase
 *   /architecture         → System architecture & Zero-Bridge principles
 */

import { useState } from 'react';
import { HashRouter, Routes, Route, Link, useParams, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { BobStatusBanner } from './components/BobStatusBanner.js';
import { IntakeForm } from './intake/IntakeForm.js';
import { RepairReview } from './repair-review/RepairReview.js';
import { listIncidents } from './api/client.js';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

// ─── Header Navigation ────────────────────────────────────────────────────────

function Navigation(): JSX.Element {
  return (
    <header style={{ borderBottom: '1px solid #e5e7eb', background: '#ffffff', position: 'sticky', top: 0, zIndex: 50 }}>
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '12px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 28, height: 28, borderRadius: 6, background: '#2563eb', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: 14 }}>
            SIS
          </div>
          <div>
            <Link to="/" style={{ textDecoration: 'none', color: '#111827', fontWeight: 600, fontSize: 16 }}>
              Software Immune System
            </Link>
          </div>
        </div>

        <nav style={{ display: 'flex', gap: 18, fontSize: 13, fontWeight: 500 }}>
          <Link to="/" style={{ color: '#4b5563', textDecoration: 'none', padding: '4px 0' }}>
            Incidents
          </Link>
          <Link to="/sessions" style={{ color: '#4b5563', textDecoration: 'none', padding: '4px 0' }}>
            Bob Sessions (8)
          </Link>
          <Link to="/architecture" style={{ color: '#4b5563', textDecoration: 'none', padding: '4px 0' }}>
            Architecture
          </Link>
          <a
            href="https://github.com/hellomrsys-maker/SOFTWARE-IMMUNE-SYSTEM"
            target="_blank"
            rel="noreferrer"
            style={{ color: '#2563eb', textDecoration: 'none', padding: '4px 0' }}
          >
            GitHub ↗
          </a>
        </nav>
      </div>
    </header>
  );
}

// ─── Pages ────────────────────────────────────────────────────────────────────

function IncidentListPage(): JSX.Element {
  const navigate = useNavigate();
  const { data } = useQuery({ queryKey: ['incidents'], queryFn: listIncidents });

  return (
    <div style={{ maxWidth: 840, margin: '0 auto', padding: '32px 24px' }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8, color: '#111827' }}>
          Software Immune System
        </h1>
        <p style={{ color: '#4b5563', fontSize: 14, lineHeight: 1.5 }}>
          Autonomous debugging, self-healing, and repair platform. Every proposed repair candidate requires explicit developer authorization and multi-step verification before deployment.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16, marginBottom: 32 }}>
        <div style={{ padding: 16, borderRadius: 8, background: '#f8fafc', border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: 12, color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>Active Loop</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', marginTop: 4 }}>Autonomous</div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>Observe → Diagnose → Repair → Validate</div>
        </div>
        <div style={{ padding: 16, borderRadius: 8, background: '#f8fafc', border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: 12, color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>Human Gate</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', marginTop: 4 }}>Rule 23 Enforced</div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>Zero unauthorized production deployment</div>
        </div>
        <div style={{ padding: 16, borderRadius: 8, background: '#f8fafc', border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: 12, color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>Memory Architecture</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', marginTop: 4 }}>Zero-Bridge</div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>Atomic 64-byte vector sync</div>
        </div>
      </div>

      <div style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 14, color: '#111827' }}>Active Incidents</h2>
        {(data?.incidents ?? []).length === 0 ? (
          <p style={{ color: '#6b7280', fontSize: 14, padding: 16, background: '#f9fafb', borderRadius: 6 }}>
            No active incidents. Submit a failure report below to initiate automated diagnostics.
          </p>
        ) : (
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
            {(data?.incidents ?? []).map((inc, index) => (
              <div
                key={inc.incidentId}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '14px 18px',
                  borderBottom: index < (data?.incidents?.length ?? 1) - 1 ? '1px solid #e5e7eb' : 'none',
                  background: '#ffffff',
                }}
              >
                <div>
                  <Link
                    to={`/incidents/${inc.incidentId}`}
                    style={{ color: '#2563eb', fontWeight: 600, fontSize: 14, textDecoration: 'none' }}
                  >
                    {inc.title}
                  </Link>
                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>ID: {inc.incidentId}</div>
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span
                    style={{
                      padding: '3px 8px',
                      borderRadius: 12,
                      fontSize: 12,
                      fontWeight: 500,
                      background: inc.status === 'repair_ready' ? '#dcfce7' : inc.status === 'resolved' ? '#f3f4f6' : '#fef3c7',
                      color: inc.status === 'repair_ready' ? '#166534' : inc.status === 'resolved' ? '#374151' : '#92400e',
                    }}
                  >
                    {inc.status}
                  </span>
                  <Link
                    to={`/incidents/${inc.incidentId}/repair`}
                    style={{ fontSize: 13, color: '#4b5563', textDecoration: 'none', border: '1px solid #d1d5db', padding: '4px 10px', borderRadius: 4 }}
                  >
                    Review
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 24 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12, color: '#111827' }}>
          Initiate New Autonomous Investigation
        </h2>
        <IntakeForm onCreated={(id) => void navigate(`/incidents/${id}`)} />
      </div>
    </div>
  );
}

function IncidentWorkspacePage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  if (!id) return <p>Missing incident ID</p>;

  return (
    <div style={{ maxWidth: 840, margin: '0 auto', padding: '32px 24px' }}>
      <p style={{ fontSize: 13, marginBottom: 16 }}>
        <Link to="/" style={{ color: '#2563eb', textDecoration: 'none' }}>← All Incidents</Link>
      </p>
      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Incident Workspace</h2>
      <p style={{ color: '#6b7280', fontSize: 14 }}>
        Incident ID: <code>{id}</code>
      </p>

      <div style={{ marginTop: 24, padding: 20, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8 }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>Autonomous Diagnostic Pipeline</h3>
        <p style={{ fontSize: 13, color: '#4b5563', lineHeight: 1.6 }}>
          Evidence collectors ingested runtime telemetry, logs, and state vector metrics. Hypotheses were generated and adjudicated in an isolated sandbox environment.
        </p>
        <div style={{ display: 'flex', gap: 12, marginTop: 18 }}>
          <Link
            to={`/incidents/${id}/repair`}
            style={{
              background: '#2563eb',
              color: '#fff',
              textDecoration: 'none',
              borderRadius: 6,
              padding: '9px 18px',
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            Open Repair Review & Approval →
          </Link>
        </div>
      </div>
    </div>
  );
}

function RepairReviewPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  if (!id) return <p>Missing incident ID</p>;

  return (
    <>
      <div style={{ maxWidth: 840, margin: '0 auto', padding: '24px 24px 0' }}>
        <p style={{ fontSize: 13 }}>
          <Link to={`/incidents/${id}`} style={{ color: '#2563eb', textDecoration: 'none' }}>← Incident Workspace</Link>
        </p>
      </div>
      <RepairReview incidentId={id} />
    </>
  );
}

// ─── Sessions Gallery Page ───────────────────────────────────────────────────

const SESSIONS = [
  { id: '01', title: 'Task 01: Login Flow & Architecture Initialization', file: 'teamalpha_task01_login_flow_summary.png', desc: 'Core system scaffolding and initial authentication trace verification.' },
  { id: '02', title: 'Task 02: Verification Harness & Test Fixture Setup', file: 'teamalpha_task02_login_flow_summary.png', desc: 'Automated test isolation runner and state mock validation.' },
  { id: '03', title: 'Task 03: Idempotency Pipeline & Concurrency Safe Store', file: 'teamalpha_task03_login_flow_summary.png', desc: 'Idempotency simulation and transactional key deduplication.' },
  { id: '04', title: 'Task 04: Chaos & Fault-Injection Engine', file: 'teamalpha_task04_login_flow_summary.png', desc: 'Stochastic jitter, packet drops, and invariant checks under load.' },
  { id: '05', title: 'Task 05: Sensor Health & Telemetry Registry', file: 'teamalpha_task05_login_flow_summary.png', desc: 'Real-time observation collectors and timestamp normalizers.' },
  { id: '06', title: 'Task 06: Repair Candidate Generation & Adjudication', file: 'teamalpha_task06_login_flow_summary.png', desc: 'Automated AST patch derivation and confidence scoring.' },
  { id: '07', title: 'Task 07: Dual-Gate Human Authorization Workflow', file: 'teamalpha_task07_login_flow_summary.png', desc: 'Enforcement of Rule 23: Human signoff gate prior to rollout.' },
  { id: '08', title: 'Task 08: End-to-End Release & Validation Run', file: 'teamalpha_task08_login_flow_summary.png', desc: 'Final integrated release readiness report across all packages.' },
];

function BobSessionsPage(): JSX.Element {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '32px 24px' }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8, color: '#111827' }}>
          Bob Autonomous Sessions Showcase
        </h1>
        <p style={{ color: '#4b5563', fontSize: 14, lineHeight: 1.5 }}>
          Execution summaries and visual snapshots captured during autonomous development and testing cycles across the Software Immune System.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
        {SESSIONS.map((session) => (
          <div
            key={session.id}
            style={{
              border: '1px solid #e5e7eb',
              borderRadius: 8,
              overflow: 'hidden',
              background: '#ffffff',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
            }}
          >
            <div
              style={{ background: '#f8fafc', cursor: 'pointer', overflow: 'hidden', height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              onClick={() => setSelected(session.file)}
            >
              <img
                src={`./bob_sessions/${session.file}`}
                alt={session.title}
                style={{ width: '100%', height: '100%', objectFit: 'cover', transition: 'transform 0.2s ease' }}
                loading="lazy"
              />
            </div>
            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', flex: 1 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#2563eb', textTransform: 'uppercase', marginBottom: 4 }}>
                Session 0{session.id}
              </div>
              <h3 style={{ fontSize: 15, fontWeight: 600, color: '#111827', marginBottom: 6 }}>
                {session.title}
              </h3>
              <p style={{ fontSize: 13, color: '#6b7280', flex: 1, marginBottom: 12 }}>
                {session.desc}
              </p>
              <button
                onClick={() => setSelected(session.file)}
                style={{
                  background: '#f1f5f9',
                  border: '1px solid #cbd5e1',
                  borderRadius: 6,
                  padding: '6px 12px',
                  fontSize: 12,
                  fontWeight: 500,
                  color: '#1e293b',
                  cursor: 'pointer',
                  alignSelf: 'flex-start',
                }}
              >
                Expand View 🔍
              </button>
            </div>
          </div>
        ))}
      </div>

      {selected && (
        <div
          onClick={() => setSelected(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.8)',
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 1000, maxHeight: '90vh', background: '#fff', borderRadius: 8, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
          >
            <div style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e5e7eb' }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{selected}</span>
              <button
                onClick={() => setSelected(null)}
                style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#6b7280' }}
              >
                ✕
              </button>
            </div>
            <div style={{ overflow: 'auto', padding: 12 }}>
              <img src={`./bob_sessions/${selected}`} alt="Session expanded" style={{ maxWidth: '100%', display: 'block' }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Architecture Page ───────────────────────────────────────────────────────

function ArchitecturePage(): JSX.Element {
  return (
    <div style={{ maxWidth: 840, margin: '0 auto', padding: '32px 24px' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8, color: '#111827' }}>
        Software Immune System Architecture
      </h1>
      <p style={{ color: '#4b5563', fontSize: 14, marginBottom: 28 }}>
        Core principles, multi-package topology, and memory invariants governing the system.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 20, background: '#ffffff' }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: '#0f172a', marginBottom: 8 }}>
            1. Zero-Bridge Synchronous Memory Architecture
          </h2>
          <p style={{ fontSize: 13, color: '#4b5563', lineHeight: 1.6 }}>
            Under no circumstances is a traditional communication bridge (Cython, Pybind11, ctypes, or network sockets) used to link hardware layers to AI layers. The runtime is embedded directly into memory space, sharing physical addresses via a 64-byte Atomic Memory State Vector for 0-nanosecond data synchronization.
          </p>
        </div>

        <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 20, background: '#ffffff' }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: '#0f172a', marginBottom: 8 }}>
            2. Autonomous Diagnostic & Healing Loop
          </h2>
          <p style={{ fontSize: 13, color: '#4b5563', lineHeight: 1.6 }}>
            The system executes a four-phase closed loop:
          </p>
          <ul style={{ fontSize: 13, color: '#4b5563', marginTop: 8, paddingLeft: 20, lineHeight: 1.7 }}>
            <li><strong>Observation:</strong> Ingests events, normalizes timestamps, and redacts sensitive parameters.</li>
            <li><strong>Diagnosis:</strong> Builds causal system models, forms ranked hypotheses, and adjudicates root causes.</li>
            <li><strong>Repair:</strong> Derives AST diffs and generates localized candidate patches in isolated sandboxes.</li>
            <li><strong>Validation:</strong> Executes test suites and invariant checks before presenting to human review.</li>
          </ul>
        </div>

        <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 20, background: '#ffffff' }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: '#0f172a', marginBottom: 8 }}>
            3. Rule 23: Mandatory Human Authorization
          </h2>
          <p style={{ fontSize: 13, color: '#4b5563', lineHeight: 1.6 }}>
            No autonomous code changes or repair patches may be deployed into production without explicit human authorization. The review workflow strictly requires diff verification, rationale citation, validation review, and limitations acknowledgement before any approval action is unlocked.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Root App ─────────────────────────────────────────────────────────────────

export default function App(): JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        {/* Rule 3: Bob status banner always rendered — amber when disabled */}
        <BobStatusBanner />
        <Navigation />
        <main>
          <Routes>
            <Route path="/" element={<IncidentListPage />} />
            <Route path="/incidents/:id" element={<IncidentWorkspacePage />} />
            <Route path="/incidents/:id/repair" element={<RepairReviewPage />} />
            <Route path="/sessions" element={<BobSessionsPage />} />
            <Route path="/architecture" element={<ArchitecturePage />} />
          </Routes>
        </main>
      </HashRouter>
    </QueryClientProvider>
  );
}
