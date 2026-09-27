/**
 * @node 02.02 — Runtime Observation — Log, Trace, Metric, and Business State Collectors
 */

import { redactString } from '../evidence-preparation/redactor.js';
import type { SensorOutput } from '../sensor-lifecycle/registry.js';

// ─── Log Collector (02.02.01) ─────────────────────────────────────────────────

/**
 * @node 02.02.01 — Log Collector
 *
 * Parses structured JSON log lines.  Preserves source file + line references.
 * Captures error and retry events specifically.
 */
export function collectLogs(rawLogLines: string[]): SensorOutput {
  const records: SensorOutput['records'] = [];
  const gaps: import('../evidence-preparation/types.js').CollectionGap[] = [];

  for (const line of rawLogLines) {
    try {
      const parsed: unknown = JSON.parse(line);
      if (typeof parsed !== 'object' || parsed === null) continue;

      const entry = parsed as Record<string, unknown>;
      // Redact before storing
      const redactedMsg = typeof entry['msg'] === 'string' ? redactString(entry['msg']) : '';

      const origTs: string | undefined = typeof entry['time'] === 'number'
        ? new Date(entry['time'] as number).toISOString()
        : typeof entry['time'] === 'string' ? (entry['time'] as string) : undefined;
      const record: SensorOutput['records'][number] = {
        recordType: 'log',
        sourceReference: {
          file: entry['filename'] as string | undefined,
          line: entry['line'] as number | undefined,
          service: entry['name'] as string | undefined,
        } as Record<string, unknown>,
        ...(origTs !== undefined ? { originalTimestamp: origTs } : {}),
        payload: {
          level: entry['level'],
          msg: redactedMsg,
          err: entry['err'],
          traceId: entry['traceId'],
          requestId: entry['requestId'],
        } as Record<string, unknown>,
      };
      records.push(record);
    } catch {
      // Non-JSON line — skip
    }
  }

  return { records, gaps };
}

// ─── Trace Collector (02.02.02) ───────────────────────────────────────────────

export interface OtelSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTimeUnixNano: string;
  endTimeUnixNano?: string;
  attributes?: Record<string, unknown>;
  status?: { code: number };
}

/**
 * @node 02.02.02 — Trace Collector
 *
 * Parses OpenTelemetry-compatible span JSON arrays.
 * Identifies service-call boundaries via parentSpanId relationships.
 */
export function collectTraces(spans: OtelSpan[]): SensorOutput {
  return {
    records: spans.map((span): SensorOutput['records'][number] => {
      const origTs = span.startTimeUnixNano
        ? new Date(Number(BigInt(span.startTimeUnixNano) / 1_000_000n)).toISOString()
        : undefined;
      return {
        recordType: 'trace',
        sourceReference: { service: span.name } as Record<string, unknown>,
        ...(origTs !== undefined ? { originalTimestamp: origTs } : {}),
        payload: {
        traceId: span.traceId,
        spanId: span.spanId,
          parentSpanId: span.parentSpanId ?? null,
          name: span.name,
          statusCode: span.status?.code ?? 0,
          isRootSpan: !span.parentSpanId,
          attributes: span.attributes ?? {},
        } as Record<string, unknown>,
      };
    }),
    gaps: [],
  };
}

// ─── Metric Collector (02.02.03) ──────────────────────────────────────────────

export interface MetricSnapshot {
  requestCount?: number;
  errorCount?: number;
  p50DurationMs?: number;
  p99DurationMs?: number;
  queueDepth?: number;
  service?: string;
  capturedAt?: string;
}

/**
 * @node 02.02.03 — Metric Collector
 *
 * Records request counts, error counts, duration histograms, queue depths.
 */
export function collectMetrics(snapshot: MetricSnapshot): SensorOutput {
  return {
    records: [{
      recordType: 'metric',
      sourceReference: { service: snapshot.service ?? 'unknown' } as Record<string, unknown>,
      ...(snapshot.capturedAt !== undefined ? { originalTimestamp: snapshot.capturedAt } : {}),
      payload: snapshot as Record<string, unknown>,
    }],
    gaps: [],
  };
}

// ─── Business State Observer (02.02.04) ──────────────────────────────────────

import type pg from 'pg';

/**
 * @node 02.02.04 — Business State Observer
 *
 * Performs READ-ONLY DB queries to observe payment cardinality and order consistency.
 * NEVER mutates data.
 */
export async function observeBusinessState(
  db: pg.Pool,
  incidentScope: { orderIds?: string[]; logicalIds?: string[] },
): Promise<SensorOutput> {
  const records: SensorOutput['records'] = [];
  const gaps = [];
  const observedAt = new Date().toISOString();

  // Check payment cardinality (detects duplicate charges)
  if (incidentScope.logicalIds && incidentScope.logicalIds.length > 0) {
    try {
      const res = await db.query<{
        logical_id: string; completed_count: string;
      }>(
        `SELECT logical_id, COUNT(*) as completed_count
         FROM payments
         WHERE logical_id = ANY($1) AND status='completed'
         GROUP BY logical_id
         HAVING COUNT(*) > 0`,
        [incidentScope.logicalIds],
      );

      records.push({
        recordType: 'business_state',
        sourceReference: { service: 'payment-simulator' },
        originalTimestamp: observedAt,
        payload: {
          observationType: 'payment_cardinality',
          logicalIds: incidentScope.logicalIds,
          results: res.rows.map((r) => ({
            logicalId: r.logical_id,
            completedCount: parseInt(r.completed_count, 10),
          })),
        },
      });
    } catch (err: unknown) {
      gaps.push({
        sensorId: 'business-state-observer',
        collectorType: 'business_state',
        reason: `Payment cardinality query failed: ${(err as Error).message}`,
        attemptedAt: observedAt,
      });
    }
  }

  return { records, gaps };
}
