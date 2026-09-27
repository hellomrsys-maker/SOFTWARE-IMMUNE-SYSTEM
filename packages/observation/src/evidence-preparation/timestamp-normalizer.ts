/**
 * @node 02.05.04 — Timestamp Normalizer
 *
 * Rule 10: every evidence record must carry:
 *   - originalTimestamp: the timestamp as reported by the source
 *   - collectionTimestamp: the time SIS collected the evidence
 *   - clockOrderUncertain: true when we cannot guarantee originalTimestamp < collectionTimestamp
 */

import type { TimestampedEvidence } from './types.js';

/**
 * @node 02.05.04 — Normalize timestamps for an evidence record.
 *
 * @param originalTimestamp  ISO 8601 string from the source, or null if unavailable.
 * @param maxClockSkewMs     Threshold for flagging uncertain clock order (default 10 s).
 */
export function normalizeTimestamps(
  originalTimestamp: string | null,
  maxClockSkewMs = 10_000,
): TimestampedEvidence {
  const collectionTimestamp = new Date().toISOString();
  let clockOrderUncertain = false;

  if (originalTimestamp) {
    const origMs = new Date(originalTimestamp).getTime();
    const collMs = new Date(collectionTimestamp).getTime();

    // Uncertain if original is in the future (beyond skew threshold) or
    // suspiciously far in the past
    if (origMs > collMs + maxClockSkewMs) {
      clockOrderUncertain = true;
    }
  } else {
    // No original timestamp — order is inherently uncertain
    clockOrderUncertain = true;
  }

  return { originalTimestamp, collectionTimestamp, clockOrderUncertain };
}
