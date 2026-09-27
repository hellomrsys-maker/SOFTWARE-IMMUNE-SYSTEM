/**
 * @node 01.02.03 — Persistence Processor
 *
 * Opens and commits payment transactions atomically.  All reads and writes to the
 * payments table during a single payment operation go through a single transaction
 * to ensure consistency.
 */

import type { Pool, PoolClient } from 'pg';
import type { PaymentRecord } from './idempotency.js';
import type { PaymentResponse } from '../correctness-spec/invariants.js';

/**
 * @node 01.02.03 — Open a database transaction for payment processing.
 *
 * Returns a PoolClient with an active transaction.  The caller must commit or
 * roll back via the returned client.
 */
export async function openTransaction(db: Pool): Promise<PoolClient> {
  const client = await db.connect();
  await client.query('BEGIN');
  return client;
}

/**
 * @node 01.02.03 — Commit a completed payment to the database.
 *
 * Updates the payments record from 'in_progress' to 'completed' and stores
 * the full result payload within the same transaction.
 */
export async function commitPayment(
  client: PoolClient,
  callerId: string,
  idempotencyKey: string,
  result: PaymentResponse,
): Promise<void> {
  await client.query(
    `UPDATE payments
     SET status = 'completed', result_payload = $3, updated_at = now()
     WHERE caller_id = $1 AND idempotency_key = $2`,
    [callerId, idempotencyKey, JSON.stringify(result)],
  );
}

/**
 * @node 01.02.03 — Mark a payment as failed.
 *
 * Updates the payments record from 'in_progress' to 'failed'.
 */
export async function failPayment(
  client: PoolClient,
  callerId: string,
  idempotencyKey: string,
  errorMessage: string,
): Promise<void> {
  await client.query(
    `UPDATE payments
     SET status = 'failed',
         result_payload = $3,
         updated_at = now()
     WHERE caller_id = $1 AND idempotency_key = $2`,
    [callerId, idempotencyKey, JSON.stringify({ error: errorMessage })],
  );
}

/**
 * @node 01.02.03 — Atomically commit a transaction.
 *
 * Releases the client back to the pool on success or failure.
 */
export async function commitTransaction(client: PoolClient): Promise<void> {
  try {
    await client.query('COMMIT');
  } finally {
    client.release();
  }
}

/**
 * @node 01.02.03 — Roll back a transaction and release the client.
 */
export async function rollbackTransaction(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
}

/**
 * @node 01.02.04 — Query a completed payment record by payment ID.
 *
 * Enforces caller isolation: returns null if the record exists but belongs to a
 * different caller.
 */
export async function queryPaymentById(
  db: Pool,
  paymentId: string,
  callerId: string,
): Promise<PaymentRecord | null> {
  const result = await db.query<{
    id: string;
    logical_id: string;
    idempotency_key: string;
    caller_id: string;
    operation: string;
    amount: string;
    currency: string;
    request_fingerprint: string;
    status: 'in_progress' | 'completed' | 'failed';
    result_payload: PaymentResponse | null;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT id, logical_id, idempotency_key, caller_id, operation,
            amount, currency, request_fingerprint, status, result_payload,
            created_at, updated_at
     FROM payments
     WHERE id = $1 AND caller_id = $2`,
    [paymentId, callerId],
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    id: row.id,
    logicalId: row.logical_id,
    idempotencyKey: row.idempotency_key,
    callerId: row.caller_id,
    operation: row.operation,
    amount: parseFloat(row.amount),
    currency: row.currency,
    requestFingerprint: row.request_fingerprint,
    status: row.status,
    resultPayload: row.result_payload,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
