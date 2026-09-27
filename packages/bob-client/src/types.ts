/**
 * @file packages/bob-client/src/types.ts
 * @node 04.04
 * @description IBM Bob API request and response types.
 * Simulation mode returns the exact same shapes as the live API.
 */

export interface BobInvestigateRequest {
  task_type: "repository" | "runtime" | "contract_test" | "coordinate";
  evidence_bundle: {
    incident_id: string;
    evidence_records: unknown[];
    source_manifest: string[];
    collection_gaps: unknown[];
  };
  hypothesis?: string;
  prompt?: string;
  bounded_input?: Record<string, unknown>;
}

export interface BobFinding {
  finding_id: string;
  category: string;
  description: string;
  evidence_refs: string[];
  confidence: "high" | "medium" | "low";
  suggested_next_action?: string;
}

export interface BobInvestigateResponse {
  task_id: string;
  task_type: string;
  status: "completed" | "error" | "simulated";
  findings: BobFinding[];
  candidate_hypotheses: string[];
  discriminating_tests: string[];
  next_actions: string[];
  simulation_mode: boolean;
  simulation_notice?: string;
  raw_output?: unknown;
}

export interface BobRepairRequest {
  incident_id: string;
  hypothesis: string;
  evidence_refs: string[];
  repair_spec: Record<string, unknown>;
  allowed_files: string[];
  max_change_lines: number;
}

export interface BobRepairResponse {
  task_id: string;
  status: "completed" | "error" | "simulated";
  diff_content: string;
  rationale: string;
  changed_files: string[];
  simulation_mode: boolean;
  simulation_notice?: string;
}
