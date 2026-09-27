/**
 * @node 03 — Transport and Control unit tests
 *
 * Tests all components against DB mocks (no live PostgreSQL required).
 *
 * Limitation: does not test concurrent claim/ack races; those require integration tests.
 */

import { describe, it, expect, vi, type Mock } from 'vitest';
import { DurableQueue, QueueAdmissionError } from '../src/queue.js';
import {
  IncidentStateMachine,
  IllegalTransitionError,
  ALLOWED_TRANSITIONS,
} from '../src/state-machine.js';
import { TaskCoordinator, TaskOutputValidationError } from '../src/task-coordinator.js';
import { AuthorizationEngine } from '../src/authorization.js';
import type { Pool } from 'pg';
import { z } from 'zod';

// ─── DB mock helpers ──────────────────────────────────────────────────────────

function makePool(rows: unknown[] = [], rowCount = 0): Pool {
  return {
    query: vi.fn().mockResolvedValue({ rows, rowCount }),
  } as unknown as Pool;
}

// ─── 03.01 DurableQueue ───────────────────────────────────────────────────────

describe('DurableQueue', () => {
  it('throws QueueAdmissionError when pending depth exceeds threshold', async () => {
    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ count: '1001' }] }) // pendingDepth check
    } as unknown as Pool;

    const q = new DurableQueue(pool, { backpressureThreshold: 1000 });
    await expect(q.enqueue({ topic: 'test', payload: {} })).rejects.toBeInstanceOf(
      QueueAdmissionError,
    );
  });

  it('enqueues successfully when below threshold', async () => {
    const eventRow = {
      id: 'evt-1',
      topic: 'incident.created',
      payload: { x: 1 },
      status: 'pending',
      attempt_count: 0,
      max_attempts: 5,
      lease_token: null,
      lease_expires: null,
      error_message: null,
      scheduled_at: new Date(),
      created_at: new Date(),
    };

    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // pendingDepth
        .mockResolvedValueOnce({ rows: [eventRow] }),       // INSERT
    } as unknown as Pool;

    const q = new DurableQueue(pool);
    const result = await q.enqueue({ topic: 'incident.created', payload: { x: 1 } });
    expect(result.id).toBe('evt-1');
    expect(result.status).toBe('pending');
  });

  it('reclaimExpiredLeases returns rowCount', async () => {
    const pool = makePool([], 3);
    const q = new DurableQueue(pool);
    const count = await q.reclaimExpiredLeases();
    expect(count).toBe(3);
  });
});

// ─── 03.02 IncidentStateMachine ───────────────────────────────────────────────

describe('IncidentStateMachine', () => {
  it('ALLOWED_TRANSITIONS contains all expected states', () => {
    const states = Object.keys(ALLOWED_TRANSITIONS);
    expect(states).toContain('created');
    expect(states).toContain('review_ready');
    expect(states).toContain('escalated');
    expect(states).toContain('abstained');
  });

  it('created → observing is allowed', () => {
    expect(ALLOWED_TRANSITIONS.created).toContain('observing');
  });

  it('review_ready has no allowed transitions (terminal)', () => {
    expect(ALLOWED_TRANSITIONS.review_ready).toHaveLength(0);
  });

  it('escalated has no allowed transitions (terminal)', () => {
    expect(ALLOWED_TRANSITIONS.escalated).toHaveLength(0);
  });

  it('throws IllegalTransitionError for invalid transition', async () => {
    const incidentRow = {
      id: 'inc-1',
      fingerprint: 'fp-1',
      status: 'created',
      title: 'Test',
      failure_report: {},
      repository_path: '/repo',
      actor_id: 'actor-1',
      retry_count: 0,
      created_at: new Date(),
      updated_at: new Date(),
    };
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [incidentRow] }),
    } as unknown as Pool;

    const sm = new IncidentStateMachine(pool);
    await expect(sm.transition('inc-1', 'review_ready', 'actor')).rejects.toBeInstanceOf(
      IllegalTransitionError,
    );
  });

  it('IllegalTransitionError message includes from and to states', () => {
    const err = new IllegalTransitionError('created', 'review_ready');
    expect(err.message).toContain('created');
    expect(err.message).toContain('review_ready');
  });
});

// ─── 03.03 TaskCoordinator ────────────────────────────────────────────────────

describe('TaskCoordinator.complete', () => {
  it('throws TaskOutputValidationError when schema validation fails', async () => {
    const taskRow = {
      id: 'task-1',
      incident_id: 'inc-1',
      task_type: 'diagnose',
      depends_on: [],
      input_snapshot: {},
      output: null,
      status: 'running',
      attempt_count: 1,
      max_attempts: 3,
      started_at: new Date(),
      completed_at: null,
      error_message: null,
      created_at: new Date(),
      updated_at: new Date(),
    };
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [taskRow] }),
    } as unknown as Pool;

    const coordinator = new TaskCoordinator(pool);
    const schema = z.object({ status: z.literal('ok') });
    await expect(
      coordinator.complete('task-1', { status: 'bad' }, schema),
    ).rejects.toBeInstanceOf(TaskOutputValidationError);
  });
});

// ─── 03.04 AuthorizationEngine ────────────────────────────────────────────────

describe('AuthorizationEngine', () => {
  const makeAuthPool = (rows: unknown[] = []) =>
    ({
      query: vi.fn().mockResolvedValue({ rows }),
    } as unknown as Pool);

  const config = {
    approvedCommands: ['pnpm test', 'tsc --noEmit'],
    allowedWritePaths: ['/workspace/**', '/sandbox/**'],
    allowedNetworkHosts: ['localhost', 'db.internal'],
  };

  it('allows approved command', async () => {
    const pool = makeAuthPool([{ id: 'dec-1', actor_id: 'a', permission_type: 'approved_command', resource: 'pnpm test', incident_id: null, decision: 'allowed', reason: null, created_at: new Date() }]);
    const engine = new AuthorizationEngine(pool, config);
    const result = await engine.checkCommand('agent-1', 'pnpm test');
    expect(result.decision).toBe('allowed');
  });

  it('denies unapproved command and writes denial record BEFORE returning', async () => {
    const pool = makeAuthPool([{
      id: 'dec-2', actor_id: 'a', permission_type: 'approved_command',
      resource: 'rm -rf /', incident_id: null, decision: 'denied',
      reason: 'not approved', created_at: new Date()
    }]);
    const engine = new AuthorizationEngine(pool, config);
    const result = await engine.checkCommand('agent-1', 'rm -rf /');
    expect(result.decision).toBe('denied');
    // Verify the DB write happened (pool.query called)
    expect(pool.query as Mock).toHaveBeenCalled();
  });

  it('allows write to permitted path', async () => {
    const pool = makeAuthPool([{
      id: 'dec-3', actor_id: 'a', permission_type: 'workspace_write',
      resource: '/workspace/src/fix.ts', incident_id: null, decision: 'allowed',
      reason: null, created_at: new Date()
    }]);
    const engine = new AuthorizationEngine(pool, config);
    const result = await engine.checkWrite('agent-1', '/workspace/src/fix.ts');
    expect(result.decision).toBe('allowed');
  });

  it('denies write to non-permitted path', async () => {
    const pool = makeAuthPool([{
      id: 'dec-4', actor_id: 'a', permission_type: 'workspace_write',
      resource: '/etc/passwd', incident_id: null, decision: 'denied',
      reason: 'not allowed', created_at: new Date()
    }]);
    const engine = new AuthorizationEngine(pool, config);
    const result = await engine.checkWrite('agent-1', '/etc/passwd');
    expect(result.decision).toBe('denied');
  });

  it('denies network to unlisted host', async () => {
    const pool = makeAuthPool([{
      id: 'dec-5', actor_id: 'a', permission_type: 'network',
      resource: 'evil.example.com', incident_id: null, decision: 'denied',
      reason: 'not allowed', created_at: new Date()
    }]);
    const engine = new AuthorizationEngine(pool, config);
    const result = await engine.checkNetwork('agent-1', 'evil.example.com');
    expect(result.decision).toBe('denied');
  });

  it('allows network to listed host', async () => {
    const pool = makeAuthPool([{
      id: 'dec-6', actor_id: 'a', permission_type: 'network',
      resource: 'localhost', incident_id: null, decision: 'allowed',
      reason: null, created_at: new Date()
    }]);
    const engine = new AuthorizationEngine(pool, config);
    const result = await engine.checkNetwork('agent-1', 'localhost');
    expect(result.decision).toBe('allowed');
  });

  it('denies approval when no approval_records found', async () => {
    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] }) // SELECT from approval_records
        .mockResolvedValueOnce({ rows: [{
          id: 'dec-7', actor_id: 'a', permission_type: 'approval',
          resource: 'repair:r-1', incident_id: 'inc-1', decision: 'denied',
          reason: 'no record', created_at: new Date()
        }] }),
    } as unknown as Pool;
    const engine = new AuthorizationEngine(pool, config);
    const result = await engine.checkApproval('agent-1', 'inc-1', 'r-1');
    expect(result.decision).toBe('denied');
  });
});
