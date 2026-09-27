/**
 * @node 01.01.02 — Order State Manager
 *
 * Creates and transitions orders through the defined state machine:
 *   pending → attempted → confirmed | uncertain_outcome
 *
 * Invalid transitions are rejected with a clear error.
 */

import { v4 as uuidv4 } from 'uuid';
import type { Pool } from 'pg';
import type { OrderStatus } from '../correctness-spec/invariants.js';

export interface Order {
  id: string;
  status: OrderStatus;
  amount: number;
  currency: string;
  customerId: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

/** @node 01.04.02 — Allowed order state transitions */
const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['attempted'],
  attempted: ['confirmed', 'uncertain_outcome'],
  confirmed: [],         // terminal
  uncertain_outcome: [], // terminal — requires human reconciliation
};

export class OrderStateManager {
  constructor(private readonly db: Pool) {}

  /** @node 01.01.02 — Create a new order in 'pending' state */
  async createOrder(params: {
    amount: number;
    currency: string;
    customerId: string;
    metadata?: Record<string, unknown>;
  }): Promise<Order> {
    const id = uuidv4();
    const result = await this.db.query<{
      id: string;
      status: OrderStatus;
      amount: string;
      currency: string;
      customer_id: string;
      metadata: Record<string, unknown>;
      created_at: Date;
      updated_at: Date;
    }>(
      `INSERT INTO orders (id, status, amount, currency, customer_id, metadata)
       VALUES ($1, 'pending', $2, $3, $4, $5)
       RETURNING id, status, amount, currency, customer_id, metadata, created_at, updated_at`,
      [id, params.amount, params.currency, params.customerId, JSON.stringify(params.metadata ?? {})],
    );

    const row = result.rows[0];
    if (!row) throw new Error('Failed to create order');
    return rowToOrder(row);
  }

  /** @node 01.01.02 — Transition an order to a new state */
  async transition(orderId: string, newStatus: OrderStatus): Promise<Order> {
    const current = await this.getOrder(orderId);
    if (!current) throw new Error(`Order not found: ${orderId}`);

    const allowed = ALLOWED_TRANSITIONS[current.status];
    if (!allowed.includes(newStatus)) {
      throw new InvalidTransitionError(
        `Cannot transition order from '${current.status}' to '${newStatus}'`,
        { from: current.status, to: newStatus },
      );
    }

    const result = await this.db.query<{
      id: string;
      status: OrderStatus;
      amount: string;
      currency: string;
      customer_id: string;
      metadata: Record<string, unknown>;
      created_at: Date;
      updated_at: Date;
    }>(
      `UPDATE orders
       SET status = $2, updated_at = now()
       WHERE id = $1
       RETURNING id, status, amount, currency, customer_id, metadata, created_at, updated_at`,
      [orderId, newStatus],
    );

    const row = result.rows[0];
    if (!row) throw new Error(`Failed to transition order: ${orderId}`);
    return rowToOrder(row);
  }

  /** @node 01.01.02 — Get an order by ID */
  async getOrder(orderId: string): Promise<Order | null> {
    const result = await this.db.query<{
      id: string;
      status: OrderStatus;
      amount: string;
      currency: string;
      customer_id: string;
      metadata: Record<string, unknown>;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, status, amount, currency, customer_id, metadata, created_at, updated_at
       FROM orders WHERE id = $1`,
      [orderId],
    );

    const row = result.rows[0];
    return row ? rowToOrder(row) : null;
  }

  /** @node 01.01.02 — Record a payment attempt linked to an order */
  async recordAttempt(params: {
    orderId: string;
    idempotencyKey: string | null; // null in defect state
    requestPayload: Record<string, unknown>;
    status: 'pending' | 'success' | 'timeout' | 'error';
    responsePayload?: Record<string, unknown>;
  }): Promise<string> {
    const result = await this.db.query<{ id: string }>(
      `INSERT INTO payment_attempts
         (order_id, idempotency_key, request_payload, status, response_payload)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        params.orderId,
        params.idempotencyKey,
        JSON.stringify(params.requestPayload),
        params.status,
        params.responsePayload ? JSON.stringify(params.responsePayload) : null,
      ],
    );

    const row = result.rows[0];
    if (!row) throw new Error('Failed to record payment attempt');
    return row.id;
  }
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export class InvalidTransitionError extends Error {
  constructor(
    message: string,
    public readonly transition: { from: OrderStatus; to: OrderStatus },
  ) {
    super(message);
    this.name = 'InvalidTransitionError';
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rowToOrder(row: {
  id: string;
  status: OrderStatus;
  amount: string;
  currency: string;
  customer_id: string;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}): Order {
  return {
    id: row.id,
    status: row.status,
    amount: parseFloat(row.amount),
    currency: row.currency,
    customerId: row.customer_id,
    metadata: row.metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
