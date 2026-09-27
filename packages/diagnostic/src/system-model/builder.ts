/**
 * @node 04.01 — System Model Builder
 *
 * Builds a topology graph from source index evidence.
 * Maps source files to services, contracts to endpoints, tests to behaviors.
 */

// SourceIndexEntry is defined in @sis/observation; redeclare minimal shape to avoid circular dependency
export interface SourceIndexEntry {
  filePath: string;
  exports: string[];
  imports: string[];
  nodeAnnotations: string[];
}

export interface SystemModel {
  version: string;
  builtAt: string;
  services: ServiceNode[];
  sourceToService: Record<string, string>;
  contractToEndpoint: Record<string, string>;
  testToBehavior: Record<string, string>;
  uncertainty: string[];
}

export interface ServiceNode {
  name: string;
  sourceFiles: string[];
  endpoints: string[];
  contracts: string[];
}

/**
 * @node 04.01 — Build a system model from a source index.
 *
 * Records model uncertainty explicitly when relationships cannot be determined.
 */
export function buildSystemModel(sourceIndex: SourceIndexEntry[]): SystemModel {
  const services: ServiceNode[] = [];
  const sourceToService: Record<string, string> = {};
  const contractToEndpoint: Record<string, string> = {};
  const testToBehavior: Record<string, string> = {};
  const uncertainty: string[] = [];

  // Group files by top-level directory (proxy for service boundary)
  const serviceGroups = new Map<string, SourceIndexEntry[]>();
  for (const entry of sourceIndex) {
    const topDir = entry.filePath.split('/')[0] ?? 'root';
    const group = serviceGroups.get(topDir) ?? [];
    group.push(entry);
    serviceGroups.set(topDir, group);
  }

  for (const [serviceName, entries] of serviceGroups) {
    const node: ServiceNode = {
      name: serviceName,
      sourceFiles: entries.map((e) => e.filePath),
      endpoints: [],
      contracts: [],
    };

    for (const entry of entries) {
      sourceToService[entry.filePath] = serviceName;

      // Map TypeScript interfaces to contracts
      for (const exp of entry.exports) {
        if (/Request$|Response$|Schema$/.test(exp)) {
          node.contracts.push(exp);
          contractToEndpoint[exp] = `${serviceName}/*`;
        }
      }

      // Map test files to behaviors
      if (entry.filePath.includes('.test.') || entry.filePath.includes('.spec.')) {
        testToBehavior[entry.filePath] = serviceName;
      }

      // Record uncertainty for dynamic imports
      if (entry.imports.some((i) => i.startsWith('.'))) {
        // relative imports are resolvable
      } else if (entry.imports.some((i) => i.includes('*'))) {
        uncertainty.push(`Dynamic import in ${entry.filePath} — relationships may be incomplete`);
      }
    }

    services.push(node);
  }

  return {
    version: '1.0',
    builtAt: new Date().toISOString(),
    services,
    sourceToService,
    contractToEndpoint,
    testToBehavior,
    uncertainty,
  };
}
