/**
 * @node 04.04 — IBM Bob Task Wrappers
 *
 * All Bob tasks are behind BOB_INTEGRATION_ENABLED feature flag.
 * When disabled, every task returns an explicit stub notice — never silent degradation.
 *
 * Rule 3: BOB_INTEGRATION_ENABLED=false produces visible notices.
 * Bob tasks receive authorization-checked, evidence-backed inputs only.
 * They cannot read files or issue commands directly.
 */

export interface BobFinding {
  stub: boolean;
  notice?: string;
  findings?: string[];
  suggestedChangeLocations?: string[];
  evidenceRefs?: string[];
}

export interface BobTaskInput {
  incidentId: string;
  evidencePayload: Record<string, unknown>;
}

const BOB_STUB_NOTICE = 'Bob integration disabled — running in stub mode';

// ─── Bob Client ───────────────────────────────────────────────────────────────

export class BobClient {
  private readonly enabled: boolean;
  private readonly endpoint: string;
  private readonly apiKey: string;

  constructor() {
    this.enabled = process.env['BOB_INTEGRATION_ENABLED'] === 'true';
    this.endpoint = process.env['BOB_API_ENDPOINT'] ?? '';
    this.apiKey = process.env['BOB_API_KEY'] ?? '';
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * @node 04.04 — Send a request to Bob API or return stub when disabled.
   */
  async send(prompt: string, context: Record<string, unknown>): Promise<BobFinding> {
    if (!this.enabled) {
      return { stub: true, notice: BOB_STUB_NOTICE };
    }

    try {
      const response = await fetch(`${this.endpoint}/api/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ prompt, context }),
      });

      if (!response.ok) {
        return { stub: false, notice: `Bob API returned ${response.status}`, findings: [] };
      }

      const data = await response.json() as BobFinding;
      return data;
    } catch (err: unknown) {
      return {
        stub: false,
        notice: `Bob API call failed: ${(err as Error).message}`,
        findings: [],
      };
    }
  }
}

// ─── Repository Investigator (04.04.01) ──────────────────────────────────────

export async function investigateRepository(
  client: BobClient,
  input: BobTaskInput,
): Promise<BobFinding> {
  const prompt = `Inspect the following repository evidence for: retry implementation, timeout handling, idempotency key stability. Identify change locations. Return structured JSON with findings and suggestedChangeLocations.`;
  return client.send(prompt, input.evidencePayload);
}

// ─── Runtime Investigator (04.04.02) ─────────────────────────────────────────

export async function investigateRuntime(
  client: BobClient,
  input: BobTaskInput,
): Promise<BobFinding> {
  const prompt = `Analyze the following trace and log evidence. Reconstruct the request sequence, identify persisted outcomes, separate symptoms from root causes. Return structured JSON.`;
  return client.send(prompt, input.evidencePayload);
}

// ─── Contract/Test Investigator (04.04.03) ────────────────────────────────────

export async function investigateContractAndTests(
  client: BobClient,
  input: BobTaskInput,
): Promise<BobFinding> {
  const prompt = `Compare the source index and test observations with the documented API expectations. Identify missing test scenarios and propose discriminating tests. Return structured JSON.`;
  return client.send(prompt, input.evidencePayload);
}

// ─── Coordinator (04.04.04) ───────────────────────────────────────────────────

export interface BobCoordinatorResult {
  repositoryFindings: BobFinding;
  runtimeFindings: BobFinding;
  contractFindings: BobFinding;
  combinedEvidenceRefs: string[];
  stubMode: boolean;
}

/**
 * @node 04.04.04 — Orchestrate all three Bob investigation tasks.
 *
 * Collects structured findings and merges evidence refs.
 * Always records whether running in stub mode.
 */
export async function runBobInvestigation(
  client: BobClient,
  repoInput: BobTaskInput,
  runtimeInput: BobTaskInput,
  contractInput: BobTaskInput,
): Promise<BobCoordinatorResult> {
  const [repo, runtime, contract] = await Promise.all([
    investigateRepository(client, repoInput),
    investigateRuntime(client, runtimeInput),
    investigateContractAndTests(client, contractInput),
  ]);

  const allRefs = [
    ...(repo.evidenceRefs ?? []),
    ...(runtime.evidenceRefs ?? []),
    ...(contract.evidenceRefs ?? []),
  ];

  return {
    repositoryFindings: repo,
    runtimeFindings: runtime,
    contractFindings: contract,
    combinedEvidenceRefs: [...new Set(allRefs)],
    stubMode: repo.stub || runtime.stub || contract.stub,
  };
}
