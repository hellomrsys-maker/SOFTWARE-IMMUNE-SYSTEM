/**
 * @node 02 — Observation Subsystem unit tests
 *
 * Tests sensor registry, health tracker, evidence preparation, and redaction.
 *
 * Limitation: does not test live DB interactions; health tracker tests use mocks.
 */

import { describe, it, expect, vi, type Mock } from 'vitest';
import {
  SensorRegistry,
  SensorHealthTracker,
  SensorScheduler,
} from '../src/sensor-lifecycle.js';
import {
  SecretRedactor,
  EvidencePreparer,
  extractSections,
} from '../src/evidence-preparation.js';
import type { Pool } from 'pg';

function makePool(rows: unknown[] = []): Pool {
  return { query: vi.fn().mockResolvedValue({ rows }) } as unknown as Pool;
}

// ─── 02.01 SensorRegistry ─────────────────────────────────────────────────────

describe('SensorRegistry', () => {
  it('registers and retrieves a sensor', () => {
    const registry = new SensorRegistry();
    const def = {
      sensorId: 'log-sensor',
      sourceType: 'log' as const,
      trigger: 'periodic' as const,
      intervalMs: 5000,
      collect: async () => [],
    };
    registry.register(def);
    expect(registry.get('log-sensor')).toBe(def);
  });

  it('throws on duplicate sensorId', () => {
    const registry = new SensorRegistry();
    const def = { sensorId: 'dup', sourceType: 'log' as const, trigger: 'event' as const, collect: async () => [] };
    registry.register(def);
    expect(() => registry.register(def)).toThrow('already registered');
  });

  it('listBySourceType filters correctly', () => {
    const registry = new SensorRegistry();
    registry.register({ sensorId: 's1', sourceType: 'log', trigger: 'event', collect: async () => [] });
    registry.register({ sensorId: 's2', sourceType: 'trace', trigger: 'event', collect: async () => [] });
    expect(registry.listBySourceType('log')).toHaveLength(1);
    expect(registry.listBySourceType('trace')).toHaveLength(1);
    expect(registry.listBySourceType('metric')).toHaveLength(0);
  });
});

// ─── 02.01.03 SensorHealthTracker ────────────────────────────────────────────

describe('SensorHealthTracker', () => {
  it('recordSuccess calls DB query', async () => {
    const pool = makePool();
    const tracker = new SensorHealthTracker(pool);
    await tracker.recordSuccess('s1', 'log');
    expect(pool.query as Mock).toHaveBeenCalled();
  });

  it('recordFailure calls DB query', async () => {
    const pool = makePool();
    const tracker = new SensorHealthTracker(pool);
    await tracker.recordFailure('s1', 'log', 'connection refused');
    expect(pool.query as Mock).toHaveBeenCalled();
  });

  it('getHealth returns null when no record', async () => {
    const pool = makePool([]);
    const tracker = new SensorHealthTracker(pool);
    expect(await tracker.getHealth('unknown')).toBeNull();
  });

  it('getHealth returns health record', async () => {
    const pool = makePool([{
      sensor_id: 's1', source_type: 'log',
      last_success_at: null, last_attempt_at: new Date(),
      consecutive_failures: 2, last_error: 'timeout',
    }]);
    const tracker = new SensorHealthTracker(pool);
    const health = await tracker.getHealth('s1');
    expect(health?.consecutiveFailures).toBe(2);
    expect(health?.lastError).toBe('timeout');
  });
});

// ─── 02.01.02 SensorScheduler ────────────────────────────────────────────────

describe('SensorScheduler', () => {
  it('runSensor returns observations on success', async () => {
    const pool = makePool();
    const registry = new SensorRegistry();
    const tracker = new SensorHealthTracker(pool);
    registry.register({
      sensorId: 's1',
      sourceType: 'log',
      trigger: 'event',
      collect: async () => [{
        sourceType: 'log',
        content: { message: 'test' },
        sourceReference: { service: 'checkout' },
      }],
    });
    const scheduler = new SensorScheduler(registry, tracker);
    const obs = await scheduler.runSensor(registry.get('s1')!, {});
    expect(obs).toHaveLength(1);
  });

  it('runSensor returns empty array on sensor error and records failure', async () => {
    const pool = makePool();
    const registry = new SensorRegistry();
    const tracker = new SensorHealthTracker(pool);
    registry.register({
      sensorId: 's2',
      sourceType: 'metric',
      trigger: 'event',
      collect: async () => { throw new Error('sensor broken'); },
    });
    const scheduler = new SensorScheduler(registry, tracker);
    const obs = await scheduler.runSensor(registry.get('s2')!, {});
    expect(obs).toHaveLength(0);
    expect(pool.query as Mock).toHaveBeenCalled(); // health recorded
  });
});

// ─── 02.05.02 SecretRedactor ──────────────────────────────────────────────────

describe('SecretRedactor', () => {
  const redactor = new SecretRedactor();

  it('redacts Bearer tokens', () => {
    const result = redactor.redactString('Authorization: Bearer eyJabc.def.ghi');
    expect(result).not.toContain('eyJabc');
    expect(result).toContain('[REDACTED]');
  });

  it('redacts postgres connection strings', () => {
    const result = redactor.redactString('postgres://user:secret@localhost/db');
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain('secret');
  });

  it('redacts password fields', () => {
    const result = redactor.redactString('password=super_secret_123');
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain('super_secret_123');
  });

  it('deep-redacts objects', () => {
    const obj = { auth: 'Bearer eyJtoken', data: { nested: 'postgres://u:p@host/db' } };
    const result = redactor.redactObject(obj) as typeof obj;
    expect(result.auth).toContain('[REDACTED]');
    expect(result.data.nested).toContain('[REDACTED]');
  });

  it('leaves normal content unchanged', () => {
    const result = redactor.redactString('hello world, count=42');
    expect(result).toBe('hello world, count=42');
  });
});

// ─── 02.05 EvidencePreparer ───────────────────────────────────────────────────

describe('EvidencePreparer', () => {
  it('produces a bundle with redacted records', () => {
    const preparer = new EvidencePreparer();
    const bundle = preparer.prepare(
      'incident-1',
      [
        {
          sourceType: 'log',
          content: { message: 'user login', password: 'secret123' },
          sourceReference: { service: 'checkout' },
          originalTimestamp: new Date().toISOString(),
        },
      ],
      ['log-sensor'],
      [],
    );
    expect(bundle.incidentId).toBe('incident-1');
    expect(bundle.records).toHaveLength(1);
    // Content should be redacted
    const record = bundle.records[0]!;
    expect(JSON.stringify(record.payload)).not.toContain('secret123');
  });

  it('deduplicates identical observations', () => {
    const preparer = new EvidencePreparer();
    const obs = {
      sourceType: 'log' as const,
      content: { message: 'same message' },
      sourceReference: { service: 'app' },
    };
    const bundle = preparer.prepare('inc-2', [obs, obs, obs], ['s1'], []);
    expect(bundle.records).toHaveLength(1);
  });

  it('builds checksums per record type', () => {
    const preparer = new EvidencePreparer();
    const bundle = preparer.prepare(
      'inc-3',
      [
        { sourceType: 'log', content: { x: 1 }, sourceReference: {} },
        { sourceType: 'trace', content: { y: 2 }, sourceReference: {} },
      ],
      ['s1'],
      [],
    );
    expect(bundle.checksums['log']).toBeDefined();
    expect(bundle.checksums['trace']).toBeDefined();
  });

  it('includes collection gaps in the bundle', () => {
    const preparer = new EvidencePreparer();
    const gaps = [{
      sourceType: 'metric',
      reason: 'sensor offline',
      startedAt: new Date().toISOString(),
    }];
    const bundle = preparer.prepare('inc-4', [], ['s1'], gaps);
    expect(bundle.collectionGaps).toHaveLength(1);
    expect(bundle.collectionGaps[0]?.reason).toBe('sensor offline');
  });
});

// ─── 02.04 extractSections ───────────────────────────────────────────────────

describe('extractSections', () => {
  it('extracts sections from markdown', () => {
    const md = `# Title\nIntro text\n## Section A\nContent A\n### Sub\nContent Sub`;
    const sections = extractSections(md);
    expect(sections).toHaveLength(3);
    expect(sections[0]?.heading).toBe('Title');
    expect(sections[1]?.heading).toBe('Section A');
    expect(sections[2]?.heading).toBe('Sub');
  });

  it('marks sections as untrusted when flag is true', () => {
    const md = `# External doc\nExternal content`;
    const sections = extractSections(md, true);
    expect(sections[0]?.untrusted).toBe(true);
  });

  it('marks sections as trusted by default', () => {
    const md = `# Internal doc\nContent`;
    const sections = extractSections(md);
    expect(sections[0]?.untrusted).toBe(false);
  });

  it('returns empty array for content with no headings', () => {
    const sections = extractSections('Just plain text with no headings.');
    expect(sections).toHaveLength(0);
  });
});
