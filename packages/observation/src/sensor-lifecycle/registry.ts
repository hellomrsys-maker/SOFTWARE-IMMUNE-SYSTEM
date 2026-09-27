/**
 * @node 02.01 — Sensor Lifecycle — Registry, Scheduler, and Health Tracker
 *
 * Rule 7: each sensor runs in isolation; a failure in one must not suppress others.
 * Rule 8: missing telemetry is recorded as a CollectionGap, not assumed healthy.
 */

import { v4 as uuidv4 } from 'uuid';
import type pg from 'pg';
import type { CollectionGap } from '../evidence-preparation/types.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SensorDefinition {
  id: string;
  sourceType: string;
  description: string;
  /** Permissions required to run this sensor */
  requiredPermissions: string[];
  /** Collect function; returns raw evidence items */
  collect: (incidentId: string, context: Record<string, unknown>) => Promise<SensorOutput>;
}

export interface SensorOutput {
  records: Array<{
    recordType: string;
    sourceReference: Record<string, unknown>;
    originalTimestamp?: string;
    payload: Record<string, unknown>;
  }>;
  gaps: CollectionGap[];
}

export interface SensorHealthRecord {
  sensorId: string;
  lastSuccessAt: Date | null;
  lastAttemptAt: Date;
  consecutiveFailures: number;
  lastError: string | null;
}

// ─── Sensor Registry ─────────────────────────────────────────────────────────

/**
 * @node 02.01.01 — Sensor Registry
 *
 * Registers sensors by ID and allows lookup by source type.
 */
export class SensorRegistry {
  private readonly sensors = new Map<string, SensorDefinition>();

  register(sensor: SensorDefinition): void {
    this.sensors.set(sensor.id, sensor);
  }

  getById(id: string): SensorDefinition | undefined {
    return this.sensors.get(id);
  }

  getBySourceType(sourceType: string): SensorDefinition[] {
    return [...this.sensors.values()].filter((s) => s.sourceType === sourceType);
  }

  getAll(): SensorDefinition[] {
    return [...this.sensors.values()];
  }
}

// ─── Sensor Scheduler ────────────────────────────────────────────────────────

/**
 * @node 02.01.02 — Sensor Scheduler
 *
 * Dispatches sensors in response to incidents.  Rule 7: each sensor is wrapped in
 * an isolated try/catch so one failure cannot prevent other sensors from running.
 */
export class SensorScheduler {
  constructor(
    private readonly registry: SensorRegistry,
    private readonly db: pg.Pool,
  ) {}

  /**
   * @node 02.01.02 — Collect evidence for an incident using all registered sensors.
   *
   * Returns aggregated records and gaps from all sensors.
   */
  async collectForIncident(
    incidentId: string,
    context: Record<string, unknown>,
  ): Promise<SensorOutput> {
    const allRecords: SensorOutput['records'] = [];
    const allGaps: CollectionGap[] = [];
    const health = new SensorHealthTracker(this.db);

    const sensors = this.registry.getAll();

    // Rule 7: each sensor in its own try/catch — one failure cannot suppress others
    await Promise.all(
      sensors.map(async (sensor) => {
        const attemptedAt = new Date().toISOString();
        try {
          const output = await sensor.collect(incidentId, context);
          allRecords.push(...output.records);
          allGaps.push(...output.gaps);
          await health.recordSuccess(sensor.id, sensor.sourceType);
        } catch (err: unknown) {
          const reason = (err as Error).message;
          // Rule 8: missing telemetry = gap record, not assumed healthy
          allGaps.push({
            sensorId: sensor.id,
            collectorType: sensor.sourceType,
            reason,
            attemptedAt,
          });
          await health.recordFailure(sensor.id, sensor.sourceType, reason);
        }
      }),
    );

    return { records: allRecords, gaps: allGaps };
  }
}

// ─── Sensor Health Tracker ────────────────────────────────────────────────────

/**
 * @node 02.01.03 — Sensor Health Tracker
 *
 * Tracks success/failure per sensor.  Persists to DB for monitoring.
 */
export class SensorHealthTracker {
  constructor(private readonly db: pg.Pool) {}

  async recordSuccess(sensorId: string, sourceType: string): Promise<void> {
    await this.db.query(
      `INSERT INTO sensor_health (sensor_id, source_type, last_success_at, last_attempt_at, consecutive_failures)
       VALUES ($1,$2,now(),now(),0)
       ON CONFLICT (sensor_id) DO UPDATE
       SET last_success_at=now(), last_attempt_at=now(), consecutive_failures=0, updated_at=now()`,
      [sensorId, sourceType],
    );
  }

  async recordFailure(sensorId: string, sourceType: string, error: string): Promise<void> {
    await this.db.query(
      `INSERT INTO sensor_health
         (sensor_id, source_type, last_attempt_at, consecutive_failures, last_error)
       VALUES ($1,$2,now(),1,$3)
       ON CONFLICT (sensor_id) DO UPDATE
       SET last_attempt_at=now(),
           consecutive_failures=sensor_health.consecutive_failures+1,
           last_error=$3,
           updated_at=now()`,
      [sensorId, sourceType, error],
    );
  }

  async getHealth(sensorId: string): Promise<SensorHealthRecord | null> {
    const res = await this.db.query<{
      sensor_id: string; last_success_at: Date | null; last_attempt_at: Date;
      consecutive_failures: number; last_error: string | null;
    }>(`SELECT * FROM sensor_health WHERE sensor_id=$1`, [sensorId]);
    const row = res.rows[0];
    if (!row) return null;
    return {
      sensorId: row.sensor_id,
      lastSuccessAt: row.last_success_at,
      lastAttemptAt: row.last_attempt_at,
      consecutiveFailures: row.consecutive_failures,
      lastError: row.last_error,
    };
  }
}
