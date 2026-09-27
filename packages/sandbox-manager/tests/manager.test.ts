/**
 * @file packages/sandbox-manager/tests/manager.test.ts
 * @node 11.04
 * @description Unit tests for SandboxManager.
 *
 * These tests verify:
 *   1. Resource limit flags are always included in container creation
 *   2. Production secrets are stripped before container launch
 *   3. The container is always run as an unprivileged user
 *   4. The root filesystem is always read-only
 *   5. Network is disabled by default
 *   6. Production secret stripping is not bypassable by the caller
 *
 * Tests mock the dockerode client so no live Docker daemon is required.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// We need to test the internals without a live Docker daemon.
// We import the private helpers by re-exporting them in a test-only manner
// via module-level extraction. Since they are not exported from manager.ts,
// we test them indirectly through the observable effects on createContainer calls.
// ---------------------------------------------------------------------------

// Mock dockerode before importing manager
vi.mock("dockerode", () => {
  const mockContainer = {
    id: "mock-container-id",
    start: vi.fn().mockResolvedValue(undefined),
    logs: vi.fn().mockResolvedValue({
      on: vi.fn((event: string, handler: () => void) => {
        if (event === "end") setImmediate(handler);
        return { on: vi.fn() };
      }),
    }),
    inspect: vi.fn().mockResolvedValue({ State: { ExitCode: 0 } }),
    stop: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  };

  const MockDocker = vi.fn().mockImplementation(() => ({
    createContainer: vi.fn().mockResolvedValue(mockContainer),
    modem: {
      demuxStream: vi.fn(),
      followProgress: vi.fn((stream: unknown, cb: (err: null) => void) => cb(null)),
    },
    ping: vi.fn().mockResolvedValue("OK"),
    pull: vi.fn((image: string, cb: (err: null, stream: unknown) => void) => {
      cb(null, { on: vi.fn() });
    }),
    getImage: vi.fn().mockReturnValue({
      inspect: vi.fn().mockResolvedValue({}),
    }),
  }));

  return { default: MockDocker };
});

import Docker from "dockerode";
import { SandboxManager, resetSandboxManagerForTest } from "../src/manager.js";

describe("11.04 — SandboxManager", () => {
  let dockerInstance: ReturnType<typeof Docker>;
  let manager: SandboxManager;

  beforeEach(async () => {
    resetSandboxManagerForTest();
    vi.clearAllMocks();
    manager = new SandboxManager("/var/run/docker.sock");
    // Get the mocked docker instance
    dockerInstance = (Docker as unknown as ReturnType<typeof vi.fn>).mock.results[
      (Docker as unknown as ReturnType<typeof vi.fn>).mock.results.length - 1
    ].value as ReturnType<typeof Docker>;
  });

  // ── Resource limit enforcement (11.04) ──────────────────────────────────

  describe("Resource limits", () => {
    it("always sets CpuPeriod and CpuQuota", async () => {
      await manager.execute({
        image: "node:20-alpine",
        command: ["echo", "hello"],
      }).catch(() => {/* ignore stream errors in unit test */});

      const createContainerCall = (dockerInstance.createContainer as ReturnType<typeof vi.fn>).mock.calls[0];
      const config = createContainerCall?.[0] as { HostConfig: { CpuPeriod: number; CpuQuota: number } };
      expect(config.HostConfig.CpuPeriod).toBe(100_000);
      expect(config.HostConfig.CpuQuota).toBeGreaterThan(0);
    });

    it("always sets a Memory hard limit", async () => {
      await manager.execute({
        image: "node:20-alpine",
        command: ["echo", "hello"],
      }).catch(() => {});

      const createContainerCall = (dockerInstance.createContainer as ReturnType<typeof vi.fn>).mock.calls[0];
      const config = createContainerCall?.[0] as { HostConfig: { Memory: number } };
      expect(config.HostConfig.Memory).toBeGreaterThan(0);
    });

    it("always sets a PidsLimit", async () => {
      await manager.execute({
        image: "node:20-alpine",
        command: ["echo", "hello"],
      }).catch(() => {});

      const createContainerCall = (dockerInstance.createContainer as ReturnType<typeof vi.fn>).mock.calls[0];
      const config = createContainerCall?.[0] as { HostConfig: { PidsLimit: number } };
      expect(config.HostConfig.PidsLimit).toBeGreaterThan(0);
    });

    it("always sets MemorySwap equal to Memory (no extra swap)", async () => {
      await manager.execute({
        image: "node:20-alpine",
        command: ["echo", "hello"],
      }).catch(() => {});

      const createContainerCall = (dockerInstance.createContainer as ReturnType<typeof vi.fn>).mock.calls[0];
      const config = createContainerCall?.[0] as { HostConfig: { Memory: number; MemorySwap: number } };
      expect(config.HostConfig.MemorySwap).toBe(config.HostConfig.Memory);
    });
  });

  // ── Isolation enforcement (11.04) ───────────────────────────────────────

  describe("Container isolation", () => {
    it("always runs as unprivileged user (65534:65534)", async () => {
      await manager.execute({
        image: "node:20-alpine",
        command: ["echo", "hello"],
      }).catch(() => {});

      const createContainerCall = (dockerInstance.createContainer as ReturnType<typeof vi.fn>).mock.calls[0];
      const config = createContainerCall?.[0] as { User: string };
      expect(config.User).toBe("65534:65534");
    });

    it("always sets ReadonlyRootfs to true", async () => {
      await manager.execute({
        image: "node:20-alpine",
        command: ["echo", "hello"],
      }).catch(() => {});

      const createContainerCall = (dockerInstance.createContainer as ReturnType<typeof vi.fn>).mock.calls[0];
      const config = createContainerCall?.[0] as { HostConfig: { ReadonlyRootfs: boolean } };
      expect(config.HostConfig.ReadonlyRootfs).toBe(true);
    });

    it("uses network mode 'none' by default", async () => {
      await manager.execute({
        image: "node:20-alpine",
        command: ["echo", "hello"],
      }).catch(() => {});

      const createContainerCall = (dockerInstance.createContainer as ReturnType<typeof vi.fn>).mock.calls[0];
      const config = createContainerCall?.[0] as { HostConfig: { NetworkMode: string } };
      expect(config.HostConfig.NetworkMode).toBe("none");
    });

    it("drops ALL Linux capabilities", async () => {
      await manager.execute({
        image: "node:20-alpine",
        command: ["echo", "hello"],
      }).catch(() => {});

      const createContainerCall = (dockerInstance.createContainer as ReturnType<typeof vi.fn>).mock.calls[0];
      const config = createContainerCall?.[0] as { HostConfig: { CapDrop: string[] } };
      expect(config.HostConfig.CapDrop).toContain("ALL");
    });

    it("sets no-new-privileges security option", async () => {
      await manager.execute({
        image: "node:20-alpine",
        command: ["echo", "hello"],
      }).catch(() => {});

      const createContainerCall = (dockerInstance.createContainer as ReturnType<typeof vi.fn>).mock.calls[0];
      const config = createContainerCall?.[0] as { HostConfig: { SecurityOpt: string[] } };
      expect(config.HostConfig.SecurityOpt).toContain("no-new-privileges:true");
    });

    it("provides /tmp as tmpfs (tools need temp space)", async () => {
      await manager.execute({
        image: "node:20-alpine",
        command: ["echo", "hello"],
      }).catch(() => {});

      const createContainerCall = (dockerInstance.createContainer as ReturnType<typeof vi.fn>).mock.calls[0];
      const config = createContainerCall?.[0] as { HostConfig: { Tmpfs: Record<string, string> } };
      expect(config.HostConfig.Tmpfs).toHaveProperty("/tmp");
    });
  });

  // ── Production secret stripping (11.04) ─────────────────────────────────

  describe("Production secret stripping", () => {
    it("removes DATABASE_URL from container environment", async () => {
      await manager.execute({
        image: "node:20-alpine",
        command: ["echo", "hello"],
        env: {
          DATABASE_URL: "postgresql://secret@localhost:5432/prod",
          NODE_ENV: "test",
        },
      }).catch(() => {});

      const createContainerCall = (dockerInstance.createContainer as ReturnType<typeof vi.fn>).mock.calls[0];
      const config = createContainerCall?.[0] as { Env: string[] };
      const hasDbUrl = config.Env.some((e: string) => e.startsWith("DATABASE_URL="));
      expect(hasDbUrl).toBe(false);
    });

    it("removes JWT_SECRET from container environment", async () => {
      await manager.execute({
        image: "node:20-alpine",
        command: ["echo", "hello"],
        env: {
          JWT_SECRET: "super-secret-jwt-key",
          NODE_ENV: "test",
        },
      }).catch(() => {});

      const createContainerCall = (dockerInstance.createContainer as ReturnType<typeof vi.fn>).mock.calls[0];
      const config = createContainerCall?.[0] as { Env: string[] };
      const hasJwt = config.Env.some((e: string) => e.startsWith("JWT_SECRET="));
      expect(hasJwt).toBe(false);
    });

    it("removes BOB_API_TOKEN from container environment", async () => {
      await manager.execute({
        image: "node:20-alpine",
        command: ["echo", "hello"],
        env: {
          BOB_API_TOKEN: "test-token-not-real",
          NODE_ENV: "test",
        },
      }).catch(() => {});

      const createContainerCall = (dockerInstance.createContainer as ReturnType<typeof vi.fn>).mock.calls[0];
      const config = createContainerCall?.[0] as { Env: string[] };
      const hasToken = config.Env.some((e: string) => e.startsWith("BOB_API_TOKEN="));
      expect(hasToken).toBe(false);
    });

    it("removes any key containing 'PASSWORD' (case-insensitive)", async () => {
      await manager.execute({
        image: "node:20-alpine",
        command: ["echo", "hello"],
        env: {
          REDIS_PASSWORD: "secret",
          APP_PASSWORD: "also-secret",
          NODE_ENV: "test",
        },
      }).catch(() => {});

      const createContainerCall = (dockerInstance.createContainer as ReturnType<typeof vi.fn>).mock.calls[0];
      const config = createContainerCall?.[0] as { Env: string[] };
      const hasPassword = config.Env.some((e: string) =>
        e.toLowerCase().includes("password"),
      );
      expect(hasPassword).toBe(false);
    });

    it("passes through non-sensitive environment variables", async () => {
      await manager.execute({
        image: "node:20-alpine",
        command: ["echo", "hello"],
        env: {
          NODE_ENV: "test",
          FAULT_INJECTION_ENABLED: "true",
          LOG_LEVEL: "info",
        },
      }).catch(() => {});

      const createContainerCall = (dockerInstance.createContainer as ReturnType<typeof vi.fn>).mock.calls[0];
      const config = createContainerCall?.[0] as { Env: string[] };
      expect(config.Env).toContain("NODE_ENV=test");
      expect(config.Env).toContain("FAULT_INJECTION_ENABLED=true");
      expect(config.Env).toContain("LOG_LEVEL=info");
    });

    it("strips secrets even when the caller provides them (cannot be bypassed)", async () => {
      // Caller attempts to pass DATABASE_URL — it must be stripped regardless
      await manager.execute({
        image: "node:20-alpine",
        command: ["env"],
        env: {
          DATABASE_URL: "postgresql://real@prod:5432/db",
          MANAGED_APP_DATABASE_URL: "postgresql://real@prod:5432/managed",
          MY_CUSTOM_SECRET: "custom-secret-value",
        },
      }).catch(() => {});

      const createContainerCall = (dockerInstance.createContainer as ReturnType<typeof vi.fn>).mock.calls[0];
      const config = createContainerCall?.[0] as { Env: string[] };
      const env = config.Env as string[];

      expect(env.some((e) => e.startsWith("DATABASE_URL="))).toBe(false);
      expect(env.some((e) => e.startsWith("MANAGED_APP_DATABASE_URL="))).toBe(false);
      // MY_CUSTOM_SECRET: not in pattern list → passes through
      // (no pattern matches "CUSTOM_SECRET" unless it contains SECRET)
      // Actually MY_CUSTOM_SECRET contains "SECRET" — should be stripped
      expect(env.some((e) => e.startsWith("MY_CUSTOM_SECRET="))).toBe(false);
    });
  });

  // ── Resource limit override (from config, not from agent output) ────────

  describe("Resource limit overrides", () => {
    it("respects custom CPU quota passed by operator config", async () => {
      await manager.execute({
        image: "node:20-alpine",
        command: ["echo", "hello"],
        resourceLimits: { cpuQuota: 25_000 },
      }).catch(() => {});

      const createContainerCall = (dockerInstance.createContainer as ReturnType<typeof vi.fn>).mock.calls[0];
      const config = createContainerCall?.[0] as { HostConfig: { CpuQuota: number } };
      expect(config.HostConfig.CpuQuota).toBe(25_000);
    });

    it("respects custom memory limit passed by operator config", async () => {
      await manager.execute({
        image: "node:20-alpine",
        command: ["echo", "hello"],
        resourceLimits: { memoryMb: 256 },
      }).catch(() => {});

      const createContainerCall = (dockerInstance.createContainer as ReturnType<typeof vi.fn>).mock.calls[0];
      const config = createContainerCall?.[0] as { HostConfig: { Memory: number } };
      expect(config.HostConfig.Memory).toBe(256 * 1024 * 1024);
    });
  });

  // ── Health check ────────────────────────────────────────────────────────

  describe("ping()", () => {
    it("returns true when Docker daemon responds", async () => {
      const result = await manager.ping();
      expect(result).toBe(true);
    });

    it("returns false when Docker daemon is unreachable", async () => {
      (dockerInstance.ping as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("connection refused"),
      );
      const result = await manager.ping();
      expect(result).toBe(false);
    });
  });
});
