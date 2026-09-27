/**
 * @node 02.05.03 — Deduplicator
 *
 * Removes duplicate evidence records from a bundle based on content hash.
 * Two records with the same contentHash are considered identical.
 */

import type { EvidenceRecord } from './types.js';

/**
 * @node 02.05.03 — Deduplicate evidence records by contentHash.
 *
 * Returns a new array with duplicate content hashes removed (first occurrence kept).
 */
export function deduplicateRecords(records: EvidenceRecord[]): EvidenceRecord[] {
  const seen = new Set<string>();
  return records.filter((r) => {
    if (seen.has(r.contentHash)) return false;
    seen.add(r.contentHash);
    return true;
  });
}
