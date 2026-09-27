/**
 * @node 01.01.03 — Payment Client
 *
 * Constructs payment requests with a logical payment identity (callerId:orderId),
 * applies a 5-second timeout, and implements a bounded retry policy.
 *
 * ─── INTENTIONAL DEFECT (node: 12.03.01) ──────────────────────────────────────
 * The defect is that this client does NOT pass a stable idempotency key on retries.
 * Each retry generates a new idempotency key (via uuidv4()), so the payment
 * simulator treats each retry as a new operation and charges the customer again.
 *
 * The sequence of events that causes a duplicate charge:
 *   1. Client sends payment request with idempotencyKey = uuid-A.
 *   2. Server persists the payment (completed) and begins sending the response.
 *   3. The delay_after_commit fault fires → response is delayed beyond 5 s timeout.
 *   4. Client times out and retries with idempotencyKey = uuid-B (NEW key — the bug).
 *   5. Server treats uuid-B as a brand-new operation and charges again.
 *
 * The fix (section 07.02) is to derive the idempotency key deterministically from
 * the orderId: `${CALLER_ID}:${orderId}`, so retries reuse the same key.
 * ──────────────────────────────────────────────────────────────────────────────
 */

import { v4 as uuidv4 } from 'uuid';

export const CALLER_ID = 'checkout-service';
export const OPERATION = 'payment.create';

/** Maximum number of attempts (initial + retries) */
const MAX_ATTEMPTS = 3;

/** Request timeout in milliseconds */
const TIMEOUT_MS = 5_000;

export interface PaymentClientRequest {
  orderId: string;
  amount: number;
  currency: string;
}

export type PaymentClientResult =
  | { outcome: 'confirmed'; paymentId: string; idempotencyKey: string }
  | { outcome: 'timeout_uncertain' }
  | { outcome: 'failed'; message: string };

/**
 * @node 01.01.03 — Payment Client
 *
 * The `paymentApiUrl` is the base URL for the payment simulator's POST /payments
 * endpoint.
 */
export class PaymentClient {
  constructor(private readonly paymentApiUrl: string) {}

  /**
   * @node 01.01.03 — Submit a payment for an order.
   *
   * Applies a 5-second timeout per attempt and retries up to MAX_ATTEMPTS times.
   * Returns 'timeout_uncertain' if all attempts time out.
   *
   * DEFECT: Each attempt generates a fresh idempotency key (uuid), so a successful
   * server-side charge followed by a timeout will cause a duplicate charge on retry.
   */
  async submitPayment(req: PaymentClientRequest): Promise<PaymentClientResult> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      // DEFECT: idempotency key is regenerated on every attempt.
      // The correct behaviour is: idempotencyKey = `${CALLER_ID}:${req.orderId}`
      const idempotencyKey = uuidv4(); // ← BUG: new key on every retry

      const logicalId = `${CALLER_ID}:${req.orderId}`;

      const body = {
        logicalId,
        idempotencyKey,
        callerId: CALLER_ID,
        operation: OPERATION,
        amount: req.amount,
        currency: req.currency,
      };

      try {
        const result = await withTimeout(
          fetch(`${this.paymentApiUrl}/payments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }),
          TIMEOUT_MS,
        );

        if (!result.ok) {
          const text = await result.text();
          lastError = new Error(`Payment API returned ${result.status}: ${text}`);
          continue;
        }

        const data = (await result.json()) as { paymentId?: string; status?: string };
        if (data.status === 'completed' && data.paymentId) {
          return { outcome: 'confirmed', paymentId: data.paymentId, idempotencyKey };
        }

        lastError = new Error(`Unexpected payment status: ${data.status}`);
      } catch (err: unknown) {
        if ((err as Error).message === 'TIMEOUT') {
          // @node 01.04.06 — timeout_uncertain: caller must not infer confirmed or failed
          return { outcome: 'timeout_uncertain' };
        }
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }

    return {
      outcome: 'failed',
      message: lastError?.message ?? 'All payment attempts failed',
    };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('TIMEOUT')), ms),
  );
  return Promise.race([promise, timeout]);
}
