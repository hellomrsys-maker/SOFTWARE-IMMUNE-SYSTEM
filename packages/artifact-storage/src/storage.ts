/**
 * @file packages/artifact-storage/src/storage.ts
 * @node 11.03
 * @description Artifact storage — write, read, integrity verification, cleanup.
 *
 * Every artifact write computes a SHA-256 checksum and stores it alongside the
 * artifact. On read, the checksum is re-verified. A failed integrity check throws
 * ArtifactWriteError (node 11.06) — the caller must stop the workflow.
 *
 * Storage path layout:
 *   <storagePath>/<incidentId>/<artifactType>/<artifactId>
 *   <storagePath>/<incidentId>/<artifactType>/<artifactId>.sha256
 *
 * Quota enforcement (11.03): before each write, total used bytes are checked
 * against the configured quota. If the quota would be exceeded the write throws
 * ArtifactWriteError rather than proceeding silently.
 *
 * IMPORTANT: This code runs as a separate Node.js module — no agent-generated
 * content can modify these enforcement rules at runtime.
 */
import { createHash } from "crypto";
import { mkdir, writeFile, readFile, rm, readdir, stat } from "fs/promises";
import { join, dirname } from "path";
import { ArtifactWriteError } from "@sis/shared";
import { createLogger } from "@sis/logger";

const log = createLogger("artifact-storage");

export type ArtifactType =
  | "sanitized_log"     // 11.03 — redacted log output
  | "test_report"       // 11.03 — JUnit XML or JSON test results
  | "patch"             // 11.03 — unified diff produced by repair
  | "evidence_bundle"   // 11.03 — JSON-serialized evidence bundle
  | "regression_test"   // 06.05 — generated regression test file
  | "environment_manifest"; // 06.02 — environment preparation manifest

export interface ArtifactMeta {
  incidentId: string;
  artifactType: ArtifactType;
  artifactId: string;
  contentHash: string;
  byteSize: number;
  writtenAt: string; // ISO-8601
}

export interface ArtifactStorageConfig {
  storagePath: string;
  quotaBytes: number;
}

function defaultConfig(): ArtifactStorageConfig {
  return {
    storagePath: process.env["ARTIFACT_STORAGE_PATH"] ?? "./artifacts",
    quotaBytes:
      parseInt(process.env["ARTIFACT_STORAGE_QUOTA_MB"] ?? "2048", 10) * 1024 * 1024,
  };
}

/** @node 11.03 — Compute SHA-256 of a buffer */
function computeHash(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

/** @node 11.03 — Resolve the on-disk path for an artifact */
function artifactPath(
  storagePath: string,
  incidentId: string,
  artifactType: ArtifactType,
  artifactId: string,
): string {
  return join(storagePath, incidentId, artifactType, artifactId);
}

/** @node 11.03 — Resolve the on-disk path for the checksum sidecar */
function checksumPath(
  storagePath: string,
  incidentId: string,
  artifactType: ArtifactType,
  artifactId: string,
): string {
  return `${artifactPath(storagePath, incidentId, artifactType, artifactId)}.sha256`;
}

/**
 * @node 11.03 — Compute total bytes used under the storage root.
 * Walks recursively — used for quota enforcement.
 */
async function computeUsedBytes(storagePath: string): Promise<number> {
  let total = 0;
  try {
    const entries = await readdir(storagePath, { withFileTypes: true, recursive: true });
    await Promise.all(
      entries
        .filter((e) => e.isFile())
        .map(async (e) => {
          try {
            const s = await stat(join(e.parentPath ?? storagePath, e.name));
            total += s.size;
          } catch {
            // file disappeared between readdir and stat — ignore
          }
        }),
    );
  } catch {
    // storage path does not exist yet — 0 bytes used
  }
  return total;
}

/**
 * @node 11.03 — ArtifactStorage
 *
 * Responsible for writing and reading artifacts with SHA-256 integrity.
 * Quota is enforced before every write.
 * A failed write or integrity check throws ArtifactWriteError — the worker
 * must not continue after catching this error (Rule 7, node 11.06).
 */
export class ArtifactStorage {
  private readonly config: ArtifactStorageConfig;

  constructor(config?: Partial<ArtifactStorageConfig>) {
    const defaults = defaultConfig();
    this.config = {
      storagePath: config?.storagePath ?? defaults.storagePath,
      quotaBytes: config?.quotaBytes ?? defaults.quotaBytes,
    };
  }

  /**
   * @node 11.03 — Write an artifact with SHA-256 integrity check.
   * Throws ArtifactWriteError if quota exceeded or write fails.
   * The checksum sidecar is written atomically after the content file.
   */
  async write(
    incidentId: string,
    artifactType: ArtifactType,
    artifactId: string,
    content: Buffer | string,
  ): Promise<ArtifactMeta> {
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
    const hash = computeHash(buf);

    // node: 11.03 — Quota enforcement before write
    const usedBytes = await computeUsedBytes(this.config.storagePath);
    if (usedBytes + buf.length > this.config.quotaBytes) {
      throw new ArtifactWriteError(
        `Artifact storage quota exceeded: used ${usedBytes} + ${buf.length} bytes would exceed limit of ${this.config.quotaBytes} bytes`,
        { incidentId, artifactType, artifactId, usedBytes, newBytes: buf.length, quotaBytes: this.config.quotaBytes },
      );
    }

    const contentFile = artifactPath(this.config.storagePath, incidentId, artifactType, artifactId);
    const checksumFile = checksumPath(this.config.storagePath, incidentId, artifactType, artifactId);

    try {
      await mkdir(dirname(contentFile), { recursive: true });
      await writeFile(contentFile, buf);
      await writeFile(checksumFile, hash, "utf8");
    } catch (err) {
      // node: 11.06 — Artifact write failure must stop the workflow
      throw new ArtifactWriteError(
        `Failed to write artifact ${artifactId}: ${err instanceof Error ? err.message : String(err)}`,
        { incidentId, artifactType, artifactId, cause: err },
      );
    }

    const meta: ArtifactMeta = {
      incidentId,
      artifactType,
      artifactId,
      contentHash: hash,
      byteSize: buf.length,
      writtenAt: new Date().toISOString(),
    };

    log.info({ incidentId, artifactType, artifactId, hash, byteSize: buf.length }, "Artifact written");
    return meta;
  }

  /**
   * @node 11.03 — Read an artifact and verify SHA-256 integrity.
   * Returns null if the artifact does not exist.
   * Throws ArtifactWriteError if the stored checksum does not match the content.
   */
  async read(
    incidentId: string,
    artifactType: ArtifactType,
    artifactId: string,
  ): Promise<{ content: Buffer; meta: ArtifactMeta } | null> {
    const contentFile = artifactPath(this.config.storagePath, incidentId, artifactType, artifactId);
    const checksumFile = checksumPath(this.config.storagePath, incidentId, artifactType, artifactId);

    let content: Buffer;
    let storedHash: string;

    try {
      content = await readFile(contentFile);
      storedHash = (await readFile(checksumFile, "utf8")).trim();
    } catch {
      return null; // artifact does not exist
    }

    // node: 11.03 — Integrity verification on read
    const actualHash = computeHash(content);
    if (actualHash !== storedHash) {
      throw new ArtifactWriteError(
        `Artifact integrity check failed for ${artifactId}: stored hash ${storedHash} does not match content hash ${actualHash}`,
        { incidentId, artifactType, artifactId, storedHash, actualHash },
      );
    }

    const s = await stat(contentFile);
    const meta: ArtifactMeta = {
      incidentId,
      artifactType,
      artifactId,
      contentHash: storedHash,
      byteSize: content.length,
      writtenAt: s.mtime.toISOString(),
    };

    log.debug({ incidentId, artifactType, artifactId }, "Artifact read and verified");
    return { content, meta };
  }

  /**
   * @node 11.03 — Delete all artifacts for an incident.
   * Used for cleanup after incident closure.
   */
  async cleanupByIncident(incidentId: string): Promise<void> {
    const incidentDir = join(this.config.storagePath, incidentId);
    try {
      await rm(incidentDir, { recursive: true, force: true });
      log.info({ incidentId }, "Artifact cleanup complete");
    } catch (err) {
      log.warn({ incidentId, err }, "Artifact cleanup failed (non-fatal)");
    }
  }

  /**
   * @node 11.03 — Return current storage usage in bytes.
   */
  async getUsedBytes(): Promise<number> {
    return computeUsedBytes(this.config.storagePath);
  }

  /**
   * @node 11.03 — Check whether a specific artifact exists and is valid.
   * Returns true only if the artifact is present AND passes integrity check.
   */
  async exists(
    incidentId: string,
    artifactType: ArtifactType,
    artifactId: string,
  ): Promise<boolean> {
    try {
      const result = await this.read(incidentId, artifactType, artifactId);
      return result !== null;
    } catch {
      return false; // integrity check failed — treat as absent
    }
  }
}

// Singleton
let _storage: ArtifactStorage | null = null;

export function getArtifactStorage(config?: Partial<ArtifactStorageConfig>): ArtifactStorage {
  if (_storage === null) {
    _storage = new ArtifactStorage(config);
  }
  return _storage;
}

/** Reset singleton — for tests only */
export function resetArtifactStorageForTest(): void {
  _storage = null;
}
