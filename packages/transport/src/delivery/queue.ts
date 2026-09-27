/**
 * @node 03.01 — Durable Queue
 *
 * PostgreSQL-backed reliable event delivery with:
 *   - Claim + lease (prevents double-processing)
 *   - Exponential backoff with jitter on nack
 *   - Max-attempt quarantine
 *   - Backpressure admission check
 *
 * Uses SELECT … FOR UPDATE SKIP LOCKED so concurrent workers don't fight.
 */

import { v4 as uuidv4 } from 'uuid';
import type pg from 'pg';

export type EventStatus = 'pending' | 'claimed' | 'acked' | 'nacked' | 'quarantined';

export interface DurableEvent {
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
  createdAt: Date;
}

/** @node 03.01 — Backpressure: max pending events per topic before admission is denied. */
const DEFAULT_BACKPRESSURE_LIMIT = 1000;

export class DurableQueue {
  constructor(
    private readonly db: pg.Pool,
    private readonly backpressureLimit = DEFAULT_BACKPRESSURE_LIMIT,
  ) {}

  /**
   * @node 03.01.01 — Enqueue an event.
   *
   * Rejects with BackpressureError when pending count >= backpressureLimit.
   */
  async enqueue(params: {
    topic: string;
    payload: Record<string, unknown>;
    maxAttempts?: number;
    scheduledAt?: Date;
  }): Promise<DurableEvent> {
    // Backpressure admission check
    const depth = await this.pendingCount(params.topic);
    if (depth >= this.backpressureLimit) {
      throw new BackpressureError(
        `Topic "${params.topic}" has ${depth} pending events (limit: ${this.backpressureLimit})`,
        params.topic,
        depth,
      );
    }

    const id = uuidv4();
    const res = await this.db.query<EventRow>(
      `INSERT INTO events (id, topic, payload, max_attempts, scheduled_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [id, params.topic, JSON.stringify(params.payload), params.maxAttempts ?? 5, params.scheduledAt ?? new Date()],
    );
    return rowToEvent(res.rows[0]!);
  }

  /**
   * @node 03.01.02 — Claim the next pending event for a topic.
   *
   * Returns null if no eligible event exists.
   * Uses SELECT … FOR UPDATE SKIP LOCKED to prevent double-claiming.
   */
  async claim(topic: string, leaseSeconds = 60): Promise<DurableEvent | null> {
    const leaseToken = uuidv4();
    const res = await this.db.query<EventRow>(
      `UPDATE events
       SET status='claimed',
           lease_token=$2,
           lease_expires=now()+($3||' seconds')::interval,
           claimed_at=now(),
           attempt_count=attempt_count+1,
           updated_at=now()
       WHERE id=(
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

  /** @node 03.01.03 — Acknowledge a claimed event (marks acked). */
  async ack(eventId: string, leaseToken: string): Promise<void> {
    await this.db.query(
      `UPDATE events SET status='acked', acked_at=now(), updated_at=now()
       WHERE id=$1 AND lease_token=$2`,
      [eventId, leaseToken],
    );
  }

  /**
   * @node 03.01.04 — Nack a claimed event.
   *
   * Re-schedules with exponential backoff + jitter, or quarantines if maxAttempts reached.
   */
  async nack(eventId: string, leaseToken: string, errorMessage: string): Promise<void> {
    // Read current attempt count to compute backoff
    const res = await this.db.query<{ attempt_count: number; max_attempts: number }>(
      `SELECT attempt_count, max_attempts FROM events WHERE id=$1`,
      [eventId],
    );
    const row = res.rows[0];
    if (!row) return;

    const backoffMs = exponentialBackoffWithJitter(row.attempt_count);
    const willQuarantine = row.attempt_count >= row.max_attempts;

    await this.db.query(
      `UPDATE events
       SET status = $3,
           lease_token=NULL,
           lease_expires=NULL,
           scheduled_at = CASE WHEN $4 THEN scheduled_at
                               ELSE now()+($5||' milliseconds')::interval END,
           error_message=$2,
           updated_at=now()
       WHERE id=$1 AND lease_token=$6`,
      [eventId, errorMessage, willQuarantine ? 'quarantined' : 'pending',
       willQuarantine, backoffMs, leaseToken],
    );
  }

  /** @node 03.01.05 — Quarantine an event immediately (skip retry logic). */
  async quarantine(eventId: string, reason: string): Promise<void> {
    await this.db.query(
      `UPDATE events SET status='quarantined', error_message=$2, updated_at=now() WHERE id=$1`,
      [eventId, reason],
    );
  }

  /** @node 03.01.06 — Count pending events for a topic (for backpressure). */
  async pendingCount(topic: string): Promise<number> {
    const res = await this.db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM events WHERE topic=$1 AND status='pending'`,
      [topic],
    );
    return parseInt(res.rows[0]?.count ?? '0', 10);
  }

  /** @node 03.01.07 — Recover expired leases back to pending. */
  async recoverExpiredLeases(): Promise<number> {
    const res = await this.db.query<{ rowcount: string }>(
      `WITH recovered AS (
         UPDATE events
         SET status='pending', lease_token=NULL, lease_expires=NULL, updated_at=now()
         WHERE status='claimed' AND lease_expires < now()
         RETURNING id
       ) SELECT count(*) as rowcount FROM recovered`,
    );
    return parseInt(res.rows[0]?.rowcount ?? '0', 10);
  }
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export class BackpressureError extends Error {
  constructor(
    message: string,
    public readonly topic: string,
    public readonly depth: number,
  ) {
    super(message);
    this.name = 'BackpressureError';
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** @node 03.01 — Exponential backoff with jitter: base*2^attempt + random(0..1000)ms */
export function exponentialBackoffWithJitter(attempt: number): number {
  const base = 1_000; // 1 second
  const cap = 60_000; // 60 seconds max
  const exp = Math.min(base * Math.pow(2, attempt), cap);
  return exp + Math.floor(Math.random() * 1_000);
}

type EventRow = {
  id: string; topic: string; payload: Record<string, unknown>;
  status: EventStatus; attempt_count: number; max_attempts: number;
  lease_token: string | null; lease_expires: Date | null;
  error_message: string | null; scheduled_at: Date;
  claimed_at: Date | null; acked_at: Date | null;
  created_at: Date; updated_at: Date;
};

function rowToEvent(row: EventRow): DurableEvent {
  return {
    id: row.id, topic: row.topic, payload: row.payload,
    status: row.status, attemptCount: row.attempt_count, maxAttempts: row.max_attempts,
    leaseToken: row.lease_token, leaseExpires: row.lease_expires,
    errorMessage: row.error_message, scheduledAt: row.scheduled_at,
    createdAt: row.created_at,
  };
}
