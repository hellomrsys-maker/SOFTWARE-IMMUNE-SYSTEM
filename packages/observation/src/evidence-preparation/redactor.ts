/**
 * @node 02.05.02 — Secret Redactor
 *
 * Rule 9: redaction runs BEFORE any write to the evidence bundle or DB.
 * No real secrets must appear in tests or in stored evidence.
 *
 * Patterns redacted:
 * - API keys (Bearer tokens, Authorization headers)
 * - JWTs (three base64 segments separated by dots)
 * - Password-like patterns
 * - Credit-card-like numeric sequences
 * - Email addresses (PII)
 * - Explicit secret env var names in key=value pairs
 */

const REDACTION_PLACEHOLDER = '[REDACTED]';

// ─── Redaction patterns ───────────────────────────────────────────────────────

const PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  // JWT: three base64url groups separated by dots
  { name: 'jwt', pattern: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g },
  // Bearer token
  { name: 'bearer', pattern: /Bearer\s+[A-Za-z0-9\-_.~+/]+=*/gi },
  // Authorization: Basic ... header value
  { name: 'basic-auth', pattern: /Basic\s+[A-Za-z0-9+/]+=*/gi },
  // password=VALUE or password: VALUE patterns
  { name: 'password-kv', pattern: /(?:password|passwd|secret|api[_-]?key|token)[=:]\s*\S+/gi },
  // DATABASE_URL with credentials: postgresql://user:pass@host
  { name: 'db-url', pattern: /(?:postgresql|postgres|mysql|redis):\/\/[^\s@]+@/gi },
  // Credit-card-like: 13-19 digit sequences
  { name: 'card', pattern: /\b(?:\d[ -]?){13,19}\b/g },
  // Email addresses (PII)
  { name: 'email', pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z]{2,}\b/gi },
];

/**
 * @node 02.05.02 — Redact secrets and PII from a string.
 */
export function redactString(input: string): string {
  let result = input;
  for (const { pattern } of PATTERNS) {
    result = result.replace(pattern, REDACTION_PLACEHOLDER);
  }
  return result;
}

/**
 * @node 02.05.02 — Recursively redact secrets from a JSON-serialisable object.
 *
 * String values are redacted.  Keys matching known secret names have their
 * entire value replaced with [REDACTED].
 */
export function redactObject(obj: unknown): unknown {
  if (typeof obj === 'string') return redactString(obj);
  if (Array.isArray(obj)) return obj.map(redactObject);
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (isSecretKey(key)) {
        result[key] = REDACTION_PLACEHOLDER;
      } else {
        result[key] = redactObject(value);
      }
    }
    return result;
  }
  return obj;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SECRET_KEY_PATTERNS = [
  /password/i, /passwd/i, /secret/i, /api[_-]?key/i, /token/i,
  /credential/i, /private[_-]?key/i, /authorization/i,
];

function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERNS.some((p) => p.test(key));
}
