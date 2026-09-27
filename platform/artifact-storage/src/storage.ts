/**
 * @node 11.03 — Artifact Storage
 *
 * Writes, reads, and cleans up artifacts (sanitized logs, test reports, patches)
 * with SHA-256 integrity checking.  Every artifact write returns its checksum.
 *
 * Rule 7 (artifact write failure = stop): callers must treat a write failure as a
 * signal to stop the workflow.  This module does NOT swallow errors.
 */

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import pino from 'pino';

const log = pino({ name: 'sis.artifact-storage' });

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ArtifactWriteResult {
  artifactId: string;
  filePath: string;
  sha256: string;
  sizeBytes: number;
}

export interface ArtifactReadResult {
  content: Buffer;
  sha256: string;
  integrityOk: boolean;
}

// ─── Storage class ────────────────────────────────────────────────────────────

export class ArtifactStorage {
  private readonly root: string;
  private readonly quotaBytes: number;

  /**
   * @node 11.03 — Construct artifact storage.
   *
   * @param root    Root directory on disk.  Created if it does not exist.
   * @param quotaBytes  Per-incident storage quota in bytes (default 512 MB).
   */
  constructor(root?: string, quotaBytes = 512 * 1024 * 1024) {
    this.root = root ?? process.env['ARTIFACT_STORAGE_PATH'] ?? '/var/sis/artifacts';
    this.quotaBytes = quotaBytes;
  }

  /** @node 11.03 — Write artifact content and return SHA-256 checksum. */
  async write(params: {
    incidentId: string;
    artifactId: string;
    artifactType: string; // e.g. 'log', 'patch', 'report', 'test'
    content: Buffer | string;
  }): Promise<ArtifactWriteResult> {
    const dir = path.join(this.root, params.incidentId, params.artifactType);
    await fs.mkdir(dir, { recursive: true });

    // Enforce quota
    const used = await this.dirSizeBytes(path.join(this.root, params.incidentId));
    const contentBuf = Buffer.isBuffer(params.content)
      ? params.content
      : Buffer.from(params.content, 'utf-8');
    if (used + contentBuf.length > this.quotaBytes) {
      throw new StorageQuotaExceededError(
        `Incident ${params.incidentId} would exceed storage quota of ${this.quotaBytes} bytes`,
      );
    }

    const filePath = path.join(dir, `${params.artifactId}`);
    await fs.writeFile(filePath, contentBuf);

    const sha256 = createHash('sha256').update(contentBuf).digest('hex');
    log.info({ artifactId: params.artifactId, sha256, sizeBytes: contentBuf.length }, 'artifact written');

    return {
      artifactId: params.artifactId,
      filePath,
      sha256,
      sizeBytes: contentBuf.length,
    };
  }

  /**
   * @node 11.03 — Read artifact and verify integrity.
   *
   * Returns `integrityOk: false` if the stored content SHA-256 does not match
   * the expected hash.  Callers must check this before trusting the content.
   */
  async read(params: {
    incidentId: string;
    artifactId: string;
    artifactType: string;
    expectedSha256?: string;
  }): Promise<ArtifactReadResult> {
    const filePath = path.join(
      this.root, params.incidentId, params.artifactType, params.artifactId,
    );
    const content = await fs.readFile(filePath);
    const sha256 = createHash('sha256').update(content).digest('hex');
    const integrityOk = params.expectedSha256 ? sha256 === params.expectedSha256 : true;
    return { content, sha256, integrityOk };
  }

  /** @node 11.03 — Delete all artifacts for an incident. */
  async cleanupIncident(incidentId: string): Promise<void> {
    const dir = path.join(this.root, incidentId);
    await fs.rm(dir, { recursive: true, force: true });
    log.info({ incidentId }, 'incident artifacts cleaned up');
  }

  /** @node 11.03 — List artifact IDs for an incident and type. */
  async list(incidentId: string, artifactType: string): Promise<string[]> {
    const dir = path.join(this.root, incidentId, artifactType);
    try {
      return await fs.readdir(dir);
    } catch {
      return [];
    }
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  private async dirSizeBytes(dir: string): Promise<number> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      let total = 0;
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          total += await this.dirSizeBytes(full);
        } else {
          const stat = await fs.stat(full);
          total += stat.size;
        }
      }
      return total;
    } catch {
      return 0;
    }
  }
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export class StorageQuotaExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageQuotaExceededError';
  }
}
