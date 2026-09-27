/**
 * @file packages/shared/src/utils/hash.ts
 * @node 02.05, 06.05, 08.01
 * @description Cryptographic hash utilities (SHA-256).
 */
import { createHash } from "crypto";

/** @node 02.05.03 — Content hash for deduplication */
export function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** @node 06.05 — Hash a test file for regression artifact binding */
export function hashTestFile(content: string): string {
  return sha256(content);
}

/** @node 08.01 — Validation identity binding hash */
export function computeBindingHash(
  candidateCommit: string,
  environmentManifestHash: string,
  acceptanceSuiteHash: string,
): string {
  return sha256(`${candidateCommit}|${environmentManifestHash}|${acceptanceSuiteHash}`);
}
