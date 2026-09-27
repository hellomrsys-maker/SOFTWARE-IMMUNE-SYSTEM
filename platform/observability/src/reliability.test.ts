/**
 * @node 11.06 — Reliability safeguards unit tests
 */

import { describe, it, expect, vi } from 'vitest';
import { IdempotentCommandWrapper } from '../src/reliability.js';

describe('IdempotentCommandWrapper', () => {
  it('executes fn on first call', async () => {
    const wrapper = new IdempotentCommandWrapper();
    const fn = vi.fn().mockResolvedValue('result-1');
    const result = await wrapper.execute('cmd-1', fn);
    expect(result).toBe('result-1');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('returns stored result without re-executing on second call', async () => {
    const wrapper = new IdempotentCommandWrapper();
    const fn = vi.fn().mockResolvedValue('result-2');
    await wrapper.execute('cmd-2', fn);
    const result2 = await wrapper.execute('cmd-2', fn);
    expect(result2).toBe('result-2');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('executes different commandIds independently', async () => {
    const wrapper = new IdempotentCommandWrapper();
    const fn1 = vi.fn().mockResolvedValue('a');
    const fn2 = vi.fn().mockResolvedValue('b');
    const r1 = await wrapper.execute('id-a', fn1);
    const r2 = await wrapper.execute('id-b', fn2);
    expect(r1).toBe('a');
    expect(r2).toBe('b');
    expect(fn1).toHaveBeenCalledTimes(1);
    expect(fn2).toHaveBeenCalledTimes(1);
  });

  it('has() returns false before first execution', () => {
    const wrapper = new IdempotentCommandWrapper();
    expect(wrapper.has('cmd-x')).toBe(false);
  });

  it('has() returns true after first execution', async () => {
    const wrapper = new IdempotentCommandWrapper();
    await wrapper.execute('cmd-y', async () => 'done');
    expect(wrapper.has('cmd-y')).toBe(true);
  });

  it('clear() removes all stored results', async () => {
    const wrapper = new IdempotentCommandWrapper();
    await wrapper.execute('cmd-z', async () => 'val');
    wrapper.clear();
    expect(wrapper.has('cmd-z')).toBe(false);
  });
});
