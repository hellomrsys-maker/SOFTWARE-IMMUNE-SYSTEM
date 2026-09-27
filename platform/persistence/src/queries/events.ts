/**
 * @node 11.02 — Typed query functions for the durable event queue (§03.01).
 */

import type pg from 'pg';

export type EventStatus = 'pending' | 'claimed' | 'acked' | 'nacked' | 'quarantined';

export interface QueueEvent {
  id: string;
  topic: string;
  payload: Record<string, unknown>;
  status: EventStatus;
  attemptCount: number;
  maxAttempts: number;
  leaseToken: string | null;
  leaseExpires: Date | null;
  errorMessage: string | null;
  scheduledAt: Date;
  claimedAt: Date | null;
  ackedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** @node 11.02 — Insert an event into the durable queue. */
export async function enqueueEvent(
  client: pg.PoolClient | pg.Pool,
  params: { topic: string; payload: Record<string, unknown>; maxAttempts?: number; scheduledAt?: Date },
): Promise<QueueEvent> {
  const res = await client.query<Row>(
    `INSERT INTO events (topic, payload, max_attempts, scheduled_at)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [params.topic, JSON.stringify(params.payload), params.maxAttempts ?? 5, params.scheduledAt ?? new Date()],
  );
  return rowToEvent(res.rows[0]!);
}

/**
 * @node 11.02 — Claim the next pending event for a given topic.
 *
 * Uses SELECT … FOR UPDATE SKIP LOCKED to prevent double-claiming.
 * Sets status='claimed', lease_token, and lease_expires.
 */
export async function claimNextEvent(
  client: pg.PoolClient,
  topic: string,
  leaseSeconds = 60,
): Promise<QueueEvent | null> {
  const leaseToken = crypto.randomUUID();
  const res = await client.query<Row>(
    `UPDATE events
     SET status='claimed', lease_token=$2, lease_expires=now()+($3||' seconds')::interval,
         claimed_at=now(), attempt_count=attempt_count+1, updated_at=now()
     WHERE id = (
       SELECT id FROM events
       WHERE topic=$1 AND status='pending' AND scheduled_at<=now()
       ORDER BY scheduled_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     RETURNING *`,
    [topic, leaseToken, leaseSeconds],
  );
  return res.rows[0] ? rowToEvent(res.rows[0]) : null;
}

/** @node 11.02 — Acknowledge a claimed event (marks as acked). */
export async function ackEvent(
  client: pg.PoolClient | pg.Pool,
  eventId: string,
  leaseToken: string,
): Promise<void> {
  await client.query(
    `UPDATE events SET status='acked', acked_at=now(), updated_at=now()
     WHERE id=$1 AND lease_token=$2`,
    [eventId, leaseToken],
  );
}

/** @node 11.02 — Nack a claimed event (retry or quarantine). */
export async function nackEvent(
  client: pg.PoolClient | pg.Pool,
  eventId: string,
  leaseToken: string,
  errorMessage: string,
  backoffMs = 5_000,
): Promise<void> {
  await client.query(
    `UPDATE events
     SET status = CASE WHEN attempt_count >= max_attempts THEN 'quarantined' ELSE 'pending' END,
         lease_token=NULL, lease_expires=NULL,
         scheduled_at = CASE WHEN attempt_count < max_attempts
                             THEN now()+($4||' milliseconds')::interval
                             ELSE scheduled_at END,
         error_message=$3, updated_at=now()
     WHERE id=$1 AND lease_token=$2`,
    [eventId, leaseToken, errorMessage, backoffMs],
  );
}

type Row = {
  id: string; topic: string; payload: Record<string, unknown>;
  status: EventStatus; attempt_count: number; max_attempts: number;
  lease_token: string | null; lease_expires: Date | null;
  error_message: string | null; scheduled_at: Date;
  claimed_at: Date | null; acked_at: Date | null;
  created_at: Date; updated_at: Date;
};

function rowToEvent(row: Row): QueueEvent {
  return {
    id: row.id, topic: row.topic, payload: row.payload,
    status: row.status, attemptCount: row.attempt_count, maxAttempts: row.max_attempts,
    leaseToken: row.lease_token, leaseExpires: row.lease_expires,
    errorMessage: row.error_message, scheduledAt: row.scheduled_at,
    claimedAt: row.claimed_at, ackedAt: row.acked_at,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
