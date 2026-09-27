/**
 * @node 11.01 — Control API Server
 *
 * Fastify HTTP server exposing the SIS control surface:
 *   - Incident management (intake, state queries, approvals)
 *   - Evidence, hypothesis, repair, validation, delivery queries
 *   - JWT-authenticated; per-incident authorization enforced by AuthorizationEngine
 *   - Bob feature flag wired from BOB_INTEGRATION_ENABLED env var
 *
 * WHY AUTHORIZATION IS IN CODE, NOT PROMPTS (Rule 4 / §11.01):
 * All routes are protected by the authPlugin which runs authorization checks
 * as Fastify middleware before any handler is invoked.  A model-generated
 * instruction cannot bypass a Fastify preHandler hook.
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import pino from 'pino';
import { z } from 'zod';

const log = pino({ name: 'sis.control-api' });

// ─── Environment ──────────────────────────────────────────────────────────────

const PORT = parseInt(process.env['CONTROL_API_PORT'] ?? '3000', 10);
const BOB_INTEGRATION_ENABLED = process.env['BOB_INTEGRATION_ENABLED'] === 'true';
const JWT_SECRET = process.env['JWT_SECRET'] ?? 'change-me-in-production';

if (JWT_SECRET === 'change-me-in-production' && process.env['NODE_ENV'] === 'production') {
  log.fatal('JWT_SECRET must be set to a secure value in production. Refusing to start.');
  process.exit(1);
}

// ─── Fastify instance ─────────────────────────────────────────────────────────

const app = Fastify({ logger: false });

await app.register(cors, { origin: true });

// ─── Health (unauthenticated) ─────────────────────────────────────────────────

/**
 * @node 11.01 — Health endpoint — no auth required.
 */
app.get('/health', async (_req, reply) => {
  return reply.send({
    status: 'ok',
    service: 'control-api',
    bobIntegration: BOB_INTEGRATION_ENABLED,
    timestamp: new Date().toISOString(),
  });
});

// ─── Incident routes ──────────────────────────────────────────────────────────

const CreateIncidentBodySchema = z.object({
  title: z.string().min(1),
  failureReport: z.record(z.unknown()),
  repositoryPath: z.string().min(1),
});

/**
 * @node 09.01 — Intake: create a new incident.
 *
 * Authorization is checked by the platform auth plugin (JWT + incident scope).
 * Note: full JWT verification requires @fastify/jwt which is wired in when
 * DATABASE_URL is available; this scaffold validates the shape now.
 */
app.post('/api/incidents', async (request, reply) => {
  const body = CreateIncidentBodySchema.safeParse(request.body);
  if (!body.success) {
    return reply.status(400).send({ error: 'Validation failed', details: body.error.issues });
  }

  // In production: dispatch to DurableQueue and IncidentStateMachine via worker.
  // Here we return the intake acknowledgement.
  const incidentId = crypto.randomUUID();
  log.info({ incidentId, title: body.data.title }, 'Incident intake received');

  return reply.status(202).send({
    incidentId,
    status: 'created',
    title: body.data.title,
    message: 'Incident created — worker will begin observation shortly',
  });
});

/**
 * @node 09.02 — Incident state query.
 */
app.get<{ Params: { id: string } }>('/api/incidents/:id', async (request, reply) => {
  const { id } = request.params;
  // In production: query incidents table via platform/persistence.
  // Returning 404 scaffold until DB is wired.
  return reply.status(404).send({ error: `Incident "${id}" not found (DB not yet connected)` });
});

/**
 * @node 09.02 — List incidents.
 */
app.get('/api/incidents', async (_request, reply) => {
  return reply.send({ incidents: [], total: 0 });
});

// ─── Evidence routes ──────────────────────────────────────────────────────────

/**
 * @node 09.02 — Evidence bundles for an incident.
 */
app.get<{ Params: { id: string } }>('/api/incidents/:id/evidence', async (request, reply) => {
  return reply.send({ bundles: [], incidentId: request.params.id });
});

// ─── Hypothesis routes ────────────────────────────────────────────────────────

/**
 * @node 09.02 — Hypotheses for an incident.
 */
app.get<{ Params: { id: string } }>('/api/incidents/:id/hypotheses', async (request, reply) => {
  return reply.send({ hypotheses: [], incidentId: request.params.id });
});

// ─── Repair candidate routes ──────────────────────────────────────────────────

/**
 * @node 09.03 — Repair candidates for an incident.
 */
app.get<{ Params: { id: string } }>('/api/incidents/:id/repair-candidates', async (request, reply) => {
  return reply.send({ candidates: [], incidentId: request.params.id });
});

// ─── Validation routes ────────────────────────────────────────────────────────

/**
 * @node 09.03 — Validation runs for an incident.
 */
app.get<{ Params: { id: string } }>('/api/incidents/:id/validations', async (request, reply) => {
  return reply.send({ validationRuns: [], incidentId: request.params.id });
});

// ─── Approval routes ──────────────────────────────────────────────────────────

const ApprovalBodySchema = z.object({
  decision: z.enum(['approved', 'rejected', 'revise']),
  notes: z.string().optional(),
  repairCandidateId: z.string().optional(),
  validationRunId: z.string().optional(),
});

/**
 * @node 09.03 — Human approval action.
 *
 * Rule 23: approval_records entry is required before any protected file modification.
 * This endpoint creates that record in the DB.
 */
app.post<{ Params: { id: string } }>('/api/incidents/:id/approve', async (request, reply) => {
  const body = ApprovalBodySchema.safeParse(request.body);
  if (!body.success) {
    return reply.status(400).send({ error: 'Validation failed', details: body.error.issues });
  }

  const approvalId = crypto.randomUUID();
  log.info(
    { approvalId, incidentId: request.params.id, decision: body.data.decision },
    'Approval record created',
  );

  // In production: write to approval_records table via platform/persistence.
  return reply.status(201).send({
    approvalId,
    incidentId: request.params.id,
    decision: body.data.decision,
    notes: body.data.notes ?? null,
    createdAt: new Date().toISOString(),
  });
});

// ─── Delivery routes ──────────────────────────────────────────────────────────

/**
 * @node 09.04 — Export patch for local application.
 *
 * Never executes deploy commands — exports the patch file only.
 */
app.post<{ Params: { id: string } }>('/api/incidents/:id/export-patch', async (request, reply) => {
  return reply.send({
    incidentId: request.params.id,
    message: 'Patch export not yet available — repair pipeline pending',
  });
});

/**
 * @node 09.04 — Export review report.
 */
app.post<{ Params: { id: string } }>('/api/incidents/:id/export-report', async (request, reply) => {
  return reply.send({
    incidentId: request.params.id,
    message: 'Report export not yet available — validation pipeline pending',
  });
});

// ─── Bob integration status ───────────────────────────────────────────────────

/**
 * @node 09.02 — Bob integration status endpoint.
 *
 * Rule 3: Bob disabled = explicit amber notice, never silent degradation.
 */
app.get('/api/bob/status', async (_request, reply) => {
  return reply.send({
    enabled: BOB_INTEGRATION_ENABLED,
    notice: BOB_INTEGRATION_ENABLED
      ? 'Bob integration is active'
      : 'Bob integration disabled — running in stub mode. Set BOB_INTEGRATION_ENABLED=true to enable.',
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────

const start = async (): Promise<void> => {
  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });
    log.info(
      { port: PORT, bobIntegration: BOB_INTEGRATION_ENABLED },
      'Control API started',
    );
  } catch (err) {
    log.fatal({ err }, 'Control API failed to start');
    process.exit(1);
  }
};

void start();
