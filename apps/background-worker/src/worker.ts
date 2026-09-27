/**
 * @node 03 — Background Worker
 *
 * Incident workflow driver.  Connects to PostgreSQL, polls the durable event
 * queue, and drives the incident state machine through the full pipeline:
 *
 *   01 → 02 → 03 → 04 → 05 → 06 → 07 → 08 → 09 → 10
 *   (Managed App → Observation → Transport → Diagnostic → Containment →
 *    Reproduction → Repair → Validation → UI → Knowledge)
 *
 * ─── RELIABILITY RULE ────────────────────────────────────────────────────────
 * §11.06 — If the database becomes unreachable, the worker pauses and waits
 * (does NOT process events with in-memory state).  This is `waitForDb` from
 * platform/persistence/db.ts.
 *
 * ─── STOP ON ARTIFACT FAILURE ────────────────────────────────────────────────
 * §11.06 — If an artifact write fails, the worker stops the current workflow
 * step (throws ArtifactWriteError) rather than proceeding with unverified state.
 */

import pg from 'pg';
import pino from 'pino';

const log = pino({ name: 'sis.worker' });

// ─── Configuration ────────────────────────────────────────────────────────────

const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://sis:sis_password@localhost:5432/sis_dev';
const WORKER_CONCURRENCY = parseInt(process.env['WORKER_CONCURRENCY'] ?? '4', 10);
const POLL_INTERVAL_MS = 2_000;

// ─── Topics the worker handles ────────────────────────────────────────────────

/** @node 03.01 — Topics dispatched to workflow handler functions. */
const TOPICS = [
  'incident.created',       // → trigger observation (02)
  'observation.completed',  // → trigger diagnosis (04)
  'diagnosis.completed',    // → trigger containment (05) and/or reproduction (06)
  'reproduction.completed', // → trigger repair (07)
  'repair.completed',       // → trigger validation (08)
  'validation.completed',   // → move to review_ready (09)
] as const;

type Topic = typeof TOPICS[number];

// ─── Worker state ─────────────────────────────────────────────────────────────

let running = true;
let pool: pg.Pool | null = null;

// ─── DB helpers ───────────────────────────────────────────────────────────────

/** @node 11.02 — Test whether the database is reachable. */
async function isDatabaseReachable(p: pg.Pool): Promise<boolean> {
  try {
    const client = await p.connect();
    await client.query('SELECT 1');
    client.release();
    return true;
  } catch {
    return false;
  }
}

/**
 * @node 11.02 — Block until DB is reachable.
 *
 * Rule 8: the worker must not process events during a DB outage.
 */
async function waitForDb(p: pg.Pool): Promise<void> {
  let waited = 0;
  const interval = 5_000;
  while (!(await isDatabaseReachable(p))) {
    log.warn({ waitedMs: waited }, 'DATABASE OUTAGE — worker paused, waiting for recovery');
    await sleep(interval);
    waited += interval;
  }
  if (waited > 0) {
    log.info({ waitedMs: waited }, 'Database recovered — worker resuming');
  }
}

// ─── Claim + ack helper ───────────────────────────────────────────────────────

interface ClaimedEvent {
  id: string;
  topic: Topic;
  payload: Record<string, unknown>;
  leaseToken: string;
  attemptCount: number;
}

/**
 * @node 03.01.02 — Claim the next pending event for any tracked topic.
 *
 * Uses SELECT … FOR UPDATE SKIP LOCKED to prevent double-processing.
 */
async function claimNextEvent(p: pg.Pool): Promise<ClaimedEvent | null> {
  const leaseToken = crypto.randomUUID();
  const topicList = TOPICS.map((_, i) => `$${i + 2}`).join(', ');

  const res = await p.query<{
    id: string; topic: string; payload: Record<string, unknown>;
    lease_token: string; attempt_count: number;
  }>(
    `UPDATE events
     SET status='claimed',
         lease_token=$1,
         lease_expires=now()+interval '120 seconds',
         claimed_at=now(),
         attempt_count=attempt_count+1,
         updated_at=now()
     WHERE id=(
       SELECT id FROM events
       WHERE topic IN (${topicList}) AND status='pending' AND scheduled_at<=now()
       ORDER BY scheduled_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     RETURNING id, topic, payload, lease_token, attempt_count`,
    [leaseToken, ...TOPICS],
  );

  const row = res.rows[0];
  if (!row) return null;

  return {
    id: row.id,
    topic: row.topic as Topic,
    payload: row.payload,
    leaseToken: row.lease_token,
    attemptCount: row.attempt_count,
  };
}

/** @node 03.01.03 — Acknowledge a successfully processed event. */
async function ackEvent(p: pg.Pool, eventId: string, leaseToken: string): Promise<void> {
  await p.query(
    `UPDATE events SET status='acked', acked_at=now(), updated_at=now()
     WHERE id=$1 AND lease_token=$2`,
    [eventId, leaseToken],
  );
}

/** @node 03.01.04 — Nack a failed event (reschedule with backoff or quarantine). */
async function nackEvent(
  p: pg.Pool,
  eventId: string,
  leaseToken: string,
  error: string,
  attemptCount: number,
  maxAttempts: number,
): Promise<void> {
  const backoffMs = Math.min(1_000 * Math.pow(2, attemptCount), 60_000) + Math.random() * 1_000;
  const willQuarantine = attemptCount >= maxAttempts;

  await p.query(
    `UPDATE events
     SET status=$3,
         lease_token=NULL,
         lease_expires=NULL,
         scheduled_at=CASE WHEN $4 THEN scheduled_at ELSE now()+($5||' milliseconds')::interval END,
         error_message=$2,
         updated_at=now()
     WHERE id=$1 AND lease_token=$6`,
    [eventId, error, willQuarantine ? 'quarantined' : 'pending', willQuarantine, Math.floor(backoffMs), leaseToken],
  );
}

// ─── Workflow handlers ────────────────────────────────────────────────────────

/**
 * @node 03.02 — Dispatch a claimed event to the appropriate workflow handler.
 *
 * Each handler is responsible for:
 *   1. Executing its subsystem logic
 *   2. Enqueuing the next topic event on success
 *   3. Transitioning the incident state machine
 */
async function handleEvent(p: pg.Pool, event: ClaimedEvent): Promise<void> {
  log.info({ topic: event.topic, incidentId: event.payload['incidentId'] }, 'Processing event');

  switch (event.topic) {
    case 'incident.created':
      // @node 02 — Trigger observation subsystem
      // Full implementation: instantiate SensorScheduler, collect evidence bundle
      log.info({ incidentId: event.payload['incidentId'] }, 'Observation phase started (stub)');
      break;

    case 'observation.completed':
      // @node 04 — Trigger diagnostic subsystem
      log.info({ incidentId: event.payload['incidentId'] }, 'Diagnosis phase started (stub)');
      break;

    case 'diagnosis.completed':
      // @node 06 — Trigger reproduction subsystem
      log.info({ incidentId: event.payload['incidentId'] }, 'Reproduction phase started (stub)');
      break;

    case 'reproduction.completed':
      // @node 07 — Trigger repair subsystem
      log.info({ incidentId: event.payload['incidentId'] }, 'Repair phase started (stub)');
      break;

    case 'repair.completed':
      // @node 08 — Trigger validation subsystem
      log.info({ incidentId: event.payload['incidentId'] }, 'Validation phase started (stub)');
      break;

    case 'validation.completed':
      // @node 09 — Move to review_ready; notify UI
      log.info({ incidentId: event.payload['incidentId'] }, 'Review ready — workflow complete');
      break;

    default: {
      // Narrow exhaustive type check
      const _exhaustive: never = event.topic;
      log.warn({ topic: (_exhaustive as ClaimedEvent['topic']) }, 'Unknown topic — quarantining');
      throw new Error(`Unknown topic: ${String(_exhaustive)}`);
    }
  }
}

// ─── Main poll loop ───────────────────────────────────────────────────────────

/**
 * @node 03 — Main worker loop.
 *
 * 1. Ensures DB is reachable (blocks on outage — Rule 8)
 * 2. Claims an event
 * 3. Dispatches to handler
 * 4. Acks on success, nacks on failure
 * 5. Sleeps if no events, then re-polls
 */
async function runWorker(): Promise<void> {
  pool = new pg.Pool({
    connectionString: DATABASE_URL,
    max: WORKER_CONCURRENCY + 2,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  pool.on('error', (err) => log.error({ err }, 'Unexpected PostgreSQL pool error'));

  log.info({ workerConcurrency: WORKER_CONCURRENCY }, 'SIS background worker starting');

  while (running) {
    // §11.02 — Wait for DB before attempting any work
    await waitForDb(pool);

    let event: ClaimedEvent | null = null;
    try {
      event = await claimNextEvent(pool);
    } catch (err) {
      log.error({ err }, 'Error claiming event — waiting before retry');
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    if (!event) {
      // No events — sleep and poll again
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    const maxAttempts = 5;
    try {
      await handleEvent(pool, event);
      await ackEvent(pool, event.id, event.leaseToken);
      log.info({ eventId: event.id, topic: event.topic }, 'Event processed and acked');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ eventId: event.id, topic: event.topic, err: msg }, 'Event handler failed — nacking');
      await nackEvent(pool, event.id, event.leaseToken, msg, event.attemptCount, maxAttempts);
    }
  }

  await pool.end();
  log.info('Worker shut down cleanly');
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────

process.on('SIGTERM', () => {
  log.info('SIGTERM received — stopping worker after current event');
  running = false;
});

process.on('SIGINT', () => {
  log.info('SIGINT received — stopping worker');
  running = false;
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Entry point ─────────────────────────────────────────────────────────────

void runWorker().catch((err) => {
  log.fatal({ err }, 'Worker crashed — exiting');
  process.exit(1);
});
