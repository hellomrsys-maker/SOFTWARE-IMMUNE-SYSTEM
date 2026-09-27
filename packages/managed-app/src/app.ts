/**
 * @node 01 — Managed Application — Fastify Server
 *
 * Wires all routes and starts the server.  This is the runnable entry point.
 */

import Fastify from 'fastify';
import { Pool } from 'pg';
import { CheckoutHandler } from './checkout/handler.js';
import { PaymentProcessor } from './payment-simulator/processor.js';
import { FaultInjectionEngine } from './fault-injection/engine.js';
import { queryPaymentById } from './payment-simulator/persistence.js';
import type { FaultConfig } from './fault-injection/engine.js';

const db = new Pool({
  connectionString: process.env['DATABASE_URL'] ?? 'postgresql://sis:sis_password@localhost:5432/sis_dev',
});

const PAYMENT_API_URL = process.env['PAYMENT_API_URL'] ?? 'http://localhost:3001';
const PORT = parseInt(process.env['MANAGED_APP_PORT'] ?? '3001', 10);
const CALLER_ID = 'checkout-service';

const app = Fastify({
  logger: {
    transport: { target: 'pino-pretty' },
  },
});

const checkout = new CheckoutHandler(db, PAYMENT_API_URL);
const paymentProcessor = new PaymentProcessor(db);
const faultEngine = new FaultInjectionEngine(db);

// ─── POST /checkout ────────────────────────────────────────────────────────────

/**
 * @node 01.01.01 — Checkout endpoint
 */
app.post('/checkout', async (request, reply) => {
  const result = await checkout.handle(request.body);

  if (result.status === 'validation_error') {
    return reply.status(400).send({ error: 'Validation failed', details: result.errors });
  }
  if (result.status === 'confirmed') {
    return reply.status(200).send(result);
  }
  if (result.status === 'uncertain_outcome') {
    return reply.status(202).send(result);
  }
  return reply.status(500).send({ error: result.message });
});

// ─── POST /payments ────────────────────────────────────────────────────────────

/**
 * @node 01.02.01 — Payment simulator endpoint
 */
app.post('/payments', async (request, reply) => {
  const result = await paymentProcessor.process(request.body);

  switch (result.status) {
    case 'ok':
      return reply.status(result.reused ? 200 : 201).send(result.payment);
    case 'validation_error':
      return reply.status(400).send({ error: 'Validation failed', details: result.errors });
    case 'in_progress':
      return reply.status(409).send({ error: result.message });
    case 'conflict':
      return reply.status(422).send({ error: result.message });
    case 'unavailable':
      return reply.status(503).send({ error: result.message });
    case 'dropped':
      // Simulate a connection drop by never responding (in practice: very long delay)
      await new Promise((resolve) => setTimeout(resolve, 120_000));
      return reply.status(503).send({ error: 'Timeout' });
    default:
      return reply.status(500).send({ error: 'Internal error' });
  }
});

// ─── GET /payments/:id ─────────────────────────────────────────────────────────

/**
 * @node 01.02.04 — Payment status lookup (caller-isolated)
 */
app.get<{ Params: { id: string }; Querystring: { callerId?: string } }>(
  '/payments/:id',
  async (request, reply) => {
    const callerId = request.query['callerId'] ?? CALLER_ID;
    const payment = await queryPaymentById(db, request.params.id, callerId);

    if (!payment) {
      return reply.status(404).send({ error: 'Payment not found' });
    }

    return reply.send(payment);
  },
);

// ─── POST /fault-injection/activate ──────────────────────────────────────────

/**
 * @node 01.03 — Fault injection activation (test environments only)
 */
app.post('/fault-injection/activate', async (request, reply) => {
  try {
    const state = await faultEngine.activate(request.body as FaultConfig);
    return reply.status(200).send(state);
  } catch (err: unknown) {
    const msg = (err as Error).message;
    if (msg.includes('forbidden in NODE_ENV=production')) {
      return reply.status(403).send({ error: msg });
    }
    throw err;
  }
});

// ─── POST /fault-injection/deactivate ────────────────────────────────────────

/**
 * @node 01.03 — Fault injection deactivation (test environments only)
 */
app.post<{ Body: { faultType: string } }>(
  '/fault-injection/deactivate',
  async (request, reply) => {
    try {
      await faultEngine.deactivate(request.body.faultType as Parameters<typeof faultEngine.deactivate>[0]);
      return reply.status(204).send();
    } catch (err: unknown) {
      const msg = (err as Error).message;
      if (msg.includes('forbidden in NODE_ENV=production')) {
        return reply.status(403).send({ error: msg });
      }
      throw err;
    }
  },
);

// ─── GET /health ──────────────────────────────────────────────────────────────

app.get('/health', async (_request, reply) => {
  return reply.send({ status: 'ok', service: 'managed-app' });
});

// ─── Start ────────────────────────────────────────────────────────────────────

const start = async (): Promise<void> => {
  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

void start();
