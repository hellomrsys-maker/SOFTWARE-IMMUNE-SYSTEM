-- Migration 010: validation_runs
-- node: 08.01
-- Validation results bound to candidate commit + environment manifest + acceptance-suite hash

CREATE TABLE IF NOT EXISTS validation_runs (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id                 UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    repair_candidate_id         UUID NOT NULL REFERENCES repair_candidates(id) ON DELETE CASCADE,
    candidate_commit            TEXT NOT NULL,
    environment_manifest_hash   TEXT NOT NULL,
    acceptance_suite_hash       TEXT NOT NULL,
    binding_hash                TEXT NOT NULL UNIQUE,  -- SHA-256 of the three above combined
    status                      TEXT NOT NULL DEFAULT 'in_progress'
                                    CHECK (status IN ('in_progress','review_ready','rejected')),
    gate_results                JSONB NOT NULL DEFAULT '[]',
    limitations                 TEXT[] NOT NULL DEFAULT '{}',
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS validation_runs_incident_id_idx ON validation_runs(incident_id);
CREATE INDEX IF NOT EXISTS validation_runs_repair_candidate_id_idx ON validation_runs(repair_candidate_id);
CREATE INDEX IF NOT EXISTS validation_runs_binding_hash_idx ON validation_runs(binding_hash);
