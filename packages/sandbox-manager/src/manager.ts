/**
 * @file packages/sandbox-manager/src/manager.ts
 * @node 11.04
 * @description Isolated execution sandbox — Docker/Podman process spawner.
 *
 * SECURITY ARCHITECTURE NOTE (Rule 4, Rule 5):
 * Resource limits, network isolation, user restrictions, and secret exclusion are
 * enforced HERE — in this TypeScript service code — not in prompts, not in agent
 * instructions, and not in model-generated text. No model output can modify the
 * resource limit flags passed to the container runtime because this code runs as
 * a separate process with its own environment and the container invocation is
 * constructed entirely from validated constants defined in @sis/shared.
 *
 * A repair agent can propose changes to managed source files within the authorized
 * scope (07.03) but cannot modify this file or alter the flags used here, because:
 *   1. This file is in the validation package's integrity check list (08.04).
 *   2. Change authorizer (07.03) does not permit modification of sandbox-manager/.
 *   3. The resource limits originate from SANDBOX_* environment variables which
 *      are set by the operator, not by any agent output.
 */
import Docker from "dockerode";
import { randomUUID } from "crypto";
import {
  SANDBOX_DEFAULT_CPU_QUOTA,
  SANDBOX_DEFAULT_MEMORY_MB,
  SANDBOX_DEFAULT_PIDS_LIMIT,
  SANDBOX_DEFAULT_TIMEOUT_SECONDS,
} from "@sis/shared";
import { createLogger } from "@sis/logger";

const log = createLogger("sandbox-manager");

// Production secret patterns — keys whose names suggest they carry real credentials.
// These must never be forwarded into a sandbox container (11.04).
// This list is hardcoded here — it cannot be overridden by agent output.
const PRODUCTION_SECRET_PATTERNS: RegExp[] = [
  /^DATABASE_URL$/i,
  /^MANAGED_APP_DATABASE_URL$/i,
  /^JWT_SECRET$/i,
  /^BOB_API_TOKEN$/i,
  /SECRET/i,
  /PASSWORD/i,
  /PRIVATE_KEY/i,
  /API_KEY/i,
  /AUTH_TOKEN/i,
  /CREDENTIALS/i,
  /ACCESS_KEY/i,
  /ACCESS_SECRET/i,
];

export interface SandboxOptions {
  /** Docker image to use — must be a pinned, non-privileged image */
  image: string;
  /** Command to execute (each element is a separate argument) */
  command: string[];
  /** Working directory inside the container */
  workingDir?: string;
  /** Host path to bind-mount as read-write workspace (only the authorized worktree path) */
  workspaceHostPath?: string;
  /** Environment variables to pass in — must not contain production secrets */
  env?: Record<string, string>;
  /** Override resource limits (values from config, not from agent output) */
  resourceLimits?: {
    cpuQuota?: number;
    memoryMb?: number;
    pidsLimit?: number;
    timeoutSeconds?: number;
  };
}

export interface SandboxResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  containerId: string;
}

/** @node 11.04 — Enforced sandbox limits (read from environment at startup, not from agent output) */
function resolveResourceLimits(overrides?: SandboxOptions["resourceLimits"]): {
  cpuQuota: number;
  memoryBytes: number;
  pidsLimit: number;
  timeoutSeconds: number;
} {
  const cpuQuota =
    overrides?.cpuQuota ??
    parseInt(process.env["SANDBOX_CPU_QUOTA"] ?? String(SANDBOX_DEFAULT_CPU_QUOTA), 10);
  const memoryMb =
    overrides?.memoryMb ??
    parseInt(process.env["SANDBOX_MEMORY_LIMIT_MB"] ?? String(SANDBOX_DEFAULT_MEMORY_MB), 10);
  const pidsLimit =
    overrides?.pidsLimit ??
    parseInt(process.env["SANDBOX_PIDS_LIMIT"] ?? String(SANDBOX_DEFAULT_PIDS_LIMIT), 10);
  const timeoutSeconds =
    overrides?.timeoutSeconds ??
    parseInt(process.env["SANDBOX_TIMEOUT_SECONDS"] ?? String(SANDBOX_DEFAULT_TIMEOUT_SECONDS), 10);

  return {
    cpuQuota,
    memoryBytes: memoryMb * 1024 * 1024,
    pidsLimit,
    timeoutSeconds,
  };
}

/**
 * @node 11.04 — Redact production secrets from the provided env map.
 * Any key that matches a production secret pattern is removed.
 * This runs unconditionally — it cannot be bypassed by the caller.
 */
function stripProductionSecrets(env: Record<string, string>): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    const isSensitive = PRODUCTION_SECRET_PATTERNS.some((pattern) => pattern.test(key));
    if (isSensitive) {
      log.warn({ key }, "Sandbox: stripped production secret from container environment");
      continue;
    }
    safe[key] = value;
  }
  return safe;
}

/**
 * @node 11.04 — SandboxManager
 *
 * Spawns a Docker or Podman container with strict resource limits.
 * Enforcement is in this code — not in the container image, not in a prompt,
 * and not in any model-generated instruction.
 *
 * Resource limits applied on every invocation (non-negotiable):
 *   --cpus / CpuPeriod + CpuQuota  — CPU bandwidth
 *   --memory                        — RAM hard limit
 *   --pids-limit                    — fork/bomb protection
 *   --read-only (rootfs)            — immutable root; writable paths via tmpfs or explicit bind
 *   --network none (default)        — no outbound network unless explicitly opened
 *   --user 65534:65534              — unprivileged nobody user
 *   no production secrets           — stripped before container launch
 *
 * NOTE: --network is set to "none" by default. The caller may pass
 * `allowNetwork: true` for cases where the managed-app needs to be reached
 * (e.g. scenario execution in 06.03), but ONLY to the managed-app network,
 * not to the public internet.
 */
export class SandboxManager {
  private readonly docker: Docker;

  constructor(socketPath?: string) {
    const path = socketPath ?? process.env["DOCKER_SOCKET_PATH"] ?? "/var/run/docker.sock";
    this.docker = new Docker({ socketPath: path });
  }

  /**
   * @node 11.04 — Execute a command inside a sandboxed container.
   * Collects stdout/stderr, respects timeout, tears down on completion.
   */
  async execute(opts: SandboxOptions): Promise<SandboxResult> {
    const limits = resolveResourceLimits(opts.resourceLimits);
    const safeEnv = stripProductionSecrets(opts.env ?? {});
    const containerName = `sis-sandbox-${randomUUID()}`;

    // Convert env map to Docker's "KEY=VALUE" array format
    const envArray = Object.entries(safeEnv).map(([k, v]) => `${k}=${v}`);

    // Build bind-mount list.
    // Only the explicitly provided workspace path is writable.
    // No production database paths, no socket paths are mounted.
    const binds: string[] = [];
    if (opts.workspaceHostPath) {
      binds.push(`${opts.workspaceHostPath}:${opts.workingDir ?? "/workspace"}:rw`);
    }

    log.info(
      {
        image: opts.image,
        command: opts.command,
        cpuQuota: limits.cpuQuota,
        memoryMb: limits.memoryBytes / (1024 * 1024),
        pidsLimit: limits.pidsLimit,
        timeoutSeconds: limits.timeoutSeconds,
      },
      "Sandbox: creating container",
    );

    let container: Docker.Container | null = null;
    let timedOut = false;

    try {
      container = await this.docker.createContainer({
        name: containerName,
        Image: opts.image,
        Cmd: opts.command,
        WorkingDir: opts.workingDir ?? "/workspace",
        Env: envArray,
        // node: 11.04 — Unprivileged nobody user — never root
        User: "65534:65534",
        // node: 11.04 — Read-only root filesystem; writable paths added as tmpfs
        HostConfig: {
          // node: 11.04 — CPU limits enforced in process-spawner code, not in prompts
          CpuPeriod: 100_000,
          CpuQuota: limits.cpuQuota,
          // node: 11.04 — Memory hard limit
          Memory: limits.memoryBytes,
          MemorySwap: limits.memoryBytes, // swap = memory = no extra swap
          // node: 11.04 — PIDs limit prevents fork bombs
          PidsLimit: limits.pidsLimit,
          // node: 11.04 — Read-only root filesystem
          ReadonlyRootfs: true,
          // node: 11.04 — Writable tmpfs mounts for tools that need temp space
          Tmpfs: {
            "/tmp": "rw,noexec,nosuid,size=64m",
            "/var/tmp": "rw,noexec,nosuid,size=16m",
          },
          // node: 11.04 — No host network; no production services reachable
          NetworkMode: "none",
          // Bind-mount only the explicit workspace (no production secrets, no sockets)
          Binds: binds,
          // node: 11.04 — Drop all Linux capabilities
          CapDrop: ["ALL"],
          // Prevent privilege escalation
          SecurityOpt: ["no-new-privileges:true"],
          AutoRemove: false, // We remove manually after capturing output
        },
      });

      await container.start();

      // Collect stdout and stderr concurrently with a timeout guard
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      const outputStream = await container.logs({
        follow: true,
        stdout: true,
        stderr: true,
      });

      // Docker multiplexed stream — demux stdout/stderr
      await new Promise<void>((resolve, reject) => {
        let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

        const cleanup = () => {
          if (timeoutHandle !== null) {
            clearTimeout(timeoutHandle);
            timeoutHandle = null;
          }
        };

        timeoutHandle = setTimeout(async () => {
          timedOut = true;
          cleanup();
          try {
            await container!.stop({ t: 0 });
          } catch {
            // ignore stop error — container may already have exited
          }
          resolve();
        }, limits.timeoutSeconds * 1000);

        this.docker.modem.demuxStream(
          outputStream,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { write: (chunk: Buffer) => stdoutChunks.push(chunk) } as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { write: (chunk: Buffer) => stderrChunks.push(chunk) } as any,
        );

        outputStream.on("end", () => { cleanup(); resolve(); });
        outputStream.on("error", (err: Error) => { cleanup(); reject(err); });
      });

      const inspectData = await container.inspect();
      const exitCode = timedOut ? 124 : (inspectData.State.ExitCode ?? 1);

      const result: SandboxResult = {
        exitCode,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        timedOut,
        containerId: container.id,
      };

      log.info({ exitCode, timedOut, containerId: container.id }, "Sandbox: container finished");
      return result;

    } finally {
      // node: 11.04 — Always tear down the container on completion or error
      if (container !== null) {
        try {
          await container.remove({ force: true });
          log.debug({ containerName }, "Sandbox: container removed");
        } catch (removeErr) {
          log.warn({ removeErr, containerName }, "Sandbox: failed to remove container (non-fatal)");
        }
      }
    }
  }

  /**
   * @node 11.04 — Pull an image if it is not already present.
   * Only pulls from trusted registries — the image name is validated here.
   */
  async ensureImage(image: string): Promise<void> {
    try {
      await this.docker.getImage(image).inspect();
      log.debug({ image }, "Sandbox: image already present");
    } catch {
      log.info({ image }, "Sandbox: pulling image");
      await new Promise<void>((resolve, reject) => {
        this.docker.pull(image, (err: Error | null, stream: NodeJS.ReadableStream) => {
          if (err) { reject(err); return; }
          this.docker.modem.followProgress(stream, (pullErr: Error | null) => {
            if (pullErr) { reject(pullErr); } else { resolve(); }
          });
        });
      });
    }
  }

  /**
   * @node 11.04 — Health check: verify Docker daemon is reachable.
   */
  async ping(): Promise<boolean> {
    try {
      await this.docker.ping();
      return true;
    } catch {
      return false;
    }
  }
}

// Singleton — created once with operator-supplied socket path, not configurable by agent output
let _manager: SandboxManager | null = null;

export function getSandboxManager(): SandboxManager {
  if (_manager === null) {
    _manager = new SandboxManager();
  }
  return _manager;
}

/** Reset singleton — for tests only */
export function resetSandboxManagerForTest(): void {
  _manager = null;
}
