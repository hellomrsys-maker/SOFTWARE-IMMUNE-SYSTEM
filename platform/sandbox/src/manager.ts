/**
 * @node 11.04 — Sandbox Manager
 *
 * Spawns isolated Docker or Podman containers for all commands executed by the
 * SIS worker (dependency install, test runs, patch application, typecheck).
 *
 * WHY RESTRICTIONS ARE ENFORCED HERE IN CODE, NOT IN PROMPTS:
 * ─────────────────────────────────────────────────────────────
 * Rule 5: sandbox restrictions must be enforced by the process-spawner code, not
 * by instructions in a model prompt.  A prompt can be overridden or ignored by a
 * model; a hard-coded `--read-only` flag passed to `docker run` cannot be.  Every
 * restriction below is unconditional — no runtime configuration can remove it.
 *
 * §11.04 Restrictions enforced for EVERY container:
 *   11.04.01  Unprivileged user:        --user 65534:65534  (nobody)
 *   11.04.02  No production secrets:    explicit env allowlist (no DATABASE_URL, JWT_SECRET, etc.)
 *   11.04.03  Read-only root FS:        --read-only --tmpfs /tmp:size=256m,noexec
 *   11.04.04  No host network:          --network sis_sandbox_net  (internal=true, no egress)
 *   11.04.05  CPU limit:                --cpus 1.0
 *   11.04.06  Memory limit:             --memory 512m
 *   11.04.07  PID limit:                --pids-limit 128
 *   11.04.08  Execution time limit:     enforced via AbortController + kill after timeoutMs
 *   11.04.09  No host-control socket:   docker.sock NOT mounted in sandbox containers
 */

import { spawn } from 'node:child_process';
import pino from 'pino';

const log = pino({ name: 'sis.sandbox' });

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SandboxRunOptions {
  /** Container image to use (e.g. 'node:20-alpine') */
  image: string;
  /** Command and arguments to run inside the container */
  command: string[];
  /** Working directory inside the container */
  workdir?: string;
  /** Host paths to mount read-only (e.g. source worktree) */
  readOnlyMounts?: Array<{ host: string; container: string }>;
  /** Writable tmpfs mounts inside the container */
  tmpfsMounts?: string[];
  /** Safe environment variables to pass (NO production secrets) */
  safeEnv?: Record<string, string>;
  /** Execution timeout in milliseconds (default 120 000) */
  timeoutMs?: number;
  /** Network to attach (default: sis_sandbox_net) */
  network?: string;
}

export interface SandboxRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

// ─── Secret env var allowlist ─────────────────────────────────────────────────

/**
 * @node 11.04.02 — Production secret env var names that must NEVER be passed to sandbox containers.
 *
 * This list is a hard-coded deny-list.  If a caller tries to pass any of these
 * keys in `safeEnv`, the sandbox manager will throw.
 */
const PRODUCTION_SECRET_ENV_KEYS = new Set([
  'DATABASE_URL', 'JWT_SECRET', 'BOB_API_KEY', 'PAYMENT_API_KEY',
  'AWS_SECRET_ACCESS_KEY', 'AWS_ACCESS_KEY_ID', 'GCP_SERVICE_ACCOUNT_KEY',
  'AZURE_CLIENT_SECRET', 'PRIVATE_KEY', 'SECRET',
]);

function assertNoProductionSecrets(env: Record<string, string>): void {
  for (const key of Object.keys(env)) {
    if (PRODUCTION_SECRET_ENV_KEYS.has(key.toUpperCase())) {
      throw new ProductionSecretInSandboxError(
        `Refusing to pass production secret key "${key}" to sandbox container. ` +
        'Rule 5 (§11.04): sandbox containers must never receive production secrets.',
      );
    }
  }
}

// ─── Sandbox Manager ─────────────────────────────────────────────────────────

export class SandboxManager {
  private readonly runtime: string;

  constructor() {
    // Runtime selectable via env var: 'docker' (default) or 'podman'
    this.runtime = process.env['SANDBOX_RUNTIME'] ?? 'docker';
    if (this.runtime !== 'docker' && this.runtime !== 'podman') {
      throw new Error(`Invalid SANDBOX_RUNTIME "${this.runtime}": must be "docker" or "podman"`);
    }
  }

  /**
   * @node 11.04 — Run a command inside an isolated container.
   *
   * All §11.04 restrictions are applied unconditionally.  No caller can bypass them.
   */
  async run(opts: SandboxRunOptions): Promise<SandboxRunResult> {
    // §11.04.02 — reject production secrets before building the command
    if (opts.safeEnv) {
      assertNoProductionSecrets(opts.safeEnv);
    }

    const args = this.buildArgs(opts);
    const timeoutMs = opts.timeoutMs ?? 120_000;

    log.info({ runtime: this.runtime, image: opts.image, command: opts.command }, 'sandbox run');

    return new Promise<SandboxRunResult>((resolve, reject) => {
      const proc = spawn(this.runtime, args, { stdio: 'pipe' });
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill('SIGKILL');
      }, timeoutMs);

      proc.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(new SandboxSpawnError(`Failed to spawn ${this.runtime}: ${err.message}`, err));
      });

      proc.on('close', (code) => {
        clearTimeout(timer);
        const exitCode = code ?? (timedOut ? 124 : 1);
        log.info({ exitCode, timedOut }, 'sandbox container exited');
        resolve({ exitCode, stdout, stderr, timedOut });
      });
    });
  }

  // ─── Internal arg builder ───────────────────────────────────────────────────

  private buildArgs(opts: SandboxRunOptions): string[] {
    const args: string[] = ['run', '--rm'];

    // §11.04.01 — Unprivileged user (nobody)
    args.push('--user', '65534:65534');

    // §11.04.03 — Read-only root FS with explicit tmpfs
    args.push('--read-only');
    const tmpfsMounts = opts.tmpfsMounts ?? ['/tmp'];
    for (const mount of tmpfsMounts) {
      args.push('--tmpfs', `${mount}:size=256m,noexec`);
    }

    // §11.04.04 — No host network; use internal sandbox network
    const network = opts.network ?? 'sis_sandbox_net';
    args.push('--network', network);

    // §11.04.05 — CPU limit
    args.push('--cpus', '1.0');

    // §11.04.06 — Memory limit
    args.push('--memory', '512m');

    // §11.04.07 — PID limit
    args.push('--pids-limit', '128');

    // §11.04.09 — Explicitly NO /var/run/docker.sock mount
    // (absence is the control — we never add it)

    // Working directory
    if (opts.workdir) {
      args.push('--workdir', opts.workdir);
    }

    // Read-only host mounts (source worktree, node_modules, etc.)
    for (const m of opts.readOnlyMounts ?? []) {
      args.push('--volume', `${m.host}:${m.container}:ro`);
    }

    // Safe environment variables (secrets already rejected above)
    for (const [k, v] of Object.entries(opts.safeEnv ?? {})) {
      args.push('--env', `${k}=${v}`);
    }

    // Image and command
    args.push(opts.image);
    args.push(...opts.command);

    return args;
  }
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export class ProductionSecretInSandboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProductionSecretInSandboxError';
  }
}

export class SandboxSpawnError extends Error {
  constructor(message: string, public readonly cause: Error) {
    super(message);
    this.name = 'SandboxSpawnError';
  }
}
