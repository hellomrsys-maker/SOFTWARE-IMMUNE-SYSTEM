/**
 * @node 01.03 — Fault Injection Engine
 *
 * Restricted to test environments only.  An explicit NODE_ENV guard at the top of
 * every activation path ensures this code cannot fire in production.
 *
 * Available fault types:
 *   01.03.01  delay_after_commit       — respond slowly after server has persisted the payment
 *   01.03.02  drop_after_commit        — never respond after server has persisted the payment
 *   01.03.03  concurrent_duplicate     — simulate two identical requests arriving simultaneously
 *   01.03.04  temporary_unavailability — reject all requests for a configured duration
 */

import { Pool } from 'pg';

// ─── Types ───────────────────────────────────────────────────────────────────

export type FaultType =
  | 'delay_after_commit'
  | 'drop_after_commit'
  | 'concurrent_duplicate'
  | 'temporary_unavailability';

export interface FaultConfig {
  faultType: FaultType;
  /** Milliseconds — used by delay_after_commit and temporary_unavailability */
  durationMs?: number;
  /** ISO 8601 string — if set, fault auto-expires at this time */
  expiresAt?: string;
}

export interface FaultState {
  id: string;
  faultType: FaultType;
  config: FaultConfig;
  active: boolean;
  expiresAt: Date | null;
}

// ─── Environment guard ────────────────────────────────────────────────────────

/**
 * @node 01.03 — Test-only guard.
 *
 * Fault injection MUST NOT run in production.  This function throws with a clear
 * message if NODE_ENV is 'production', providing a hard stop that cannot be
 * bypassed by runtime configuration.
 */
function assertTestEnvironment(operation: string): void {
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error(
      `FaultInjectionEngine: "${operation}" is forbidden in NODE_ENV=production. ` +
        'Fault injection is restricted to test environments only (node: 01.03).',
    );
  }
}

// ─── Engine ──────────────────────────────────────────────────────────────────

/**
 * @node 01.03 — Fault Injection Engine
 *
 * Manages activation and deactivation of fault types.  The fault state is persisted
 * to PostgreSQL so that the payment simulator can query it on each request.
 */
export class FaultInjectionEngine {
  constructor(private readonly db: Pool) {}

  /**
   * @node 01.03 — Activate a fault configuration.
   *
   * Throws if NODE_ENV === 'production'.
   */
  async activate(config: FaultConfig): Promise<FaultState> {
    assertTestEnvironment('activate');

    const expiresAt = config.expiresAt ? new Date(config.expiresAt) : null;

    const result = await this.db.query<{
      id: string;
      fault_type: FaultType;
      config: FaultConfig;
      active: boolean;
      expires_at: Date | null;
    }>(
      `INSERT INTO fault_configs (fault_type, config, active, expires_at)
       VALUES ($1, $2, true, $3)
       ON CONFLICT DO NOTHING
       RETURNING id, fault_type, config, active, expires_at`,
      [config.faultType, JSON.stringify(config), expiresAt],
    );

    // If ON CONFLICT triggered (already active), update instead
    if (!result.rows[0]) {
      const update = await this.db.query<{
        id: string;
        fault_type: FaultType;
        config: FaultConfig;
        active: boolean;
        expires_at: Date | null;
      }>(
        `UPDATE fault_configs
         SET config = $2, active = true, expires_at = $3, updated_at = now()
         WHERE fault_type = $1
         RETURNING id, fault_type, config, active, expires_at`,
        [config.faultType, JSON.stringify(config), expiresAt],
      );
      const row = update.rows[0];
      if (!row) throw new Error('FaultInjectionEngine: failed to activate fault');
      return rowToFaultState(row);
    }

    return rowToFaultState(result.rows[0]);
  }

  /** @node 01.03 — Deactivate a fault type. */
  async deactivate(faultType: FaultType): Promise<void> {
    assertTestEnvironment('deactivate');

    await this.db.query(
      `UPDATE fault_configs SET active = false, updated_at = now() WHERE fault_type = $1`,
      [faultType],
    );
  }

  /**
   * @node 01.03 — Get the currently active fault configuration for a type.
   *
   * Returns null if no active (non-expired) fault exists.
   * Any expired faults are automatically deactivated.
   */
  async getActive(faultType: FaultType): Promise<FaultState | null> {
    // Expire any faults whose expiry has passed
    await this.db.query(
      `UPDATE fault_configs
       SET active = false, updated_at = now()
       WHERE fault_type = $1 AND active = true AND expires_at IS NOT NULL AND expires_at <= now()`,
      [faultType],
    );

    const result = await this.db.query<{
      id: string;
      fault_type: FaultType;
      config: FaultConfig;
      active: boolean;
      expires_at: Date | null;
    }>(
      `SELECT id, fault_type, config, active, expires_at
       FROM fault_configs
       WHERE fault_type = $1 AND active = true
       LIMIT 1`,
      [faultType],
    );

    const row = result.rows[0];
    return row ? rowToFaultState(row) : null;
  }

  /** @node 01.03 — List all active fault configurations. */
  async listActive(): Promise<FaultState[]> {
    // Expire first
    await this.db.query(
      `UPDATE fault_configs
       SET active = false, updated_at = now()
       WHERE active = true AND expires_at IS NOT NULL AND expires_at <= now()`,
    );

    const result = await this.db.query<{
      id: string;
      fault_type: FaultType;
      config: FaultConfig;
      active: boolean;
      expires_at: Date | null;
    }>(
      `SELECT id, fault_type, config, active, expires_at
       FROM fault_configs
       WHERE active = true`,
    );

    return result.rows.map(rowToFaultState);
  }
}

// ─── Fault applicators ────────────────────────────────────────────────────────

/**
 * @node 01.03.01 — Delay after commit.
 *
 * Simulates a network delay that fires AFTER the server has persisted the payment.
 * This is the mechanism that triggers the duplicate-charge defect:
 *   1. Server persists payment and is about to respond.
 *   2. Response is delayed beyond the client timeout.
 *   3. Client retries without a stable idempotency key.
 *   4. Server processes the retry as a new payment → duplicate charge.
 */
export async function applyDelayAfterCommit(delayMs: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}

/**
 * @node 01.03.02 — Drop after commit.
 *
 * Simulates the server accepting and persisting a payment request but then
 * failing to send any response.  The client times out and retries, potentially
 * causing a duplicate charge.
 */
export function shouldDropAfterCommit(): boolean {
  return true; // always drops when this fault is active
}

/**
 * @node 01.03.04 — Temporary unavailability.
 *
 * Simulates a period during which the payment simulator rejects all requests
 * (HTTP 503).  Used to test circuit-breaker and retry logic.
 */
export function isTemporarilyUnavailable(fault: FaultState | null): boolean {
  if (!fault || fault.faultType !== 'temporary_unavailability') return false;
  if (fault.expiresAt && fault.expiresAt <= new Date()) return false;
  return fault.active;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rowToFaultState(row: {
  id: string;
  fault_type: FaultType;
  config: FaultConfig;
  active: boolean;
  expires_at: Date | null;
}): FaultState {
  return {
    id: row.id,
    faultType: row.fault_type,
    config: row.config,
    active: row.active,
    expiresAt: row.expires_at,
  };
}
