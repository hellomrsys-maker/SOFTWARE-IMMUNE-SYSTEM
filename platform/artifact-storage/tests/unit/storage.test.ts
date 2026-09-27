/**
 * @node 11.03 — Artifact Storage tests
 *
 * Verifies:
 * - Write returns correct SHA-256
 * - Read with correct hash returns integrityOk: true
 * - Read with wrong expectedSha256 returns integrityOk: false
 * - StorageQuotaExceededError thrown when quota exceeded
 * - cleanupIncident removes all files
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { ArtifactStorage, StorageQuotaExceededError } from '../../src/storage.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sis-test-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('ArtifactStorage.write', () => {
  it('writes content and returns correct SHA-256', async () => {
    const storage = new ArtifactStorage(tmpDir);
    const result = await storage.write({
      incidentId: 'inc-1',
      artifactId: 'my-log.txt',
      artifactType: 'log',
      content: 'hello world',
    });
    expect(result.sha256).toHaveLength(64);
    expect(result.sizeBytes).toBe(Buffer.from('hello world').length);
    expect(result.artifactId).toBe('my-log.txt');
  });

  it('the same content always produces the same SHA-256', async () => {
    const storage = new ArtifactStorage(tmpDir);
    const a = await storage.write({ incidentId: 'inc-1', artifactId: 'a.txt', artifactType: 'log', content: 'data' });
    const b = await storage.write({ incidentId: 'inc-2', artifactId: 'b.txt', artifactType: 'log', content: 'data' });
    expect(a.sha256).toBe(b.sha256);
  });

  it('throws StorageQuotaExceededError when quota is 1 byte', async () => {
    const storage = new ArtifactStorage(tmpDir, 1);
    await expect(
      storage.write({ incidentId: 'inc-1', artifactId: 'big.txt', artifactType: 'log', content: 'ab' }),
    ).rejects.toThrow(StorageQuotaExceededError);
  });
});

describe('ArtifactStorage.read', () => {
  it('reads back written content with integrityOk=true when sha matches', async () => {
    const storage = new ArtifactStorage(tmpDir);
    const written = await storage.write({
      incidentId: 'inc-1', artifactId: 'report.json', artifactType: 'report', content: '{"ok":true}',
    });
    const read = await storage.read({
      incidentId: 'inc-1', artifactId: 'report.json', artifactType: 'report',
      expectedSha256: written.sha256,
    });
    expect(read.integrityOk).toBe(true);
    expect(read.content.toString('utf-8')).toBe('{"ok":true}');
  });

  it('returns integrityOk=false when expectedSha256 does not match', async () => {
    const storage = new ArtifactStorage(tmpDir);
    await storage.write({ incidentId: 'inc-1', artifactId: 'f.txt', artifactType: 'log', content: 'abc' });
    const read = await storage.read({
      incidentId: 'inc-1', artifactId: 'f.txt', artifactType: 'log',
      expectedSha256: 'deadbeef'.repeat(8), // wrong hash
    });
    expect(read.integrityOk).toBe(false);
  });
});

describe('ArtifactStorage.cleanupIncident', () => {
  it('removes all artifacts for an incident', async () => {
    const storage = new ArtifactStorage(tmpDir);
    await storage.write({ incidentId: 'inc-x', artifactId: 'a.log', artifactType: 'log', content: 'x' });
    await storage.cleanupIncident('inc-x');
    const files = await storage.list('inc-x', 'log');
    expect(files).toHaveLength(0);
  });
});
