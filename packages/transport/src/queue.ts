/**
 * @node 03.01 — Durable Event Queue
 *
 * PostgreSQL-backed reliable event queue with:
 *   - Enqueue with scheduled delivery
 *   - Claim with lease (prevents duplicate processing)
 *   - Ack / Nack with exponential-backoff retry
 *   - Quarantine after max_attempts exceeded
 *   - Backpressure admission check
 *
 * Limitation: claim uses SELECT FOR UPDATE SKIP LOCKED; under very high
 * concurrency some events may remain unclaimed for longer than expected.
 */

import { v4 as uuidv4 } from 'uuid';
import type { Pool, PoolClient } from 'pg';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EnqueueOptions {
  topic: string;
  payload: unknown;
  maxAttempts?: number;
  /** ISO datetime string; defaults to now */
  scheduledAt?: string;
}

export interface QueuedEvent {
  id: string;
  topic: string;
  payload: unknown;
  status: 'pending' | 'claimed' | 'acked' | 'nacked' | 'quarantined';
  attemptCount: number;
  maxAttempts: number;
  leaseToken: string | null;
  leaseExpires: Date | null;
  errorMessage: string | null;
  scheduledAt: Date;
  createdAt: Date;
}

// ─── DurableQueue ─────────────────────────────────────────────────────────────

/**
 * @node 03.01 — DurableQueue
 */
export class DurableQueue {
  /** @node 03.01.05 — Backpressure threshold: queue depth above this blocks new enqueues */
  private readonly backpressureThreshold: number;

  constructor(
    private readonly db: Pool,
    options: { backpressureThreshold?: number } = {},
  ) {
    this.backpressureThreshold = options.backpressureThreshold ?? 1000;
  }

  /**
   * @node 03.01.01 — Enqueue an event.
   *
   * Performs a backpressure admission check before inserting.
   * Throws AdmissionError if the pending queue depth exceeds the threshold.
   */
  async enqueue(options: EnqueueOptions): Promise<QueuedEvent> {
    const depth = await this.pendingDepth(options.topic);
    if (depth >= this.backpressureThreshold) {
      throw new QueueAdmissionError(options.topic, depth, this.backpressureThreshold);
    }

    const result = await this.db.query<QueuedEventRow>(
      `INSERT INTO events (topic, payload, max_attempts, scheduled_at)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [
        options.topic,
        JSON.stringify(options.payload),
        options.maxAttempts ?? 5,
        options.scheduledAt ? new Date(options.scheduledAt) : new Date(),
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error('DurableQueue.enqueue: no row returned');
    return rowToEvent(row);
  }

  /**
   * @node 03.01.02 — Claim an event with a lease.
   *
   * Atomically claims the next pending event for the given topic and sets a
   * lease expiry.  Returns null if no event is available.
   */
  async claim(topic: string, leaseDurationMs = 30_000): Promise<QueuedEvent | null> {
    const leaseToken = uuidv4();
    const leaseExpires = new Date(Date.now() + leaseDurationMs);

    const result = await this.db.query<QueuedEventRow>(
      `UPDATE events
       SET status = 'claimed',
           lease_token = $2,
           lease_expires = $3,
           claimed_at = now(),
           attempt_count = attempt_count + 1,
           updated_at = now()
       WHERE id = (
         SELECT id FROM events
         WHERE topic = $1
           AND status = 'pending'
           AND scheduled_at <= now()
         ORDER BY scheduled_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING *`,
      [topic, leaseToken, leaseExpires],
    );

    const row = result.rows[0];
    return row ? rowToEvent(row) : null;
  }

  /**
   * @node 03.01.03 — Acknowledge a claimed event as successfully processed.
   */
  async ack(eventId: string, leaseToken: string): Promise<void> {
    await this.db.query(
      `UPDATE events
       SET status = 'acked', acked_at = now(), updated_at = now()
       WHERE id = $1 AND lease_token = $2 AND status = 'claimed'`,
      [eventId, leaseToken],
    );
  }

  /**
   * @node 03.01.03 — Nack a claimed event (processing failed).
   *
   * Increments retry counter.  If max_attempts is exceeded, quarantines the event.
   * Otherwise schedules the next attempt with bounded exponential backoff + jitter.
   */
  async nack(eventId: string, leaseToken: string, errorMessage: string): Promise<void> {
    const result = await this.db.query<{
      attempt_count: number;
      max_attempts: number;
    }>(
      `SELECT attempt_count, max_attempts FROM events WHERE id = $1`,
      [eventId],
    );
    const row = result.rows[0];
    if (!row) return;

    if (row.attempt_count >= row.max_attempts) {
      await this.db.query(
        `UPDATE events
         SET status = 'quarantined', error_message = $2, updated_at = now()
         WHERE id = $1`,
        [eventId, errorMessage],
      );
      return;
    }

    // Bounded exponential backoff: base 2s, max 60s, +/- 20% jitter
    const backoffMs = Math.min(2000 * 2 ** (row.attempt_count - 1), 60_000);
    const jitter = backoffMs * 0.2 * (Math.random() * 2 - 1);
    const nextScheduled = new Date(Date.now() + backoffMs + jitter);

    await this.db.query(
      `UPDATE events
       SET status = 'pending',
           lease_token = NULL,
           lease_expires = NULL,
           error_message = $2,
           scheduled_at = $3,
           updated_at = now()
       WHERE id = $1 AND lease_token = $3`,
      [eventId, errorMessage, nextScheduled],
    );
    // Use separate update to avoid parameter conflict
    await this.db.query(
      `UPDATE events
       SET status = 'pending',
           lease_token = NULL,
           lease_expires = NULL,
           error_message = $2,
           scheduled_at = $3,
           updated_at = now()
       WHERE id = $1 AND lease_token = $4`,
      [eventId, errorMessage, nextScheduled, leaseToken],
    );
  }

  /** @node 03.01.04 — Return count of pending events for a topic. */
  async pendingDepth(topic: string): Promise<number> {
    const result = await this.db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM events WHERE topic = $1 AND status = 'pending'`,
      [topic],
    );
    return parseInt(result.rows[0]?.count ?? '0', 10);
  }

  /** @node 03.01.05 — Reclaim expired leases back to pending. */
  async reclaimExpiredLeases(): Promise<number> {
    const result = await this.db.query(
      `UPDATE events
       SET status = 'pending', lease_token = NULL, lease_expires = NULL, updated_at = now()
       WHERE status = 'claimed' AND lease_expires < now()`,
    );
    return result.rowCount ?? 0;
  }
}

// ─── Errors ───────────────────────────────────────────────────────────────────

/** @node 03.01.05 — Thrown when backpressure threshold is exceeded. */
export class QueueAdmissionError extends Error {
  constructor(
    public readonly topic: string,
    public readonly currentDepth: number,
    public readonly threshold: number,
  ) {
    super(
      `Queue admission denied for topic "${topic}": depth ${currentDepth} >= threshold ${threshold}`,
    );
    this.name = 'QueueAdmissionError';
  }
}

// ─── Internal row type ────────────────────────────────────────────────────────

interface QueuedEventRow {
  id: string;
  topic: string;
  payload: unknown;
  status: QueuedEvent['status'];
  attempt_count: number;
  max_attempts: number;
  lease_token: string | null;
  lease_expires: Date | null;
  error_message: string | null;
  scheduled_at: Date;
  created_at: Date;
}

function rowToEvent(row: QueuedEventRow): QueuedEvent {
  return {
    id: row.id,
    topic: row.topic,
    payload: row.payload,
    status: row.status,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    leaseToken: row.lease_token,
    leaseExpires: row.lease_expires,
    errorMessage: row.error_message,
    scheduledAt: row.scheduled_at,
    createdAt: row.created_at,
  };
}

// ─── Nack helper (exported for callers that hold a client) ────────────────────

/**
 * @node 03.01.03 — Nack within a transaction client.
 * Same logic as DurableQueue.nack but accepts a PoolClient.
 */
export async function nackWithClient(
  client: PoolClient,
  eventId: string,
  leaseToken: string,
  errorMessage: string,
  attemptCount: number,
  maxAttempts: number,
): Promise<void> {
  if (attemptCount >= maxAttempts) {
    await client.query(
      `UPDATE events SET status = 'quarantined', error_message = $2, updated_at = now() WHERE id = $1`,
      [eventId, errorMessage],
    );
    return;
  }
  const backoffMs = Math.min(2000 * 2 ** (attemptCount - 1), 60_000);
  const jitter = backoffMs * 0.2 * (Math.random() * 2 - 1);
  const nextScheduled = new Date(Date.now() + backoffMs + jitter);
  await client.query(
    `UPDATE events
     SET status = 'pending', lease_token = NULL, lease_expires = NULL,
         error_message = $2, scheduled_at = $3, updated_at = now()
     WHERE id = $1 AND lease_token = $4`,
    [eventId, errorMessage, nextScheduled, leaseToken],
  );
}
