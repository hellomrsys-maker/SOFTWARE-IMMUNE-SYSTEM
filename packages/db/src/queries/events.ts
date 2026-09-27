/**
 * @file packages/db/src/queries/events.ts
 * @node 03.01
 * @description Typed query functions for the durable event queue.
 */
import type pg from "pg";
import { query, withTransaction } from "../pool.js";
import { randomUUID } from "crypto";
import { QUEUE_MAX_RETRIES, QUEUE_CLAIM_LEASE_SECONDS, QUEUE_ADMISSION_LIMIT } from "@sis/shared";

export interface EventRow {
  id: string;
  incident_id: string | null;
  event_type: string;
  payload: Record<string, unknown>;
  status: string;
  attempt_count: number;
  max_attempts: number;
  worker_id: string | null;
  lease_expires_at: Date | null;
  next_attempt_at: Date;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
}

/** @node 03.01.01 — Event intake with admission limit */
export async function enqueueEvent(
  incidentId: string | null,
  eventType: string,
  payload: Record<string, unknown>,
  pool?: pg.Pool,
): Promise<EventRow> {
  // node: 03.01.07 — Backpressure: check admission limit before enqueue
  const { rows: countRows } = await query<{ count: string }>(
    "SELECT COUNT(*) as count FROM events WHERE status IN ('pending','claimed')",
    [],
    pool,
  );
  const queueDepth = parseInt(countRows[0]?.count ?? "0", 10);
  if (queueDepth >= QUEUE_ADMISSION_LIMIT) {
    throw new Error(`Queue admission limit (${QUEUE_ADMISSION_LIMIT}) reached — backpressure active`);
  }

  const { rows } = await query<EventRow>(
    `INSERT INTO events (id, incident_id, event_type, payload, status, max_attempts)
     VALUES ($1, $2, $3, $4, 'pending', $5)
     RETURNING *`,
    [randomUUID(), incidentId, eventType, JSON.stringify(payload), QUEUE_MAX_RETRIES],
    pool,
  );
  const row = rows[0];
  if (!row) throw new Error("Failed to enqueue event");
  return row;
}

/** @node 03.01.03 — Worker claim and lease (SELECT FOR UPDATE SKIP LOCKED) */
export async function claimEvent(
  workerId: string,
  pool?: pg.Pool,
): Promise<EventRow | null> {
  return withTransaction(async (client) => {
    const leaseExpiresAt = new Date(Date.now() + QUEUE_CLAIM_LEASE_SECONDS * 1000);
    const { rows } = await client.query<EventRow>(
      `UPDATE events
       SET status = 'claimed',
           worker_id = $1,
           lease_expires_at = $2,
           attempt_count = attempt_count + 1,
           updated_at = now()
       WHERE id = (
           SELECT id FROM events
           WHERE status = 'pending'
             AND next_attempt_at <= now()
           ORDER BY created_at
           LIMIT 1
           FOR UPDATE SKIP LOCKED
       )
       RETURNING *`,
      [workerId, leaseExpiresAt],
    );
    return rows[0] ?? null;
  }, pool);
}

/** @node 03.01.04 — Delivery acknowledgement */
export async function ackEvent(id: string, pool?: pg.Pool): Promise<void> {
  await query(
    "UPDATE events SET status = 'completed', updated_at = now() WHERE id = $1",
    [id],
    pool,
  );
}

/** @node 03.01.05 — Nack with bounded retry and exponential backoff */
export async function nackEvent(
  id: string,
  errorMessage: string,
  pool?: pg.Pool,
): Promise<void> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<EventRow>(
      "SELECT * FROM events WHERE id = $1 FOR UPDATE",
      [id],
    );
    const event = rows[0];
    if (!event) return;

    if (event.attempt_count >= event.max_attempts) {
      // node: 03.01.06 — Quarantine after max retries
      await client.query(
        "UPDATE events SET status = 'quarantined', error_message = $1, updated_at = now() WHERE id = $2",
        [errorMessage, id],
      );
      return;
    }

    // Exponential backoff: 2^attempt * 1000ms, capped at 30s
    const backoffMs = Math.min(
      Math.pow(2, event.attempt_count) * 1000,
      30_000,
    );
    const nextAttemptAt = new Date(Date.now() + backoffMs);

    await client.query(
      `UPDATE events
       SET status = 'pending', worker_id = NULL, lease_expires_at = NULL,
           next_attempt_at = $1, error_message = $2, updated_at = now()
       WHERE id = $3`,
      [nextAttemptAt, errorMessage, id],
    );
  }, pool);
}

export async function getQueueDepth(pool?: pg.Pool): Promise<number> {
  const { rows } = await query<{ count: string }>(
    "SELECT COUNT(*) as count FROM events WHERE status IN ('pending','claimed')",
    [],
    pool,
  );
  return parseInt(rows[0]?.count ?? "0", 10);
}
