-- Migration 008: experiments and regression_tests
-- node: 06

CREATE TABLE IF NOT EXISTS experiments (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id              UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    hypothesis_id            UUID NOT NULL REFERENCES hypotheses(id) ON DELETE CASCADE,
    spec                     JSONB NOT NULL,
    status                   TEXT NOT NULL DEFAULT 'pending'
                                 CHECK (status IN ('pending','running','reproduced','not_reproduced','error')),
    environment_manifest     JSONB,
    trial_results            JSONB NOT NULL DEFAULT '[]',
    causal_conclusion        TEXT,
    causal_conclusion_limits TEXT[] NOT NULL DEFAULT '{}',
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS experiments_incident_id_idx ON experiments(incident_id);
CREATE INDEX IF NOT EXISTS experiments_hypothesis_id_idx ON experiments(hypothesis_id);
CREATE INDEX IF NOT EXISTS experiments_status_idx ON experiments(status);

-- node: 06.05 — Regression test artifacts with SHA-256 hash
CREATE TABLE IF NOT EXISTS regression_tests (
    id                                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id                          UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    experiment_id                        UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
    test_content                         TEXT NOT NULL,
    test_file_path                       TEXT NOT NULL,
    content_hash                         TEXT NOT NULL,  -- SHA-256
    verified_fails_on_defective_baseline BOOLEAN NOT NULL DEFAULT false,
    execution_evidence                   TEXT NOT NULL,
    reproduction_command                 TEXT NOT NULL,
    created_at                           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS regression_tests_incident_id_idx ON regression_tests(incident_id);
CREATE UNIQUE INDEX IF NOT EXISTS regression_tests_content_hash_idx ON regression_tests(content_hash);
