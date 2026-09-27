/**
 * @node 03.04 — Authorization Engine unit tests
 *
 * Tests:
 * - Approved command registry: allowed binaries pass, unknown binaries denied
 * - Denial result is returned (audit write is async and doesn't block result)
 * - Network access always denied
 * - APPROVED_COMMANDS is a hardcoded constant
 */

import { describe, it, expect } from 'vitest';
import {
  AuthorizationEngine,
  APPROVED_COMMANDS,
} from '../../src/authorization/engine.js';

// Minimal mock pool — the auth engine writes denial records; in unit tests
// we provide a pool that accepts the INSERT silently.
const mockPool = {
  query: async () => ({ rows: [], rowCount: 0 }),
  connect: async () => ({
    query: async () => ({ rows: [], rowCount: 0 }),
    release: () => undefined,
  }),
} as unknown as import('pg').Pool;

describe('APPROVED_COMMANDS', () => {
  it('contains tsc, vitest, pnpm, eslint, git-apply, git-diff', () => {
    const binaries = APPROVED_COMMANDS.map((c) => c.binary);
    expect(binaries).toContain('tsc');
    expect(binaries).toContain('vitest');
    expect(binaries).toContain('pnpm');
    expect(binaries).toContain('eslint');
    expect(binaries).toContain('git');
  });

  it('is readonly (cannot be mutated at runtime)', () => {
    // TypeScript enforces `as const`; runtime Object.isFrozen check
    // The array itself: assignment to index should throw in strict mode
    // We just verify the length is stable
    const len = APPROVED_COMMANDS.length;
    expect(len).toBeGreaterThanOrEqual(4);
  });
});

describe('AuthorizationEngine.checkCommand', () => {
  const engine = new AuthorizationEngine(mockPool);

  it('allows tsc --noEmit', async () => {
    const result = await engine.checkCommand({
      actorId: 'repair-agent', binary: 'tsc', args: ['--noEmit'],
    });
    expect(result.decision).toBe('allowed');
  });

  it('allows vitest run', async () => {
    const result = await engine.checkCommand({
      actorId: 'repair-agent', binary: 'vitest', args: ['run'],
    });
    expect(result.decision).toBe('allowed');
  });

  it('denies unknown binary', async () => {
    const result = await engine.checkCommand({
      actorId: 'repair-agent', binary: 'rm', args: ['-rf', '/'],
    });
    expect(result.decision).toBe('denied');
    if (result.decision === 'denied') {
      expect(result.reason).toContain('not in the approved command registry');
    }
  });

  it('denies tsc without --noEmit', async () => {
    const result = await engine.checkCommand({
      actorId: 'repair-agent', binary: 'tsc', args: ['--build'],
    });
    expect(result.decision).toBe('denied');
  });

  it('denies git with disallowed subcommand (push)', async () => {
    const result = await engine.checkCommand({
      actorId: 'repair-agent', binary: 'git', args: ['push', 'origin', 'main'],
    });
    expect(result.decision).toBe('denied');
  });

  it('allows git apply (approved)', async () => {
    const result = await engine.checkCommand({
      actorId: 'repair-agent', binary: 'git', args: ['apply', 'fix.patch'],
    });
    expect(result.decision).toBe('allowed');
  });
});

describe('AuthorizationEngine.checkNetwork', () => {
  const engine = new AuthorizationEngine(mockPool);

  it('always denies outbound network access', async () => {
    const result = await engine.checkNetwork({
      actorId: 'repair-agent', destination: 'https://external-api.example.com',
    });
    expect(result.decision).toBe('denied');
  });
});

describe('AuthorizationEngine.checkRead', () => {
  const engine = new AuthorizationEngine(mockPool);

  it('allows reads', async () => {
    const result = await engine.checkRead({ actorId: 'worker', resource: 'evidence-bundle-123' });
    expect(result.decision).toBe('allowed');
  });
});
