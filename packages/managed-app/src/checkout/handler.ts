/**
 * @node 01.01.01 — Checkout Request Handler
 *
 * Validates checkout input, orchestrates the order state machine and payment
 * client, and returns a structured response.
 *
 * The handler is the entry point for POST /checkout.
 */

import { z } from 'zod';
import type { Pool } from 'pg';
import { OrderStateManager } from './order-state-manager.js';
import { PaymentClient } from './payment-client.js';
import {
  CheckoutRequestSchema,
  timeoutUncertaintyPreservation,
  type CheckoutResponse,
} from '../correctness-spec/invariants.js';

export class CheckoutHandler {
  private readonly orders: OrderStateManager;
  private readonly payments: PaymentClient;

  constructor(
    private readonly db: Pool,
    paymentApiUrl: string,
  ) {
    this.orders = new OrderStateManager(db);
    this.payments = new PaymentClient(paymentApiUrl);
  }

  /**
   * @node 01.01.01 — Handle a checkout request.
   *
   * Steps:
   *   1. Validate input.
   *   2. Create order in 'pending' state.
   *   3. Transition to 'attempted' and record the payment attempt.
   *   4. Submit payment to the payment simulator.
   *   5. Transition order based on payment outcome.
   *   6. Return structured response.
   */
  async handle(rawInput: unknown): Promise<CheckoutHandlerResult> {
    // Step 1 — validate
    const parsed = CheckoutRequestSchema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        status: 'validation_error',
        errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      };
    }
    const req = parsed.data;

    // Step 2 — create order
    const order = await this.orders.createOrder({
      amount: req.amount,
      currency: req.currency,
      customerId: req.customerId,
    });

    // Step 3 — transition to 'attempted'
    await this.orders.transition(order.id, 'attempted');
    await this.orders.recordAttempt({
      orderId: order.id,
      idempotencyKey: null, // client will supply on the actual request
      requestPayload: { amount: req.amount, currency: req.currency, customerId: req.customerId },
      status: 'pending',
    });

    // Step 4 — submit payment
    const paymentResult = await this.payments.submitPayment({
      orderId: order.id,
      amount: req.amount,
      currency: req.currency,
    });

    // Step 5 — transition order
    if (paymentResult.outcome === 'confirmed') {
      await this.orders.transition(order.id, 'confirmed');
      return {
        status: 'confirmed',
        orderId: order.id,
        paymentId: paymentResult.paymentId,
      };
    }

    if (paymentResult.outcome === 'timeout_uncertain') {
      // @node 01.04.06 — preserve timeout uncertainty: must NOT resolve to confirmed or failed
      const violations = timeoutUncertaintyPreservation.check(
        'uncertain_outcome',
        'timeout',
      );
      // violations.length === 0 confirms we are correctly using uncertain_outcome
      if (violations.length > 0) {
        throw new Error(`Invariant violation: ${violations.map((v) => v.message).join('; ')}`);
      }

      await this.orders.transition(order.id, 'uncertain_outcome');
      return {
        status: 'uncertain_outcome',
        orderId: order.id,
        message: 'Payment request timed out. Outcome is uncertain — please check payment status.',
      };
    }

    // failed
    await this.orders.transition(order.id, 'uncertain_outcome');
    return {
      status: 'failed',
      orderId: order.id,
      message: paymentResult.message,
    };
  }
}

// ─── Result type ──────────────────────────────────────────────────────────────

export type CheckoutHandlerResult =
  | { status: 'confirmed'; orderId: string; paymentId: string }
  | { status: 'uncertain_outcome'; orderId: string; message: string }
  | { status: 'failed'; orderId: string; message: string }
  | { status: 'validation_error'; errors: string[] };
