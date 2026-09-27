/**
 * @file packages/artifact-storage/tests/storage.test.ts
 * @node 11.03
 * @description Unit tests for ArtifactStorage.
 *
 * Tests verify:
 *   1. Write stores content + SHA-256 checksum sidecar
 *   2. Read returns correct content and verifies checksum
 *   3. Read returns null for absent artifact
 *   4. Read throws ArtifactWriteError on tampered content
 *   5. Write throws ArtifactWriteError on quota exceeded
 *   6. Cleanup removes all artifacts for an incident
 *   7. exists() returns true for valid artifact, false for absent/tampered
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { ArtifactStorage, resetArtifactStorageForTest } from "../src/storage.js";
import { ArtifactWriteError } from "@sis/shared";

describe("11.03 — ArtifactStorage", () => {
  let tmpDir: string;
  let storage: ArtifactStorage;

  beforeEach(async () => {
    resetArtifactStorageForTest();
    tmpDir = await mkdtemp(join(tmpdir(), "sis-artifact-test-"));
    storage = new ArtifactStorage({ storagePath: tmpDir, quotaBytes: 10 * 1024 * 1024 }); // 10 MB quota
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ── Write ────────────────────────────────────────────────────────────────

  describe("write()", () => {
    it("writes content and returns correct metadata", async () => {
      const content = "hello artifact";
      const meta = await storage.write("incident-1", "sanitized_log", "log-001", content);

      expect(meta.incidentId).toBe("incident-1");
      expect(meta.artifactType).toBe("sanitized_log");
      expect(meta.artifactId).toBe("log-001");
      expect(meta.byteSize).toBe(Buffer.byteLength(content, "utf8"));
      expect(meta.contentHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("writes a SHA-256 checksum sidecar file", async () => {
      const content = Buffer.from("test content");
      const meta = await storage.write("incident-1", "patch", "patch-001", content);

      const { readFile } = await import("fs/promises");
      const sidecarContent = await readFile(
        join(tmpDir, "incident-1", "patch", "patch-001.sha256"),
        "utf8",
      );
      expect(sidecarContent.trim()).toBe(meta.contentHash);
    });

    it("computes deterministic checksum for identical content", async () => {
      const content = "deterministic";
      const meta1 = await storage.write("incident-1", "test_report", "r1", content);
      const meta2 = await storage.write("incident-2", "test_report", "r2", content);
      expect(meta1.contentHash).toBe(meta2.contentHash);
    });

    it("computes different checksums for different content", async () => {
      const meta1 = await storage.write("incident-1", "patch", "p1", "content-a");
      const meta2 = await storage.write("incident-1", "patch", "p2", "content-b");
      expect(meta1.contentHash).not.toBe(meta2.contentHash);
    });

    it("creates intermediate directories automatically", async () => {
      const deep = new ArtifactStorage({
        storagePath: join(tmpDir, "deep", "nested", "path"),
        quotaBytes: 10 * 1024 * 1024,
      });
      await expect(
        deep.write("inc-1", "sanitized_log", "log-1", "content"),
      ).resolves.not.toThrow();
    });
  });

  // ── Quota enforcement ────────────────────────────────────────────────────

  describe("quota enforcement (11.03)", () => {
    it("throws ArtifactWriteError when write would exceed quota", async () => {
      const tiny = new ArtifactStorage({ storagePath: tmpDir, quotaBytes: 5 }); // only 5 bytes
      await expect(
        tiny.write("incident-1", "sanitized_log", "log-1", "this is longer than 5 bytes"),
      ).rejects.toThrow(ArtifactWriteError);
    });

    it("includes quota information in the error context", async () => {
      const tiny = new ArtifactStorage({ storagePath: tmpDir, quotaBytes: 5 });
      let caught: unknown;
      try {
        await tiny.write("incident-1", "sanitized_log", "log-1", "too long");
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(ArtifactWriteError);
      const err = caught as ArtifactWriteError;
      expect(err.message).toContain("quota exceeded");
    });

    it("allows writes that fit within quota", async () => {
      const small = new ArtifactStorage({ storagePath: tmpDir, quotaBytes: 1000 });
      await expect(
        small.write("incident-1", "sanitized_log", "log-1", "short"),
      ).resolves.toBeDefined();
    });
  });

  // ── Read and integrity ───────────────────────────────────────────────────

  describe("read()", () => {
    it("returns the original content after a write", async () => {
      const content = "round-trip content";
      await storage.write("incident-1", "sanitized_log", "log-1", content);
      const result = await storage.read("incident-1", "sanitized_log", "log-1");
      expect(result).not.toBeNull();
      expect(result!.content.toString("utf8")).toBe(content);
    });

    it("returns null when artifact does not exist", async () => {
      const result = await storage.read("nonexistent-incident", "sanitized_log", "nonexistent");
      expect(result).toBeNull();
    });

    it("returns correct metadata on read", async () => {
      const content = "metadata check";
      const writeMeta = await storage.write("incident-2", "patch", "p-1", content);
      const result = await storage.read("incident-2", "patch", "p-1");
      expect(result!.meta.contentHash).toBe(writeMeta.contentHash);
      expect(result!.meta.byteSize).toBe(writeMeta.byteSize);
    });

    it("throws ArtifactWriteError when stored content has been tampered", async () => {
      await storage.write("incident-1", "test_report", "report-1", "original content");

      // Tamper with the content directly on disk
      const contentFile = join(tmpDir, "incident-1", "test_report", "report-1");
      await writeFile(contentFile, "tampered content");

      await expect(
        storage.read("incident-1", "test_report", "report-1"),
      ).rejects.toThrow(ArtifactWriteError);
    });

    it("throws ArtifactWriteError on tampered checksum mismatch (not just silence)", async () => {
      await storage.write("incident-1", "regression_test", "test-1", "original");

      // Tamper with checksum sidecar
      const sidecarFile = join(tmpDir, "incident-1", "regression_test", "test-1.sha256");
      await writeFile(sidecarFile, "000000000000000000000000000000000000000000000000000000000000", "utf8");

      let caught: unknown;
      try {
        await storage.read("incident-1", "regression_test", "test-1");
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(ArtifactWriteError);
      const err = caught as ArtifactWriteError;
      expect(err.code).toBe("ARTIFACT_WRITE_FAILED");
    });
  });

  // ── Cleanup ──────────────────────────────────────────────────────────────

  describe("cleanupByIncident()", () => {
    it("removes all artifacts for an incident", async () => {
      await storage.write("incident-x", "sanitized_log", "log-1", "content");
      await storage.write("incident-x", "patch", "patch-1", "diff");

      await storage.cleanupByIncident("incident-x");

      const result1 = await storage.read("incident-x", "sanitized_log", "log-1");
      const result2 = await storage.read("incident-x", "patch", "patch-1");
      expect(result1).toBeNull();
      expect(result2).toBeNull();
    });

    it("does not throw when incident directory does not exist", async () => {
      await expect(
        storage.cleanupByIncident("nonexistent-incident"),
      ).resolves.not.toThrow();
    });

    it("does not affect artifacts from other incidents", async () => {
      await storage.write("incident-keep", "sanitized_log", "log-1", "keep me");
      await storage.write("incident-remove", "sanitized_log", "log-1", "remove me");

      await storage.cleanupByIncident("incident-remove");

      const kept = await storage.read("incident-keep", "sanitized_log", "log-1");
      expect(kept).not.toBeNull();
    });
  });

  // ── exists() ─────────────────────────────────────────────────────────────

  describe("exists()", () => {
    it("returns true for a valid artifact", async () => {
      await storage.write("incident-1", "evidence_bundle", "bundle-1", "content");
      const result = await storage.exists("incident-1", "evidence_bundle", "bundle-1");
      expect(result).toBe(true);
    });

    it("returns false for a non-existent artifact", async () => {
      const result = await storage.exists("incident-1", "evidence_bundle", "nonexistent");
      expect(result).toBe(false);
    });

    it("returns false when content is tampered (integrity check fails)", async () => {
      await storage.write("incident-1", "sanitized_log", "tampered", "original");
      const contentFile = join(tmpDir, "incident-1", "sanitized_log", "tampered");
      await writeFile(contentFile, "tampered");

      const result = await storage.exists("incident-1", "sanitized_log", "tampered");
      expect(result).toBe(false);
    });
  });

  // ── getUsedBytes() ───────────────────────────────────────────────────────

  describe("getUsedBytes()", () => {
    it("returns 0 when no artifacts have been written", async () => {
      const fresh = new ArtifactStorage({
        storagePath: join(tmpDir, "fresh"),
        quotaBytes: 1024 * 1024,
      });
      const used = await fresh.getUsedBytes();
      expect(used).toBe(0);
    });

    it("increases after each write", async () => {
      const before = await storage.getUsedBytes();
      await storage.write("incident-1", "sanitized_log", "log-1", "content");
      const after = await storage.getUsedBytes();
      expect(after).toBeGreaterThan(before);
    });
  });
});
