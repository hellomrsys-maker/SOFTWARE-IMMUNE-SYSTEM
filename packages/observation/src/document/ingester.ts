/**
 * @node 02.04 — Document Ingester
 *
 * Ingests markdown and plain text documents.  Extracts:
 * - Sections (headings)
 * - API expectations (TypeScript interface blocks)
 * - Runbook actions (ordered list items in runbook sections)
 *
 * Documents from untrusted sources are flagged; their content is not executed.
 */

import type { SensorOutput } from '../sensor-lifecycle/registry.js';

export interface DocumentMetadata {
  source: string;
  version: string;
  capturedAt: string;
  untrusted: boolean;
}

export interface DocumentSection {
  heading: string;
  level: number;
  content: string;
}

export interface ApiExpectation {
  interfaceName: string;
  source: string;
  methods: string[];
}

/**
 * @node 02.04 — Ingest a markdown or plain text document.
 */
export function ingestDocument(params: {
  source: string;
  content: string;
  version?: string;
  untrusted?: boolean;
}): SensorOutput {
  const capturedAt = new Date().toISOString();
  const sections = extractSections(params.content);
  const apiExpectations = extractApiExpectations(params.content);
  const runbookActions = extractRunbookActions(params.content);

  return {
    records: [{
      recordType: 'document',
      sourceReference: { file: params.source },
      originalTimestamp: capturedAt,
      payload: {
        source: params.source,
        version: params.version ?? 'unknown',
        untrusted: params.untrusted ?? false,
        sections,
        apiExpectations,
        runbookActions,
        // Note: untrusted document content is stored but never executed
        rawContent: params.untrusted ? '[content from untrusted source — not executed]' : params.content,
      },
    }],
    gaps: [],
  };
}

// ─── Extractors ───────────────────────────────────────────────────────────────

function extractSections(content: string): DocumentSection[] {
  const lines = content.split('\n');
  const sections: DocumentSection[] = [];
  let currentSection: DocumentSection | null = null;

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      if (currentSection) sections.push(currentSection);
      currentSection = {
        heading: headingMatch[2]?.trim() ?? '',
        level: headingMatch[1]?.length ?? 1,
        content: '',
      };
    } else if (currentSection) {
      currentSection.content += line + '\n';
    }
  }
  if (currentSection) sections.push(currentSection);
  return sections;
}

function extractApiExpectations(content: string): ApiExpectation[] {
  const expectations: ApiExpectation[] = [];
  // Match TypeScript interface blocks
  const interfacePattern = /interface\s+(\w+)\s*\{([^}]+)\}/g;
  let match;
  while ((match = interfacePattern.exec(content)) !== null) {
    const name = match[1] ?? '';
    const body = match[2] ?? '';
    const methods = body
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('//'));
    expectations.push({ interfaceName: name, source: 'document', methods });
  }
  return expectations;
}

function extractRunbookActions(content: string): string[] {
  const actions: string[] = [];
  const inRunbookSection = /(?:runbook|procedure|steps)/i;
  const lines = content.split('\n');
  let inRunbook = false;

  for (const line of lines) {
    if (/^#{1,6}\s+.*(runbook|procedure|steps)/i.test(line)) {
      inRunbook = true;
      continue;
    }
    if (/^#{1,6}\s+/.test(line)) {
      inRunbook = false;
    }
    if (inRunbook && /^\s*\d+\.\s+/.test(line)) {
      actions.push(line.trim());
    }
  }

  return actions;
}
