/**
 * @node 02.05 — Timestamp normalizer and deduplicator unit tests.
 */

import { describe, it, expect } from 'vitest';
import { normalizeTimestamps } from '../../src/evidence-preparation/timestamp-normalizer.js';
import { deduplicateRecords } from '../../src/evidence-preparation/deduplicator.js';
import type { EvidenceRecord } from '../../src/evidence-preparation/types.js';

describe('normalizeTimestamps', () => {
  it('sets clockOrderUncertain=false for a past original timestamp', () => {
    const past = new Date(Date.now() - 5000).toISOString();
    const result = normalizeTimestamps(past);
    expect(result.originalTimestamp).toBe(past);
    expect(result.collectionTimestamp).toBeDefined();
    expect(result.clockOrderUncertain).toBe(false);
  });

  it('sets clockOrderUncertain=true when originalTimestamp is null', () => {
    const result = normalizeTimestamps(null);
    expect(result.originalTimestamp).toBeNull();
    expect(result.clockOrderUncertain).toBe(true);
  });

  it('sets clockOrderUncertain=true when original is far in the future', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const result = normalizeTimestamps(future);
    expect(result.clockOrderUncertain).toBe(true);
  });
});

describe('deduplicateRecords', () => {
  const makeRecord = (hash: string): EvidenceRecord => ({
    id: hash.slice(0, 8) + '-0000-0000-0000-000000000000',
    recordType: 'log',
    sourceReference: {},
    timestamps: {
      originalTimestamp: null,
      collectionTimestamp: new Date().toISOString(),
      clockOrderUncertain: true,
    },
    contentHash: hash.padEnd(64, '0'),
    payload: {},
  });

  it('returns all records when all hashes are unique', () => {
    const records = [makeRecord('aaa'), makeRecord('bbb'), makeRecord('ccc')];
    expect(deduplicateRecords(records)).toHaveLength(3);
  });

  it('removes duplicate records with the same content hash', () => {
    const records = [makeRecord('aaa'), makeRecord('aaa'), makeRecord('bbb')];
    expect(deduplicateRecords(records)).toHaveLength(2);
  });

  it('keeps the first occurrence of a duplicate', () => {
    const r1 = { ...makeRecord('aaa'), id: 'first-000-0000-0000-000000000000' };
    const r2 = { ...makeRecord('aaa'), id: 'secnd-000-0000-0000-000000000000' };
    const result = deduplicateRecords([r1, r2]);
    expect(result[0]?.id).toBe('first-000-0000-0000-000000000000');
  });
});
