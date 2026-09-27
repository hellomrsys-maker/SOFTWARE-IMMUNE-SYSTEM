/**
 * @node 01.02.02 — Idempotency Processor
 *
 * Scopes idempotency keys to caller + operation, computes a request fingerprint,
 * atomically reserves operations, reuses completed results, handles concurrent
 * in-progress requests, and rejects conflicting payloads.
 *
 * This is where the payment simulator correctly enforces idempotency.
 * The defect is in the CHECKOUT CLIENT (01.01.03), which fails to supply a
 * stable idempotency key on retries — causing this processor to treat each
 * retry as a new operation.
 */

import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { PaymentRequest, PaymentResponse } from '../correctness-spec/invariants.js';

export interface IdempotencyResult {
  /** Whether this was a pre-existing result (true = reused, false = new reservation) */
  reused: boolean;
  /** Set when an in-progress reservation already exists */
  inProgress: boolean;
  /** The existing payment record, if reused */
  existing?: PaymentRecord;
}

export interface PaymentRecord {
  id: string;
  logicalId: string;
  idempotencyKey: string;
  callerId: string;
  operation: string;
  amount: number;
  currency: string;
  requestFingerprint: string;
  status: 'in_progress' | 'completed' | 'failed';
  resultPayload: PaymentResponse | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * @node 01.02.02 — Compute a deterministic SHA-256 fingerprint for a payment request.
 *
 * The fingerprint covers amount, currency, callerId, and operation.  It does NOT
 * include the idempotency key itself — the key is the lookup handle, the fingerprint
 * detects conflicting payloads.
 */
export function computeRequestFingerprint(req: PaymentRequest): string {
  const canonical = JSON.stringify({
    callerId: req.callerId,
    operation: req.operation,
    amount: req.amount,
    currency: req.currency,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * @node 01.02.02 — Scope an idempotency key to caller and operation.
 *
 * Produces a globally unique key from the caller-supplied key by prepending the
 * callerId and operation, preventing cross-caller key collisions.
 */
export function scopeIdempotencyKey(callerId: string, operation: string, key: string): string {
  return `${callerId}:${operation}:${key}`;
}

/**
 * @node 01.02.02 — Idempotency Processor
 *
 * Uses SELECT … FOR UPDATE SKIP LOCKED inside a serializable transaction to
 * atomically reserve a new operation or detect an in-progress one.
 */
export class IdempotencyProcessor {
  constructor(private readonly db: Pool) {}

  /**
   * @node 01.02.02 — Attempt to reserve a new idempotency slot.
   *
   * Behaviour by case:
   *   A. Key not seen before          → INSERT in_progress record, return { reused: false, inProgress: false }
   *   B. Key exists, status completed → return { reused: true, existing: <record> }
   *   C. Key exists, status in_progress (concurrent) → return { inProgress: true }
   *   D. Key exists, conflicting fingerprint → throws ConflictingPayloadError
   */
  async reserve(client: PoolClient, req: PaymentRequest): Promise<IdempotencyResult> {
    const scopedKey = scopeIdempotencyKey(req.callerId, req.operation, req.idempotencyKey);
    const fingerprint = computeRequestFingerprint(req);

    // Attempt to lock an existing record for this scoped key.
    // SKIP LOCKED means concurrent requests that find the record locked will
    // receive zero rows and can react accordingly.
    const existing = await client.query<{
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
       WHERE caller_id = $1 AND idempotency_key = $2
       FOR UPDATE SKIP LOCKED`,
      [req.callerId, scopedKey],
    );

    if (existing.rows.length > 0) {
      const row = existing.rows[0]!;

      // Case D — conflicting payload: same key, different amount/currency/operation
      if (row.request_fingerprint !== fingerprint) {
        throw new ConflictingPayloadError(
          `Idempotency key "${req.idempotencyKey}" was previously used with a different ` +
            `request payload. Original fingerprint: ${row.request_fingerprint}, ` +
            `new fingerprint: ${fingerprint}`,
          { existing: row.request_fingerprint, incoming: fingerprint },
        );
      }

      // Case C — concurrent in-progress
      if (row.status === 'in_progress') {
        return { reused: false, inProgress: true };
      }

      // Case B — completed result, return it
      const record = rowToRecord(row);
      return { reused: true, inProgress: false, existing: record };
    }

    // Case A — no existing record with SKIP LOCKED:
    // Either it genuinely doesn't exist, or a concurrent request has it locked.
    // Try the INSERT; if it fails with a unique constraint, a concurrent request
    // just inserted it → treat as in_progress.
    try {
      await client.query(
        `INSERT INTO payments
         (logical_id, idempotency_key, caller_id, operation, amount, currency,
          request_fingerprint, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'in_progress')`,
        [
          req.logicalId,
          scopedKey,
          req.callerId,
          req.operation,
          req.amount,
          req.currency,
          fingerprint,
        ],
      );
    } catch (err: unknown) {
      if (isUniqueViolation(err)) {
        // Concurrent insert won the race — treat as in_progress
        return { reused: false, inProgress: true };
      }
      throw err;
    }

    return { reused: false, inProgress: false };
  }

  /**
   * @node 01.02.04 — Status lookup enforcing caller isolation.
   *
   * Returns the payment record for the given logical ID, but only if it belongs
   * to the requesting caller.  Returns null if not found or caller mismatch.
   */
  async lookupByLogicalId(logicalId: string, callerId: string): Promise<PaymentRecord | null> {
    const result = await this.db.query<{
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
       WHERE logical_id = $1 AND caller_id = $2
       LIMIT 1`,
      [logicalId, callerId],
    );

    const row = result.rows[0];
    return row ? rowToRecord(row) : null;
  }
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export class ConflictingPayloadError extends Error {
  constructor(
    message: string,
    public readonly fingerprints: { existing: string; incoming: string },
  ) {
    super(message);
    this.name = 'ConflictingPayloadError';
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rowToRecord(row: {
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
}): PaymentRecord {
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

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === '23505'
  );
}
