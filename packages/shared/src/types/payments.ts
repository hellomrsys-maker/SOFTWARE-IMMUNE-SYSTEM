/**
 * @file packages/shared/src/types/payments.ts
 * @node 01
 * @description Payment and order types for the managed application.
 */
import { z } from "zod";

// node: 01.02 — Payment states
export const PaymentStatusSchema = z.enum([
  "pending",
  "confirmed",
  "uncertain",  // node: 01.01.02 — Preserve uncertain payment state
  "failed",
]);
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;

export const OrderStatusSchema = z.enum([
  "pending",
  "confirmed",
  "uncertain",
  "failed",
]);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

// node: 01.02.01
export const PaymentRequestSchema = z.object({
  amount: z.number().positive(),
  currency: z.string().length(3),
  order_id: z.string().uuid(),
  caller_id: z.string().min(1),
  idempotency_key: z.string().min(1),
  metadata: z.record(z.unknown()).optional(),
});
export type PaymentRequest = z.infer<typeof PaymentRequestSchema>;

// node: 01.02.03
export const PaymentRecordSchema = z.object({
  id: z.string().uuid(),
  logical_id: z.string(),     // caller_id + ":" + idempotency_key
  order_id: z.string().uuid(),
  caller_id: z.string(),
  amount: z.number(),
  currency: z.string(),
  status: PaymentStatusSchema,
  idempotency_key: z.string(),
  request_fingerprint: z.string(),
  attempt_number: z.number().int(),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date(),
});
export type PaymentRecord = z.infer<typeof PaymentRecordSchema>;

// node: 01.01
export const CheckoutRequestSchema = z.object({
  order_id: z.string().uuid(),
  amount: z.number().positive(),
  currency: z.string().length(3),
  customer_id: z.string().min(1),
});
export type CheckoutRequest = z.infer<typeof CheckoutRequestSchema>;
