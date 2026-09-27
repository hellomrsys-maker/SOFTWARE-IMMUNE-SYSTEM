/**
 * @node 11.05 — Observability — structured pino logging and metric gauge helpers.
 *
 * Every SIS component uses a named child logger derived from this module.
 * Gauge helpers write structured log records that can be scraped by log-based
 * monitoring systems.
 */

import pino, { type Logger } from 'pino';

// ─── Root logger ──────────────────────────────────────────────────────────────

/** @node 11.05 — Create or retrieve the root SIS logger. */
export function createLogger(name: string, _nodeId?: string): Logger {
  return pino({ name, level: process.env['LOG_LEVEL'] ?? 'info' });
}

// ─── GaugeRegistry ────────────────────────────────────────────────────────────

export type GaugeName = 'queue_depth' | 'worker_health' | 'sensor_failures' | 'auth_denials' | 'stalled_incidents';

/**
 * @node 11.05 — In-process gauge registry for SIS operational metrics.
 *
 * Each gauge is a named counter/gauge that can be read, set, incremented,
 * or decremented.  `snapshot()` returns the current state of all gauges.
 */
export class GaugeRegistry {
  private readonly gauges: Map<GaugeName, number>;

  constructor() {
    this.gauges = new Map([
      ['queue_depth',       0],
      ['worker_health',     1], // starts at 1 (healthy)
      ['sensor_failures',   0],
      ['auth_denials',      0],
      ['stalled_incidents', 0],
    ]);
  }

  get(name: GaugeName): number {
    return this.gauges.get(name) ?? 0;
  }

  set(name: GaugeName, value: number): void {
    this.gauges.set(name, value);
  }

  increment(name: GaugeName, delta = 1): void {
    this.gauges.set(name, this.get(name) + delta);
  }

  decrement(name: GaugeName, delta = 1): void {
    this.gauges.set(name, Math.max(0, this.get(name) - delta));
  }

  snapshot(): Record<GaugeName, number> {
    return Object.fromEntries(this.gauges) as Record<GaugeName, number>;
  }
}

// ─── Gauge record types ───────────────────────────────────────────────────────

export interface QueueDepthGauge {
  type: 'gauge.queue_depth';
  topic: string;
  depth: number;
  recordedAt: string;
}

export interface WorkerHealthGauge {
  type: 'gauge.worker_health';
  workerId: string;
  healthy: boolean;
  activeJobs: number;
  recordedAt: string;
}

export interface SensorFailureGauge {
  type: 'gauge.sensor_failure';
  sensorId: string;
  consecutiveFailures: number;
  lastError: string | null;
  recordedAt: string;
}

export interface AuthDenialGauge {
  type: 'gauge.auth_denial';
  actorId: string;
  resource: string;
  permissionType: string;
  recordedAt: string;
}

export interface StalledIncidentGauge {
  type: 'gauge.stalled_incident';
  incidentId: string;
  status: string;
  staleSinceMinutes: number;
  recordedAt: string;
}

export type Gauge =
  | QueueDepthGauge
  | WorkerHealthGauge
  | SensorFailureGauge
  | AuthDenialGauge
  | StalledIncidentGauge;

// ─── Gauge emitters ───────────────────────────────────────────────────────────

const gaugeLog = pino({ name: 'sis.gauge' });

/** @node 11.05 — Emit a queue depth gauge record. */
export function gaugeQueueDepth(topic: string, depth: number): void {
  const g: QueueDepthGauge = { type: 'gauge.queue_depth', topic, depth, recordedAt: new Date().toISOString() };
  gaugeLog.info(g, 'queue depth');
}

/** @node 11.05 — Emit a worker health gauge record. */
export function gaugeWorkerHealth(workerId: string, healthy: boolean, activeJobs: number): void {
  const g: WorkerHealthGauge = { type: 'gauge.worker_health', workerId, healthy, activeJobs, recordedAt: new Date().toISOString() };
  gaugeLog.info(g, 'worker health');
}

/** @node 11.05 — Emit a sensor failure gauge record. */
export function gaugeSensorFailure(sensorId: string, consecutiveFailures: number, lastError: string | null): void {
  const g: SensorFailureGauge = { type: 'gauge.sensor_failure', sensorId, consecutiveFailures, lastError, recordedAt: new Date().toISOString() };
  gaugeLog.warn(g, 'sensor failure');
}

/** @node 11.05 — Emit an auth denial gauge record. */
export function gaugeAuthDenial(actorId: string, resource: string, permissionType: string): void {
  const g: AuthDenialGauge = { type: 'gauge.auth_denial', actorId, resource, permissionType, recordedAt: new Date().toISOString() };
  gaugeLog.warn(g, 'auth denial');
}

/** @node 11.05 — Emit a stalled incident gauge record. */
export function gaugeStalledIncident(incidentId: string, status: string, staleSinceMinutes: number): void {
  const g: StalledIncidentGauge = { type: 'gauge.stalled_incident', incidentId, status, staleSinceMinutes, recordedAt: new Date().toISOString() };
  gaugeLog.warn(g, 'stalled incident');
}
