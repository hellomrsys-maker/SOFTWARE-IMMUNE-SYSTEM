/**
 * @file packages/db/tests/reliability.test.ts
 * @node 11.06
 * @description Unit tests for reliability safeguards.
 *
 * Tests verify:
 *   1. Idempotent command wrapper returns cached result on duplicate call
 *   2. Idempotent command wrapper executes action exactly once
 *   3. Artifact write failure stops workflow (re-throws ArtifactWriteError)
 *   4. DB outage guard re-throws DatabaseOutageError after recovery polling
 *   5. withDatabaseOutageGuard retries after successful recovery
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ArtifactWriteError, DatabaseOutageError } from "@sis/shared";
import {
  handleArtifactWriteFailure,
  waitForDatabaseRecovery,
  withDatabaseOutageGuard,
} from "../src/reliability.js";

// Mock the query function so we don't need a real DB
vi.mock("../src/pool.js", () => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
  getPool: vi.fn(),
  closePool: vi.fn(),
  resetPoolForTest: vi.fn(),
}));

import { query } from "../src/pool.js";
import { executeIdempotent, writeCheckpoint, readLastCheckpoint } from "../src/reliability.js";

const mockQuery = query as ReturnType<typeof vi.fn>;

describe("11.06 — Reliability safeguards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Idempotent command wrapper ────────────────────────────────────────────

  describe("executeIdempotent()", () => {
    it("executes the action when no prior record exists", async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] })    // SELECT → no existing record
        .mockResolvedValueOnce({ rows: [] });   // INSERT → store result

      const action = vi.fn().mockResolvedValue({ value: 42 });
      const result = await executeIdempotent("cmd-1", "test-command", "incident-1", action);

      expect(action).toHaveBeenCalledOnce();
      expect(result).toEqual({ value: 42 });
    });

    it("returns cached result without re-executing when record exists", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: "existing-id",
          command_id: "cmd-2",
          incident_id: "incident-1",
          command_type: "test-command",
          result: { value: 99 },
          completed_at: new Date(),
          created_at: new Date(),
        }],
      });

      const action = vi.fn().mockResolvedValue({ value: 0 });
      const result = await executeIdempotent("cmd-2", "test-command", "incident-1", action);

      expect(action).not.toHaveBeenCalled();
      expect(result).toEqual({ value: 99 });
    });

    it("does not execute action a second time when called twice with same id", async () => {
      // First call: no record, executes, stores
      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const action = vi.fn().mockResolvedValue({ done: true });
      await executeIdempotent("cmd-3", "test-command", null, action);

      // Second call: record found, returns cached
      mockQuery.mockResolvedValueOnce({
        rows: [{
          command_id: "cmd-3",
          result: { done: true },
          completed_at: new Date(),
          created_at: new Date(),
        }],
      });

      const result2 = await executeIdempotent("cmd-3", "test-command", null, action);
      expect(action).toHaveBeenCalledOnce(); // still only once
      expect(result2).toEqual({ done: true });
    });
  });

  // ── Artifact write failure handler (11.06) ───────────────────────────────

  describe("handleArtifactWriteFailure()", () => {
    it("re-throws ArtifactWriteError to stop the workflow", () => {
      const err = new ArtifactWriteError("disk full", { path: "/artifacts" });
      expect(() => handleArtifactWriteFailure(err)).toThrow(ArtifactWriteError);
    });

    it("re-throws non-ArtifactWriteError errors too", () => {
      const err = new Error("unexpected");
      expect(() => handleArtifactWriteFailure(err)).toThrow("unexpected");
    });

    it("preserves the original error code", () => {
      const err = new ArtifactWriteError("write failed");
      let caught: unknown;
      try {
        handleArtifactWriteFailure(err);
      } catch (e) {
        caught = e;
      }
      expect((caught as ArtifactWriteError).code).toBe("ARTIFACT_WRITE_FAILED");
    });

    it("cannot be silenced — always throws", () => {
      const err = new ArtifactWriteError("test");
      // Even if the caller tries to ignore the return value, it throws
      let threw = false;
      try {
        handleArtifactWriteFailure(err);
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });
  });

  // ── Database outage handler (11.06) ──────────────────────────────────────

  describe("waitForDatabaseRecovery()", () => {
    it("resolves when database becomes available", async () => {
      const mockPool = {
        connect: vi
          .fn()
          .mockRejectedValueOnce(new Error("ECONNREFUSED"))
          .mockResolvedValueOnce({ release: vi.fn() }),
      } as unknown as import("pg").Pool;

      await expect(
        waitForDatabaseRecovery(mockPool, 30_000, 10), // 10ms poll for speed
      ).resolves.not.toThrow();

      expect(mockPool.connect).toHaveBeenCalledTimes(2);
    });

    it("throws DatabaseOutageError when max wait is exceeded", async () => {
      const mockPool = {
        connect: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
      } as unknown as import("pg").Pool;

      await expect(
        waitForDatabaseRecovery(mockPool, 50, 10), // very short max wait
      ).rejects.toThrow(DatabaseOutageError);
    });
  });

  describe("withDatabaseOutageGuard()", () => {
    it("returns action result when no outage occurs", async () => {
      const mockPool = {
        connect: vi.fn().mockResolvedValue({ release: vi.fn() }),
      } as unknown as import("pg").Pool;

      const action = vi.fn().mockResolvedValue("success");
      const result = await withDatabaseOutageGuard(mockPool, action);
      expect(result).toBe("success");
      expect(action).toHaveBeenCalledOnce();
    });

    it("waits for recovery and retries on DatabaseOutageError", async () => {
      const mockPool = {
        connect: vi
          .fn()
          .mockRejectedValueOnce(new Error("ECONNREFUSED")) // recovery poll fails once
          .mockResolvedValueOnce({ release: vi.fn() }),     // then succeeds
      } as unknown as import("pg").Pool;

      const action = vi
        .fn()
        .mockRejectedValueOnce(new DatabaseOutageError("DB down")) // first attempt fails
        .mockResolvedValueOnce("recovered");                        // retry succeeds

      const result = await withDatabaseOutageGuard(mockPool, action, {
        maxWaitMs: 5_000,
        initialIntervalMs: 10, // fast poll for tests
      });
      expect(result).toBe("recovered");
      expect(action).toHaveBeenCalledTimes(2);
    }, 10_000); // 10s test timeout

    it("re-throws non-database errors immediately without waiting", async () => {
      const mockPool = { connect: vi.fn() } as unknown as import("pg").Pool;
      const action = vi.fn().mockRejectedValue(new Error("business logic error"));

      await expect(
        withDatabaseOutageGuard(mockPool, action),
      ).rejects.toThrow("business logic error");

      // Pool.connect should never have been called
      expect(mockPool.connect).not.toHaveBeenCalled();
    });
  });

  // ── Checkpoint writer/reader ──────────────────────────────────────────────

  describe("writeCheckpoint() and readLastCheckpoint()", () => {
    it("writes checkpoint without throwing", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await expect(
        writeCheckpoint("incident-1", "observing", 1, { evidenceBundleId: "bundle-123" }),
      ).resolves.not.toThrow();
    });

    it("reads last checkpoint by step_index descending", async () => {
      const checkpointRow = {
        id: "cp-1",
        incident_id: "incident-1",
        step_name: "diagnosing",
        step_index: 2,
        completed: true,
        context: { hypothesisId: "h-1" },
        created_at: new Date(),
        updated_at: new Date(),
      };
      mockQuery.mockResolvedValueOnce({ rows: [checkpointRow] });

      const cp = await readLastCheckpoint("incident-1");
      expect(cp).not.toBeNull();
      expect(cp!.step_name).toBe("diagnosing");
      expect(cp!.step_index).toBe(2);
    });

    it("returns null when no checkpoints exist", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const cp = await readLastCheckpoint("incident-new");
      expect(cp).toBeNull();
    });
  });
});
