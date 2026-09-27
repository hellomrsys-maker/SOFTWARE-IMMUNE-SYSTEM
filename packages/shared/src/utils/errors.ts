/**
 * @file packages/shared/src/utils/errors.ts
 * @node 11.06
 * @description Typed error classes for explicit failure handling.
 * All async errors must be caught explicitly — no unhandled promise rejections.
 */

export class SisError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: unknown,
  ) {
    super(message);
    this.name = "SisError";
  }
}

/** @node 11.06 — Artifact write failure must stop the workflow */
export class ArtifactWriteError extends SisError {
  constructor(message: string, context?: unknown) {
    super(message, "ARTIFACT_WRITE_FAILED", context);
    this.name = "ArtifactWriteError";
  }
}

/** @node 11.06 — Database outage: worker must stop and wait */
export class DatabaseOutageError extends SisError {
  constructor(message: string, context?: unknown) {
    super(message, "DATABASE_OUTAGE", context);
    this.name = "DatabaseOutageError";
  }
}

/** @node 03.04 — Authorization denied */
export class AuthorizationDeniedError extends SisError {
  constructor(resource: string, action: string, reason: string) {
    super(`Authorization denied: ${action} on ${resource} — ${reason}`, "AUTH_DENIED", { resource, action, reason });
    this.name = "AuthorizationDeniedError";
  }
}

/** @node 08.06 — Validation gate skipped = rejection */
export class GateSkippedError extends SisError {
  constructor(gateName: string) {
    super(`Mandatory gate was skipped: ${gateName}`, "GATE_SKIPPED", { gateName });
    this.name = "GateSkippedError";
  }
}

/** @node 10.04 — Memory-only repair authorization denied */
export class MemoryOnlyRepairDeniedError extends SisError {
  constructor() {
    super(
      "Memory alone never authorizes repair — current evidence and validation required",
      "MEMORY_ONLY_REPAIR_DENIED",
    );
    this.name = "MemoryOnlyRepairDeniedError";
  }
}
