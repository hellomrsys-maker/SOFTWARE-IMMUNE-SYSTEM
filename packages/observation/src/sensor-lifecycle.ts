/**
 * @node 02.01 — Sensor Lifecycle
 *
 * Provides a sensor registry, scheduler, and health tracker.
 * Every sensor registers with a type, trigger mode, and schedule.
 * Health is written to the `sensor_health` DB table via the provided store.
 *
 * Sensor trigger modes:
 *   event      — triggered when a specific event is emitted
 *   periodic   — triggered on a fixed interval
 *   incident   — triggered when an incident reaches a specific state
 *
 * Limitation: the scheduler uses setInterval for periodic sensors; in a
 * multi-process deployment only one process should run the scheduler.
 */

import type { Pool } from 'pg';

// ─── Types ────────────────────────────────────────────────────────────────────

export type SensorTrigger = 'event' | 'periodic' | 'incident';
export type SourceType = 'log' | 'trace' | 'metric' | 'repository' | 'document' | 'business_state';

export interface SensorDefinition {
  sensorId: string;
  sourceType: SourceType;
  trigger: SensorTrigger;
  /** Required for periodic sensors — interval in ms */
  intervalMs?: number;
  /** Required for event sensors — event name */
  eventName?: string;
  collect: (context: SensorContext) => Promise<RawObservation[]>;
}

export interface SensorContext {
  incidentId?: string;
  triggeredBy?: string;
  params?: Record<string, unknown>;
}

export interface RawObservation {
  sourceType: SourceType;
  /** ISO 8601 timestamp of the original event */
  originalTimestamp?: string;
  /** True if the clock ordering of this observation is uncertain */
  clockOrderUncertain?: boolean;
  /** Raw content — will be redacted before storage */
  content: unknown;
  /** Source reference: file, line, service, commit */
  sourceReference: Record<string, unknown>;
}

export interface SensorHealth {
  sensorId: string;
  sourceType: SourceType;
  lastSuccessAt: Date | null;
  lastAttemptAt: Date;
  consecutiveFailures: number;
  lastError: string | null;
}

// ─── SensorRegistry ───────────────────────────────────────────────────────────

/**
 * @node 02.01.01 — SensorRegistry
 *
 * Stores sensor definitions and provides lookup by ID and source type.
 */
export class SensorRegistry {
  private readonly sensors = new Map<string, SensorDefinition>();

  /** @node 02.01.01 — Register a sensor. Throws if sensorId already registered. */
  register(def: SensorDefinition): void {
    if (this.sensors.has(def.sensorId)) {
      throw new Error(`Sensor "${def.sensorId}" is already registered`);
    }
    this.sensors.set(def.sensorId, def);
  }

  /** @node 02.01.01 — Look up a sensor by ID. */
  get(sensorId: string): SensorDefinition | undefined {
    return this.sensors.get(sensorId);
  }

  /** @node 02.01.01 — List all registered sensors. */
  list(): SensorDefinition[] {
    return Array.from(this.sensors.values());
  }

  /** @node 02.01.01 — List sensors by source type. */
  listBySourceType(sourceType: SourceType): SensorDefinition[] {
    return this.list().filter((s) => s.sourceType === sourceType);
  }
}

// ─── SensorHealthTracker ───────────────────────────────────────────────────────

/**
 * @node 02.01.03 — SensorHealthTracker
 *
 * Writes sensor health records to the `sensor_health` table.
 * A missing signal is recorded as a failure gap — never assumed healthy.
 */
export class SensorHealthTracker {
  constructor(private readonly db: Pool) {}

  /** @node 02.01.03 — Record a successful sensor run. */
  async recordSuccess(sensorId: string, sourceType: SourceType): Promise<void> {
    await this.db.query(
      `INSERT INTO sensor_health (sensor_id, source_type, last_success_at, last_attempt_at, consecutive_failures)
       VALUES ($1, $2, now(), now(), 0)
       ON CONFLICT (sensor_id)
       DO UPDATE SET last_success_at = now(), last_attempt_at = now(),
                     consecutive_failures = 0, updated_at = now()`,
      [sensorId, sourceType],
    );
  }

  /** @node 02.01.03 — Record a sensor failure. */
  async recordFailure(sensorId: string, sourceType: SourceType, error: string): Promise<void> {
    await this.db.query(
      `INSERT INTO sensor_health (sensor_id, source_type, last_attempt_at, consecutive_failures, last_error)
       VALUES ($1, $2, now(), 1, $3)
       ON CONFLICT (sensor_id)
       DO UPDATE SET last_attempt_at = now(),
                     consecutive_failures = sensor_health.consecutive_failures + 1,
                     last_error = $3,
                     updated_at = now()`,
      [sensorId, sourceType, error],
    );
  }

  /** @node 02.01.03 — Get health status for a sensor. */
  async getHealth(sensorId: string): Promise<SensorHealth | null> {
    const result = await this.db.query<{
      sensor_id: string;
      source_type: SourceType;
      last_success_at: Date | null;
      last_attempt_at: Date;
      consecutive_failures: number;
      last_error: string | null;
    }>(
      `SELECT sensor_id, source_type, last_success_at, last_attempt_at, consecutive_failures, last_error
       FROM sensor_health WHERE sensor_id = $1`,
      [sensorId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      sensorId: row.sensor_id,
      sourceType: row.source_type,
      lastSuccessAt: row.last_success_at,
      lastAttemptAt: row.last_attempt_at,
      consecutiveFailures: row.consecutive_failures,
      lastError: row.last_error,
    };
  }
}

// ─── SensorScheduler ──────────────────────────────────────────────────────────

/**
 * @node 02.01.02 — SensorScheduler
 *
 * Manages setInterval timers for periodic sensors and dispatches on-demand
 * execution for event and incident-triggered sensors.
 *
 * Limitation: Uses Node.js timers; not suitable for distributed scheduling.
 */
export class SensorScheduler {
  private readonly timers = new Map<string, ReturnType<typeof setInterval>>();

  constructor(
    private readonly registry: SensorRegistry,
    private readonly healthTracker: SensorHealthTracker,
  ) {}

  /** @node 02.01.02 — Start periodic sensors. */
  startPeriodic(): void {
    for (const sensor of this.registry.list()) {
      if (sensor.trigger === 'periodic' && sensor.intervalMs) {
        const timer = setInterval(async () => {
          await this.runSensor(sensor, {});
        }, sensor.intervalMs);
        this.timers.set(sensor.sensorId, timer);
      }
    }
  }

  /** @node 02.01.02 — Stop all periodic timers. */
  stop(): void {
    for (const [, timer] of this.timers) {
      clearInterval(timer);
    }
    this.timers.clear();
  }

  /**
   * @node 02.01.02 — Run a sensor by ID on demand.
   * Records health on success or failure.
   */
  async runSensor(sensor: SensorDefinition, context: SensorContext): Promise<RawObservation[]> {
    try {
      const observations = await sensor.collect(context);
      await this.healthTracker.recordSuccess(sensor.sensorId, sensor.sourceType);
      return observations;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.healthTracker.recordFailure(sensor.sensorId, sensor.sourceType, message);
      return [];
    }
  }
}
