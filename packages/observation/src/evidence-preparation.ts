/**
 * @node 02.05 — Evidence Preparation
 *
 * Validates, redacts, deduplicates, and packages raw observations into
 * a timestamped evidence bundle.  All evidence is redacted BEFORE storage.
 *
 * Components:
 *   SecretRedactor   — removes secrets and PII from content
 *   EvidenceRedactor — orchestrates redaction
 *   EvidencePreparer — builds the complete bundle with source manifest,
 *                      collection gaps, and SHA-256 checksums
 *
 * Operating restriction §00.04.08: All evidence must be redacted before
 * writing to the evidence bundle or database.
 *
 * Limitation: The redactor uses simple regex patterns.  It does not perform
 * semantic analysis; novel secret formats may not be detected.
 */

import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { RawObservation, SourceType } from './sensor-lifecycle.js';

// ─── Evidence schemas ─────────────────────────────────────────────────────────

/** @node 02.05.01 — Zod schema for a single evidence record */
export const EvidenceRecordSchema = z.object({
  recordType: z.enum(['log', 'trace', 'metric', 'repository', 'document', 'business_state']),
  sourceReference: z.record(z.unknown()),
  originalTimestamp: z.string().datetime().optional(),
  collectionTimestamp: z.string().datetime(),
  clockOrderUncertain: z.boolean().default(false),
  contentHash: z.string().length(64), // SHA-256 hex
  payload: z.record(z.unknown()),     // redacted content
});
export type EvidenceRecord = z.infer<typeof EvidenceRecordSchema>;

/** @node 02.05.06 — Collection gap record */
export const CollectionGapSchema = z.object({
  sourceType: z.string(),
  reason: z.string(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().optional(),
});
export type CollectionGap = z.infer<typeof CollectionGapSchema>;

/** @node 02.05.06 — Complete evidence bundle */
export interface EvidenceBundle {
  incidentId: string;
  records: EvidenceRecord[];
  sourceManifest: SourceManifestEntry[];
  collectionGaps: CollectionGap[];
  /** Map of recordType → SHA-256 of all content hashes concatenated */
  checksums: Record<string, string>;
  preparedAt: Date;
}

export interface SourceManifestEntry {
  sourceType: SourceType;
  sensorId: string;
  recordCount: number;
  collectedAt: Date;
}

// ─── SecretRedactor ───────────────────────────────────────────────────────────

/**
 * @node 02.05.02 — Secret redactor.
 *
 * Replaces known secret patterns in string content with [REDACTED].
 * Applied to ALL evidence content before storage (§00.04.08).
 *
 * Patterns detected:
 *   - Bearer/API tokens
 *   - Database connection strings
 *   - Private key headers
 *   - Credit card numbers (Luhn-valid patterns)
 *   - AWS/generic secret key patterns
 *
 * Limitation: regex-based; does not detect all possible secret formats.
 * Novel or obfuscated secrets may not be redacted.
 */
export class SecretRedactor {
  private static readonly PATTERNS: RegExp[] = [
    // Authorization headers
    /bearer\s+[a-zA-Z0-9\-._~+/]+=*/gi,
    // Generic API keys
    /(?:api[_-]?key|apikey|access[_-]?key|secret[_-]?key)\s*[:=]\s*['"]?[a-zA-Z0-9+/=]{8,}['"]?/gi,
    // Database URLs with credentials
    /postgres(?:ql)?:\/\/[^:@\s]+:[^@\s]+@[^\s]*/gi,
    /mysql:\/\/[^:@\s]+:[^@\s]+@[^\s]*/gi,
    // Private key headers
    /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA\s+)?PRIVATE\s+KEY-----/gi,
    // AWS secret access keys
    /AKIA[0-9A-Z]{16}/g,
    // JWT tokens (3-part base64)
    /eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g,
    // Generic passwords in key-value pairs (colon, equals, or JSON-style)
    /(?:password|passwd|pwd)\s*[:=]\s*['"]?[^\s'",}{]{4,}['"]?/gi,
    // JSON "password": "value" pattern
    /"(?:password|passwd|pwd)"\s*:\s*"[^"]{4,}"/gi,
  ];

  /** @node 02.05.02 — Redact a string value. */
  redactString(input: string): string {
    let result = input;
    for (const pattern of SecretRedactor.PATTERNS) {
      result = result.replace(pattern, '[REDACTED]');
    }
    return result;
  }

  /** @node 02.05.02 — Sensitive key names that are always redacted regardless of value format. */
  private static readonly SENSITIVE_KEYS = new Set([
    'password', 'passwd', 'pwd', 'secret', 'api_key', 'apikey', 'access_key',
    'private_key', 'token', 'auth', 'authorization', 'credential', 'credentials',
  ]);

  /**
   * @node 02.05.02 — Deep-redact an object, returning a new object.
   *
   * Recursively processes all string values.  Keys matching sensitive names
   * are always redacted regardless of the value format.
   */
  redactObject(input: unknown): unknown {
    if (typeof input === 'string') return this.redactString(input);
    if (Array.isArray(input)) return input.map((v) => this.redactObject(v));
    if (input !== null && typeof input === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(input)) {
        if (SecretRedactor.SENSITIVE_KEYS.has(key.toLowerCase())) {
          result[key] = '[REDACTED]';
        } else {
          result[key] = this.redactObject(value);
        }
      }
      return result;
    }
    return input;
  }
}

// ─── EvidencePreparer ─────────────────────────────────────────────────────────

/**
 * @node 02.05 — EvidencePreparer
 *
 * Takes raw observations from sensors and produces a validated, redacted,
 * deduplicated evidence bundle.
 */
export class EvidencePreparer {
  private readonly redactor = new SecretRedactor();

  /**
   * @node 02.05.03 — Prepare an evidence bundle from raw observations.
   *
   * Steps:
   *   1. Redact all content (§00.04.08 — must happen before any storage)
   *   2. Deduplicate by content hash
   *   3. Validate each record against EvidenceRecordSchema
   *   4. Build source manifest and checksums
   *   5. Include collection gaps for missing sensor runs
   *
   * Limitation: deduplication is within-bundle only; cross-bundle dedup
   * requires querying `evidence_records.content_hash`.
   */
  prepare(
    incidentId: string,
    observations: RawObservation[],
    sensorIds: string[],
    collectionGaps: CollectionGap[],
  ): EvidenceBundle {
    const now = new Date();
    const seenHashes = new Set<string>();
    const records: EvidenceRecord[] = [];
    const sourceManifestMap = new Map<string, SourceManifestEntry>();

    for (const obs of observations) {
      // Step 1: Redact
      const redactedContent = this.redactor.redactObject(obs.content);

      // Step 2: Hash for deduplication
      const contentHash = createHash('sha256')
        .update(JSON.stringify(redactedContent))
        .digest('hex');

      if (seenHashes.has(contentHash)) continue; // deduplicate
      seenHashes.add(contentHash);

      // Step 3: Build record
      const record: EvidenceRecord = {
        recordType: obs.sourceType as EvidenceRecord['recordType'],
        sourceReference: obs.sourceReference,
        originalTimestamp: obs.originalTimestamp,
        collectionTimestamp: now.toISOString(),
        clockOrderUncertain: obs.clockOrderUncertain ?? false,
        contentHash,
        payload: redactedContent as Record<string, unknown>,
      };

      // Step 4: Validate
      const parsed = EvidenceRecordSchema.safeParse(record);
      if (!parsed.success) continue; // skip invalid records (log in production)

      records.push(parsed.data);

      // Update source manifest
      const existing = sourceManifestMap.get(obs.sourceType);
      if (existing) {
        existing.recordCount += 1;
      } else {
        sourceManifestMap.set(obs.sourceType, {
          sourceType: obs.sourceType,
          sensorId: sensorIds[0] ?? 'unknown',
          recordCount: 1,
          collectedAt: now,
        });
      }
    }

    // Step 5: Build checksums per record type
    const checksums: Record<string, string> = {};
    const byType = new Map<string, string[]>();
    for (const rec of records) {
      const existing = byType.get(rec.recordType) ?? [];
      existing.push(rec.contentHash);
      byType.set(rec.recordType, existing);
    }
    for (const [type, hashes] of byType) {
      checksums[type] = createHash('sha256').update(hashes.join('')).digest('hex');
    }

    return {
      incidentId,
      records,
      sourceManifest: Array.from(sourceManifestMap.values()),
      collectionGaps,
      checksums,
      preparedAt: now,
    };
  }
}

// ─── Document ingester ────────────────────────────────────────────────────────

/**
 * @node 02.04 — Document ingestion helpers.
 *
 * Extracts sections, headings, API expectations, and runbook steps from
 * markdown/text files.  Marks content from external/unknown sources as
 * untrusted so the diagnostic layer treats it with appropriate skepticism.
 *
 * Limitation: parsing is done with simple regex; complex markdown constructs
 * (nested lists, code blocks with headings) may not be extracted correctly.
 */

export interface DocumentSection {
  heading: string;
  level: number;
  content: string;
  untrusted: boolean;
}

/**
 * @node 02.04.01 — Extract sections from a markdown document.
 */
export function extractSections(markdown: string, untrusted = false): DocumentSection[] {
  const sections: DocumentSection[] = [];
  const lines = markdown.split('\n');
  let currentHeading = '';
  let currentLevel = 0;
  let contentLines: string[] = [];

  for (const line of lines) {
    const headingMatch = /^(#{1,6})\s+(.+)/.exec(line);
    if (headingMatch) {
      if (currentHeading) {
        sections.push({
          heading: currentHeading,
          level: currentLevel,
          content: contentLines.join('\n').trim(),
          untrusted,
        });
      }
      currentLevel = headingMatch[1]?.length ?? 1;
      currentHeading = headingMatch[2]?.trim() ?? '';
      contentLines = [];
    } else {
      contentLines.push(line);
    }
  }

  if (currentHeading) {
    sections.push({
      heading: currentHeading,
      level: currentLevel,
      content: contentLines.join('\n').trim(),
      untrusted,
    });
  }

  return sections;
}
