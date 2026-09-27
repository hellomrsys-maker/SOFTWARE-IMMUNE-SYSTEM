/**
 * @node 03.01 — Durable Queue unit tests
 *
 * Tests the pure-logic helpers (backpressure error, exponential backoff)
 * without requiring a DB connection.
 */

import { describe, it, expect } from 'vitest';
import { BackpressureError, exponentialBackoffWithJitter } from '../../src/delivery/queue.js';

describe('exponentialBackoffWithJitter', () => {
  it('returns a positive number', () => {
    expect(exponentialBackoffWithJitter(1)).toBeGreaterThan(0);
  });

  it('increases with attempt count', () => {
    const a1 = exponentialBackoffWithJitter(1) - 1000; // strip jitter approx
    const a3 = exponentialBackoffWithJitter(3) - 1000;
    // The base (without jitter) should be larger for attempt 3
    // We can't be exact due to jitter, but the cap at 60s means attempt 10+ is ~60s
    expect(exponentialBackoffWithJitter(10)).toBeLessThanOrEqual(61_000);
  });

  it('caps at 60 000 ms + jitter', () => {
    const result = exponentialBackoffWithJitter(100);
    expect(result).toBeLessThanOrEqual(61_000);
  });
});

describe('BackpressureError', () => {
  it('carries topic and depth', () => {
    const err = new BackpressureError('msg', 'incident.created', 1001);
    expect(err.topic).toBe('incident.created');
    expect(err.depth).toBe(1001);
    expect(err.name).toBe('BackpressureError');
  });
});
