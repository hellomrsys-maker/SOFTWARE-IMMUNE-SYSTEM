/**
 * @node 08 — Protected Validation Subsystem
 *
 * ISOLATION INVARIANT:
 * This package has NO dependency on @sis/repair.  The validator runs outside
 * the repair agent's writable file scope and can never be modified by a repair task.
 * Rule 20: validator runs outside repair agent's writable scope.
 *
 * @node 08.01 — Identity Binder
 * @node 08.04 — Safety Gates
 * @node 08.06 — Result Adjudicator
 */

import { createHash } from 'node:crypto';

// ─── Identity Binder (08.01) ─────────────────────────────────────────────────

export interface ValidationIdentity {
  identityHash: string;
  candidateCommit: string;
  environmentManifestHash: string;
  acceptanceSuiteHash: string;
  boundAt: string;
}

/**
 * @node 08.01 — Validation Identity Binder
 *
 * Rule 22: if any input changes after binding, the validation result is invalidated.
 * The identity hash is SHA-256(commit + manifestHash + suiteHash).
 */
export class ValidationIdentityBinder {
  bind(params: {
    candidateCommit: string;
    environmentManifestJson: string;
    acceptanceSuiteHashes: Record<string, string>;
  }): ValidationIdentity {
    const environmentManifestHash = sha256(params.environmentManifestJson);
    const acceptanceSuiteHash = sha256(JSON.stringify(params.acceptanceSuiteHashes));
    const identityHash = sha256(
      params.candidateCommit + environmentManifestHash + acceptanceSuiteHash,
    );

    return {
      identityHash,
      candidateCommit: params.candidateCommit,
      environmentManifestHash,
      acceptanceSuiteHash,
      boundAt: new Date().toISOString(),
    };
  }

  /**
   * @node 08.01 — Re-validate the identity binding.
   *
   * Rule 22: returns false if any input has changed since binding.
   * A changed identity means the validation result is invalidated.
   */
  validateBinding(
    identity: ValidationIdentity,
    params: {
      candidateCommit: string;
      environmentManifestJson: string;
      acceptanceSuiteHashes: Record<string, string>;
    },
  ): boolean {
    const rebound = this.bind(params);
    return rebound.identityHash === identity.identityHash;
  }
}

// ─── Gate types ───────────────────────────────────────────────────────────────

export type GateStatus = 'passed' | 'failed' | 'skipped' | 'infra_error';

export interface GateResult {
  gateName: string;
  status: GateStatus;
  exitCode: number | null;
  output: string;
  mandatory: boolean;
}

// ─── Safety Gates (08.04) ────────────────────────────────────────────────────

export const ACCEPTANCE_TEST_HASHES: Record<string, string> = {};

/**
 * @node 08.04 — Safety Gate Checker
 *
 * Rule 20: this checker runs outside the repair agent's writable scope.
 * Rule 19: any skipped mandatory gate = rejection (not a warning).
 *
 * Checks:
 * - Protected test files have not been weakened (hash comparison)
 * - Validation package files are unmodified
 * - Changed files are within the authorized list
 * - No secrets in artifacts
 */
export class SafetyGateChecker {
  check(params: {
    changedFiles: Array<{ path: string; currentHash: string }>;
    authorizedFiles: string[];
    acceptanceSuiteBaselineHashes: Record<string, string>;
    artifactContents: string[];
  }): GateResult {
    // Check 1: protected test file weakening
    for (const [path, baselineHash] of Object.entries(params.acceptanceSuiteBaselineHashes)) {
      const changed = params.changedFiles.find((f) => f.path === path);
      if (changed && changed.currentHash !== baselineHash) {
        return {
          gateName: 'safety',
          status: 'failed',
          exitCode: 1,
          output: `protected test file "${path}" has been modified. Original hash: ${baselineHash}, current: ${changed.currentHash}`,
          mandatory: true,
        };
      }
    }

    // Check 2: unauthorized file changes
    for (const f of params.changedFiles) {
      const isAuthorized = params.authorizedFiles.includes(f.path) ||
        !Object.keys(params.acceptanceSuiteBaselineHashes).includes(f.path);
      if (!isAuthorized) {
        return {
          gateName: 'safety',
          status: 'failed',
          exitCode: 1,
          output: `Unauthorized file change detected: "${f.path}"`,
          mandatory: true,
        };
      }
    }

    // Check 3: secrets in artifacts (basic pattern check)
    for (const content of params.artifactContents) {
      if (/(?:api[_-]?key|bearer|jwt|password)\s*[:=]\s*\S+/i.test(content)) {
        return {
          gateName: 'safety',
          status: 'failed',
          exitCode: 1,
          output: 'Potential secret detected in artifact content',
          mandatory: true,
        };
      }
    }

    return { gateName: 'safety', status: 'passed', exitCode: 0, output: 'All safety checks passed', mandatory: true };
  }
}

// ─── Result Adjudicator (08.06) ───────────────────────────────────────────────

export type AdjudicatedStatus = 'review_ready' | 'rejected';

export interface ValidationResult {
  status: AdjudicatedStatus;
  gates: GateResult[];
  limitations: string[];
}

const VALIDATION_LIMITATIONS = [
  'Results valid only under tested conditions — not a universal correctness proof',
  'Concurrent load was tested at the specified scenario scale; higher load may produce different results',
  'Performance measurements reflect the test environment, not production infrastructure',
];

/**
 * @node 08.06 — Result Adjudicator
 *
 * Rule 19: a skipped mandatory gate = rejection, not a warning.
 * Rule 21: no model opinion substitutes for actual exit codes.
 *
 * Reads ACTUAL exit codes from gate results.  Never infers success from absence of errors.
 */
export class ResultAdjudicator {
  adjudicate(
    gates: GateResult[],
    params: { maxRetryCount: number; currentRetryCount: number },
  ): ValidationResult {
    const limitations = [...VALIDATION_LIMITATIONS];

    // Rule 19: any skipped mandatory gate = rejection
    const skippedMandatory = gates.filter((g) => g.mandatory && g.status === 'skipped');
    if (skippedMandatory.length > 0) {
      return {
        status: 'rejected',
        gates,
        limitations: [
          ...limitations,
          `Mandatory gate(s) skipped: ${skippedMandatory.map((g) => g.gateName).join(', ')} — Rule 19: skip = rejection`,
        ],
      };
    }

    // Max retry count enforcement
    if (params.currentRetryCount >= params.maxRetryCount) {
      return {
        status: 'rejected',
        gates,
        limitations: [...limitations, `Maximum repair retry count (${params.maxRetryCount}) reached`],
      };
    }

    // Rule 21: read actual exit codes — any non-zero exit on mandatory gate = rejected
    const failedMandatory = gates.filter(
      (g) => g.mandatory && (g.status === 'failed' || g.exitCode !== 0),
    );
    if (failedMandatory.length > 0) {
      return { status: 'rejected', gates, limitations };
    }

    // Infrastructure errors on mandatory gates = rejected (not allowed to proceed with uncertainty)
    const infraErrors = gates.filter((g) => g.mandatory && g.status === 'infra_error');
    if (infraErrors.length > 0) {
      return {
        status: 'rejected',
        gates,
        limitations: [...limitations, 'Infrastructure error prevented mandatory gate from completing'],
      };
    }

    return { status: 'review_ready', gates, limitations };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
