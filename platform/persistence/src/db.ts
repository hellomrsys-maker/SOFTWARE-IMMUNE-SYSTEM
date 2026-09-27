/**
 * @node 11.02 — Persistence layer — PostgreSQL connection pool and outage handler.
 *
 * Rule 8 (DB outage = stop and wait): if the pool cannot reach the database, the
 * worker must not process events against in-memory state.  The `waitForDb` helper
 * polls until connectivity is restored before the caller proceeds.
 */

import pg from 'pg';
import pino from 'pino';

const { Pool } = pg;

const log = pino({ name: 'sis.persistence' });

// ─── Pool singleton ───────────────────────────────────────────────────────────

let _pool: pg.Pool | null = null;

/** @node 11.02 — Get or create the shared connection pool. */
export function getPool(connectionString?: string): pg.Pool {
  if (!_pool) {
    _pool = new Pool({
      connectionString: connectionString ?? process.env['DATABASE_URL'],
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });

    _pool.on('error', (err) => {
      log.error({ err }, 'Unexpected PostgreSQL pool error');
    });
  }
  return _pool;
}

/** @node 11.02 — Cleanly close the pool (use on graceful shutdown). */
export async function closePool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}

// ─── Outage detection and wait ────────────────────────────────────────────────

/**
 * @node 11.02 — Test whether the database is currently reachable.
 */
export async function isDatabaseReachable(pool: pg.Pool): Promise<boolean> {
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    return true;
  } catch {
    return false;
  }
}

/**
 * @node 11.02 — Block until the database is reachable, polling every `intervalMs`.
 *
 * Rule 8: the worker must never continue with in-memory state during a DB outage.
 * Call this before processing any event and after any DB error.
 */
export async function waitForDb(
  pool: pg.Pool,
  opts: { intervalMs?: number; maxAttempts?: number } = {},
): Promise<void> {
  const intervalMs = opts.intervalMs ?? 5_000;
  const maxAttempts = opts.maxAttempts ?? Infinity;
  let attempt = 0;

  while (!(await isDatabaseReachable(pool))) {
    attempt++;
    if (attempt >= maxAttempts) {
      throw new DbOutageError(
        `Database unreachable after ${attempt} attempt(s). Worker must stop.`,
      );
    }
    log.warn({ attempt, intervalMs }, 'Database unreachable — waiting before retry');
    await sleep(intervalMs);
  }
}

export class DbOutageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DbOutageError';
  }
}

// ─── Transaction helpers ──────────────────────────────────────────────────────

/** @node 11.02 — Run `fn` inside a serializable transaction; rolls back on error. */
export async function withTransaction<T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
