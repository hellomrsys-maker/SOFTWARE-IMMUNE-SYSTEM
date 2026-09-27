/**
 * @node 02.05.02 — Redactor tests
 *
 * Verifies:
 * - JWTs are stripped
 * - Bearer tokens are stripped
 * - Passwords in key=value pairs are stripped
 * - Email addresses (PII) are stripped
 * - Non-sensitive content is preserved
 * - No real secrets are used in tests
 */

import { describe, it, expect } from 'vitest';
import { redactString, redactObject } from '../../src/evidence-preparation/redactor.js';

describe('redactString', () => {
  it('redacts JWT tokens', () => {
    const input = 'Authorization header: eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.signature';
    const result = redactString(input);
    expect(result).not.toContain('eyJhbGciOiJSUzI1NiJ9');
    expect(result).toContain('[REDACTED]');
  });

  it('redacts Bearer tokens', () => {
    const result = redactString('Authorization: Bearer test-token-value-not-real');
    expect(result).not.toContain('test-token-value-not-real');
    expect(result).toContain('[REDACTED]');
  });

  it('redacts password= key-value pairs', () => {
    const result = redactString('connected with password=supersecret123');
    expect(result).not.toContain('supersecret123');
    expect(result).toContain('[REDACTED]');
  });

  it('redacts email addresses (PII)', () => {
    const result = redactString('User: alice@example.com requested checkout');
    expect(result).not.toContain('alice@example.com');
    expect(result).toContain('[REDACTED]');
  });

  it('preserves non-sensitive content', () => {
    const input = 'Order ID: order-123, amount: 99.99 USD';
    const result = redactString(input);
    expect(result).toContain('order-123');
    expect(result).toContain('99.99');
    expect(result).toContain('USD');
  });

  it('redacts database URLs with credentials', () => {
    const result = redactString('Using postgresql://user:password@localhost:5432/db');
    expect(result).not.toContain('user:password');
    expect(result).toContain('[REDACTED]');
  });
});

describe('redactObject', () => {
  it('redacts values for keys matching secret patterns', () => {
    const obj = { userId: 'user-123', password: 'secret-password', amount: 50 };
    const result = redactObject(obj) as Record<string, unknown>;
    expect(result['password']).toBe('[REDACTED]');
    expect(result['userId']).toBe('user-123');
    expect(result['amount']).toBe(50);
  });

  it('redacts nested secret keys', () => {
    const obj = { auth: { token: 'my-token', scope: 'read' } };
    const result = redactObject(obj) as { auth: { token: unknown; scope: unknown } };
    expect(result.auth.token).toBe('[REDACTED]');
    expect(result.auth.scope).toBe('read');
  });

  it('redacts strings inside arrays', () => {
    const arr = ['safe value', 'Bearer some-token'];
    const result = redactObject(arr) as string[];
    expect(result[0]).toBe('safe value');
    expect(result[1]).not.toContain('some-token');
  });

  it('preserves non-secret primitive values', () => {
    const obj = { orderId: 'order-abc', amount: 100, currency: 'USD' };
    const result = redactObject(obj) as typeof obj;
    expect(result.orderId).toBe('order-abc');
    expect(result.amount).toBe(100);
    expect(result.currency).toBe('USD');
  });
});
