/**
 * @file packages/db/src/pool.ts
 * @node 11.02
 * @description PostgreSQL connection pool with outage detection.
 * On database outage, emits DatabaseOutageError — workers must stop and wait, not continue.
 */
import pg from "pg";
import { DatabaseOutageError } from "@sis/shared";

const { Pool } = pg;

let _pool: pg.Pool | null = null;

export function getPool(connectionString?: string): pg.Pool {
  if (_pool !== null) {
    return _pool;
  }
  const url = connectionString ?? process.env["DATABASE_URL"];
  if (!url) {
    throw new Error("DATABASE_URL is required but not set");
  }
  _pool = new Pool({
    connectionString: url,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  _pool.on("error", (err: Error) => {
    // node: 11.06 — Database outage: log and allow the DatabaseOutageError to propagate
    // We do NOT swallow this error silently.
    process.stderr.write(`[db] Pool error: ${err.message}\n`);
  });

  return _pool;
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params?: unknown[],
  pool?: pg.Pool,
): Promise<pg.QueryResult<T>> {
  const p = pool ?? getPool();
  try {
    return await p.query<T>(sql, params);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // Distinguish connection errors from query errors
    if (
      msg.includes("ECONNREFUSED") ||
      msg.includes("ENOTFOUND") ||
      msg.includes("Connection terminated") ||
      msg.includes("connect ETIMEDOUT")
    ) {
      throw new DatabaseOutageError(msg, { sql, params });
    }
    throw err;
  }
}

export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
  pool?: pg.Pool,
): Promise<T> {
  const p = pool ?? getPool();
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (_pool !== null) {
    await _pool.end();
    _pool = null;
  }
}

/** Reset pool — for tests only */
export function resetPoolForTest(): void {
  _pool = null;
}
