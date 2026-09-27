/**
 * @file packages/shared/src/constants.ts
 * @node 00, 03.02
 * @description System-wide constants.
 */

// node: 00.04 — Explicit exclusions
export const SYSTEM_VERSION = "0.0.1";
export const SUPPORTED_ENVIRONMENTS = ["typescript_nodejs"] as const;

// node: 11.06 — Reliability
export const WORKER_MAX_RETRY_BACKOFF_MS = 30_000;
export const WORKER_BASE_RETRY_BACKOFF_MS = 1_000;

// node: 03.01 — Durable queue
export const QUEUE_MAX_RETRIES = 5;
export const QUEUE_CLAIM_LEASE_SECONDS = 300;
export const QUEUE_ADMISSION_LIMIT = 1000;

// node: 08.06 — Validation
export const MAX_REPAIR_RETRY_CYCLES = 3;

// node: 11.04 — Sandbox resource limits defaults
export const SANDBOX_DEFAULT_CPU_QUOTA = 50_000;
export const SANDBOX_DEFAULT_MEMORY_MB = 512;
export const SANDBOX_DEFAULT_PIDS_LIMIT = 64;
export const SANDBOX_DEFAULT_TIMEOUT_SECONDS = 120;

// node: 03.04 — Approved command list (hardcoded — not overridable by runtime input)
export const APPROVED_COMMANDS = [
  "pnpm install",
  "pnpm run build",
  "pnpm run test",
  "pnpm run typecheck",
  "tsc --noEmit",
  "git log",
  "git diff",
  "git status",
  "git worktree add",
  "git worktree remove",
  "git apply",
] as const;
export type ApprovedCommand = (typeof APPROVED_COMMANDS)[number];
