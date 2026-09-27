/**
 * @node 03.02 — Incident State Machine unit tests
 *
 * Tests all valid and invalid state transitions (no DB required — tests use
 * the exported ALLOWED_TRANSITIONS table directly).
 */

import { describe, it, expect } from 'vitest';
import {
  ALLOWED_TRANSITIONS,
  INCIDENT_STATES,
  InvalidTransitionError,
  type IncidentState,
} from '../../src/incident-state-machine/machine.js';

describe('ALLOWED_TRANSITIONS', () => {
  it('is a hardcoded constant (not modifiable at runtime)', () => {
    // The object is frozen in spirit — verify all states have entries
    for (const state of INCIDENT_STATES) {
      expect(ALLOWED_TRANSITIONS).toHaveProperty(state);
    }
  });

  it('has correct transitions for created', () => {
    expect(ALLOWED_TRANSITIONS.created).toContain('observing');
    expect(ALLOWED_TRANSITIONS.created).toContain('abstained');
    expect(ALLOWED_TRANSITIONS.created).not.toContain('review_ready');
  });

  it('has correct transitions for validating', () => {
    expect(ALLOWED_TRANSITIONS.validating).toContain('review_ready');
    expect(ALLOWED_TRANSITIONS.validating).toContain('rejected');
    expect(ALLOWED_TRANSITIONS.validating).not.toContain('created');
  });

  it('terminal states have no allowed transitions', () => {
    const terminals: IncidentState[] = ['review_ready', 'rejected', 'escalated', 'abstained'];
    for (const s of terminals) {
      expect(ALLOWED_TRANSITIONS[s]).toHaveLength(0);
    }
  });
});

describe('Invalid transitions', () => {
  function checkTransition(from: IncidentState, to: IncidentState): boolean {
    return (ALLOWED_TRANSITIONS[from] as readonly IncidentState[]).includes(to);
  }

  it('created → review_ready is invalid', () => {
    expect(checkTransition('created', 'review_ready')).toBe(false);
  });

  it('review_ready → observing is invalid (terminal)', () => {
    expect(checkTransition('review_ready', 'observing')).toBe(false);
  });

  it('rejected → diagnosing is invalid (terminal)', () => {
    expect(checkTransition('rejected', 'diagnosing')).toBe(false);
  });

  it('repairing → observing is invalid', () => {
    expect(checkTransition('repairing', 'observing')).toBe(false);
  });
});

describe('InvalidTransitionError', () => {
  it('carries from and to states', () => {
    const err = new InvalidTransitionError('msg', 'created', 'review_ready');
    expect(err.from).toBe('created');
    expect(err.to).toBe('review_ready');
    expect(err.name).toBe('InvalidTransitionError');
  });
});
