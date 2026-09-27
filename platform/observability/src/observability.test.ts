/**
 * @node 11.05 — Observability unit tests
 */

import { describe, it, expect } from 'vitest';
import { GaugeRegistry, createLogger } from './index.js';

describe('GaugeRegistry', () => {
  it('initialises all gauges to 0 except worker_health which starts at 1', () => {
    const g = new GaugeRegistry();
    expect(g.get('queue_depth')).toBe(0);
    expect(g.get('worker_health')).toBe(1);
    expect(g.get('sensor_failures')).toBe(0);
    expect(g.get('auth_denials')).toBe(0);
    expect(g.get('stalled_incidents')).toBe(0);
  });

  it('set changes the gauge value', () => {
    const g = new GaugeRegistry();
    g.set('queue_depth', 5);
    expect(g.get('queue_depth')).toBe(5);
  });

  it('increment adds delta (default 1)', () => {
    const g = new GaugeRegistry();
    g.increment('auth_denials');
    g.increment('auth_denials');
    expect(g.get('auth_denials')).toBe(2);
  });

  it('increment with explicit delta', () => {
    const g = new GaugeRegistry();
    g.increment('sensor_failures', 3);
    expect(g.get('sensor_failures')).toBe(3);
  });

  it('decrement reduces gauge value', () => {
    const g = new GaugeRegistry();
    g.set('queue_depth', 10);
    g.decrement('queue_depth', 3);
    expect(g.get('queue_depth')).toBe(7);
  });

  it('decrement does not go below 0', () => {
    const g = new GaugeRegistry();
    g.decrement('queue_depth', 100);
    expect(g.get('queue_depth')).toBe(0);
  });

  it('snapshot returns all gauges', () => {
    const g = new GaugeRegistry();
    g.set('queue_depth', 7);
    const snap = g.snapshot();
    expect(snap.queue_depth).toBe(7);
    expect(snap.worker_health).toBe(1);
  });
});

describe('createLogger', () => {
  it('returns a logger without throwing', () => {
    const logger = createLogger('test-component', '11.05');
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
  });
});
