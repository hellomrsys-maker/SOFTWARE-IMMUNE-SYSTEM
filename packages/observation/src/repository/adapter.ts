/**
 * @node 02.03 — Repository Observation — Git Adapter, Source Indexer, Change Collector
 */

import { simpleGit } from 'simple-git';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { SensorOutput } from '../sensor-lifecycle/registry.js';

// ─── Git Adapter (02.03.01) ───────────────────────────────────────────────────

export interface RepoSnapshot {
  repoPath: string;
  currentCommit: string;
  branch: string;
  hasUncommittedChanges: boolean;
  capturedAt: string;
}

/**
 * @node 02.03.01 — Capture a repository snapshot using simple-git.
 */
export async function captureRepoSnapshot(repoPath: string): Promise<RepoSnapshot> {
  const git = simpleGit(repoPath);
  const [log, status, branch] = await Promise.all([
    git.log({ maxCount: 1 }),
    git.status(),
    git.revparse(['--abbrev-ref', 'HEAD']).catch(() => 'unknown'),
  ]);

  return {
    repoPath,
    currentCommit: log.latest?.hash ?? 'unknown',
    branch,
    hasUncommittedChanges: !status.isClean(),
    capturedAt: new Date().toISOString(),
  };
}

// ─── Source Indexer (02.03.02) ────────────────────────────────────────────────

export interface SourceIndexEntry {
  filePath: string;
  exports: string[];
  imports: string[];
  nodeAnnotations: string[];
}

/**
 * @node 02.03.02 — Source Indexer
 *
 * Locates TypeScript modules, extracts exports/imports via regex scan,
 * and extracts @node annotations.
 */
export async function indexSourceFiles(repoPath: string): Promise<SourceIndexEntry[]> {
  const entries: SourceIndexEntry[] = [];
  const tsFiles = await findTsFiles(repoPath);

  for (const file of tsFiles.slice(0, 200)) { // cap at 200 files
    try {
      const content = await readFile(file, 'utf-8');
      entries.push({
        filePath: path.relative(repoPath, file),
        exports: extractExports(content),
        imports: extractImports(content),
        nodeAnnotations: extractNodeAnnotations(content),
      });
    } catch {
      // Skip unreadable files
    }
  }

  return entries;
}

// ─── Change Collector (02.03.03) ──────────────────────────────────────────────

export interface RepoChanges {
  recentCommits: Array<{ hash: string; message: string; date: string; author: string }>;
  changedFiles: string[];
  configChanges: string[];
  lockfileChanged: boolean;
}

/**
 * @node 02.03.03 — Collect recent repository changes.
 */
export async function collectRepoChanges(repoPath: string, limit = 20): Promise<RepoChanges> {
  const git = simpleGit(repoPath);

  const [log, diff] = await Promise.all([
    git.log({ maxCount: limit }),
    git.diff(['--name-only', 'HEAD~1', 'HEAD']).catch(() => ''),
  ]);

  const changedFiles = diff.split('\n').filter(Boolean);
  const configChanges = changedFiles.filter(
    (f) => f.endsWith('.json') || f.endsWith('.yaml') || f.endsWith('.yml') || f.endsWith('.env'),
  );
  const lockfileChanged = changedFiles.some((f) => f.includes('lock'));

  return {
    recentCommits: (log.all ?? []).map((c) => ({
      hash: c.hash, message: c.message, date: c.date, author: c.author_name,
    })),
    changedFiles,
    configChanges,
    lockfileChanged,
  };
}

// ─── Test Observer (02.03.04) ─────────────────────────────────────────────────

/**
 * @node 02.03.04 — Test Observer
 *
 * Discovers Vitest test files and records their paths.
 * Actual test execution and coverage parsing happen in the sandbox.
 */
export async function discoverTestFiles(repoPath: string): Promise<string[]> {
  const all = await findTsFiles(repoPath);
  return all
    .filter((f: string) => f.includes('.test.') || f.includes('.spec.'))
    .map((f: string) => path.relative(repoPath, f));
}

export async function buildRepoSensorOutput(repoPath: string): Promise<SensorOutput> {
  const capturedAt = new Date().toISOString();
  const [snapshot, changes, testFiles, sourceIndex] = await Promise.all([
    captureRepoSnapshot(repoPath),
    collectRepoChanges(repoPath),
    discoverTestFiles(repoPath),
    indexSourceFiles(repoPath),
  ]);

  return {
    records: [
      {
        recordType: 'repository',
        sourceReference: { commit: snapshot.currentCommit } as Record<string, unknown>,
        originalTimestamp: capturedAt,
        payload: { snapshot, changes } as Record<string, unknown>,
      },
      {
        recordType: 'source_index',
        sourceReference: { commit: snapshot.currentCommit } as Record<string, unknown>,
        originalTimestamp: capturedAt,
        payload: { sourceIndex, testFiles } as Record<string, unknown>,
      },
    ],
    gaps: [],
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function findTsFiles(dir: string, depth = 0): Promise<string[]> {
  if (depth > 6) return [];
  const files: string[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await findTsFiles(full, depth + 1)));
      } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
        files.push(full);
      }
    }
  } catch {
    // Ignore unreadable directories
  }
  return files;
}

function extractExports(content: string): string[] {
  const matches = [...content.matchAll(/export\s+(?:const|function|class|interface|type|enum)\s+(\w+)/g)];
  return matches.map((m) => m[1] ?? '').filter(Boolean);
}

function extractImports(content: string): string[] {
  const matches = [...content.matchAll(/import\s+.*?\s+from\s+['"]([^'"]+)['"]/g)];
  return matches.map((m) => m[1] ?? '').filter(Boolean);
}

function extractNodeAnnotations(content: string): string[] {
  const matches = [...content.matchAll(/@node\s+([\d.]+)/g)];
  return matches.map((m) => m[1] ?? '').filter(Boolean);
}
