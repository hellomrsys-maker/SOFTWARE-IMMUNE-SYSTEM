/**
 * @node 01.02 — Payment Simulator — Request Processor
 *
 * Validates incoming payment requests, coordinates idempotency, fault injection,
 * and persistence.  This is the entry point for all payment operations.
 *
 * @node 01.02.01 — Request validation: amount, currency, caller context, idempotency input.
 */

import { v4 as uuidv4 } from 'uuid';
import type { Pool } from 'pg';
import { z } from 'zod';
import { IdempotencyProcessor, scopeIdempotencyKey } from './idempotency.js';
import {
  openTransaction,
  commitPayment,
  failPayment,
  commitTransaction,
  rollbackTransaction,
} from './persistence.js';
import {
  FaultInjectionEngine,
  applyDelayAfterCommit,
  shouldDropAfterCommit,
  isTemporarilyUnavailable,
} from '../fault-injection/engine.js';
import type { PaymentRequest, PaymentResponse } from '../correctness-spec/invariants.js';

// ─── Validation schema ────────────────────────────────────────────────────────

/** @node 01.02.01 — Input validation schema for payment requests */
export const PaymentRequestInputSchema = z.object({
  logicalId: z.string().min(1, 'logicalId is required'),
  idempotencyKey: z.string().min(1, 'idempotencyKey is required'),
  callerId: z.string().min(1, 'callerId is required'),
  operation: z.string().min(1, 'operation is required'),
  amount: z.number().positive('amount must be positive'),
  currency: z.string().length(3, 'currency must be ISO 4217 (3 chars)'),
});

// ─── Processor ────────────────────────────────────────────────────────────────

export class PaymentProcessor {
  private readonly idempotency: IdempotencyProcessor;
  private readonly faultEngine: FaultInjectionEngine;

  constructor(private readonly db: Pool) {
    this.idempotency = new IdempotencyProcessor(db);
    this.faultEngine = new FaultInjectionEngine(db);
  }

  /**
   * @node 01.02.01 — Process a payment request.
   *
   * Steps:
   *   1. Validate input (amount, currency, caller context, idempotency key).
   *   2. Check for temporary_unavailability fault.
   *   3. Open transaction.
   *   4. Reserve idempotency slot (or return existing result).
   *   5. Process the payment.
   *   6. Apply delay_after_commit or drop_after_commit fault if active.
   *   7. Commit and return result.
   */
  async process(input: unknown): Promise<PaymentProcessorResult> {
    // Step 1 — validate
    const parsed = PaymentRequestInputSchema.safeParse(input);
    if (!parsed.success) {
      return {
        status: 'validation_error',
        errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      };
    }
    const req: PaymentRequest = parsed.data;

    // Step 2 — temporary unavailability fault
    const unavailFault = await this.faultEngine.getActive('temporary_unavailability');
    if (isTemporarilyUnavailable(unavailFault)) {
      return { status: 'unavailable', message: 'Service temporarily unavailable (fault injected)' };
    }

    // Step 3 — open transaction
    const client = await openTransaction(this.db);
    const scopedKey = scopeIdempotencyKey(req.callerId, req.operation, req.idempotencyKey);

    try {
      // Step 4 — idempotency reservation
      const idempResult = await this.idempotency.reserve(client, req);

      if (idempResult.inProgress) {
        await rollbackTransaction(client);
        return { status: 'in_progress', message: 'A concurrent request is processing this operation' };
      }

      if (idempResult.reused && idempResult.existing) {
        await rollbackTransaction(client);
        const existing = idempResult.existing;
        return {
          status: 'ok',
          payment: {
            paymentId: existing.id,
            status: existing.status as 'completed' | 'failed' | 'in_progress',
            amount: existing.amount,
            currency: existing.currency,
            idempotencyKey: req.idempotencyKey,
            createdAt: existing.createdAt.toISOString(),
          },
          reused: true,
        };
      }

      // Step 5 — process the payment (simulated — always succeeds for valid amounts)
      const paymentId = uuidv4();
      const result: PaymentResponse = {
        paymentId,
        status: 'completed',
        amount: req.amount,
        currency: req.currency,
        idempotencyKey: req.idempotencyKey,
        createdAt: new Date().toISOString(),
      };

      // Step 6a — delay_after_commit fault (fires after persistence, before response)
      const delayFault = await this.faultEngine.getActive('delay_after_commit');
      const dropFault = await this.faultEngine.getActive('drop_after_commit');

      // Persist the completed payment while still in transaction
      await commitPayment(client, req.callerId, scopedKey, result);
      await commitTransaction(client);

      // Step 6b — apply delay AFTER commit (simulates slow network response post-persist)
      if (delayFault?.active) {
        await applyDelayAfterCommit(delayFault.config.durationMs ?? 5000);
      }

      // Step 6c — drop AFTER commit (server persisted but never responds)
      if (dropFault?.active && shouldDropAfterCommit()) {
        // Simulate a connection drop — return a sentinel that the HTTP layer converts
        // to a closed connection (or very long silence).
        return { status: 'dropped', message: 'Connection dropped after commit (fault injected)' };
      }

      return { status: 'ok', payment: result, reused: false };
    } catch (err: unknown) {
      await rollbackTransaction(client).catch(() => undefined);

      if ((err as Error).name === 'ConflictingPayloadError') {
        return {
          status: 'conflict',
          message: (err as Error).message,
        };
      }

      throw err;
    }
  }
}

// ─── Result type ──────────────────────────────────────────────────────────────

export type PaymentProcessorResult =
  | { status: 'ok'; payment: PaymentResponse & { status: 'completed' | 'failed' | 'in_progress' }; reused: boolean }
  | { status: 'validation_error'; errors: string[] }
  | { status: 'in_progress'; message: string }
  | { status: 'conflict'; message: string }
  | { status: 'unavailable'; message: string }
  | { status: 'dropped'; message: string };
